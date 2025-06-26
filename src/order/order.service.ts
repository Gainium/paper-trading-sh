import { InjectModel } from '@nestjs/mongoose'
import { Model, Schema, Types } from 'mongoose'
import {
  Order,
  OrderDataType,
  OrderDocument,
  OrderSide,
  OrderStatus,
  OrderType,
  CurrentOrders,
} from '../schema/order.schema'
import { CreateOrderDto } from './order.controller'
import { HttpException, Inject, Logger, OnModuleInit } from '@nestjs/common'
import { UserService } from '../user/user.service'
import { UserDocument } from '../schema/user.schema'
import { ExchangeService } from '../exchange/exchange.service'
import {
  ExchangeEnum,
  ExchangeInfo,
  Ticker,
  spotMakerFee,
  usdmMakerFee,
  coinmMakerFee,
  Tick,
} from '../exchange/types'
import { isFutures, isCoinm } from '../exchange/utils'
import { UserGateway } from '../ws/user.gateway'
import { IdMute, IdMutex } from '../utils/mutex'
import {
  Position,
  PositionDocument,
  PositionSide,
  PositionStatus,
  PositionDataType,
  LocalPosition,
  CurrentPositions,
} from '../schema/positions.schema'
import { Leverage, LeverageDocument } from '../schema/leverage.schema'
import { v4 } from 'uuid'
import { Hedge, HedgeDocument } from '../schema/hedge.schema'
import { getOrdersBySymbols, getPositionsBySymbols } from './utils'
import { MathHelper } from '../utils/math'
import RedisClient, { type RedisWrapper } from '../utils/redis'

const math = new MathHelper()

export type CreateOrderResponse = {
  orderId: string
  status: OrderStatus
}

export type CommonOrder = {
  symbol: string
  orderId: string
  clientOrderId: string
  transactTime: number
  updateTime: number
  price: string
  origQty: string
  executedQty: string
  cummulativeQuoteQty: string
  status: OrderStatus
  type: OrderType
  side: OrderSide
  fills?: {
    price: string
    qty: string
    commission: string
    commissionAsset: string
    tradeId: string
  }[]
  reduceOnly?: boolean
}

const CreateOrderMutex = new IdMutex()
const UpdateOrderMutex = new IdMutex()
const TickerMutex = new IdMutex()
const commonMutex = new IdMutex()

export class OrderService implements OnModuleInit {
  private redisClient: RedisWrapper | null = null
  private readonly watchSymbols: Map<string, Set<string>> = new Map()
  private tickerTimeMap: Map<string, number> = new Map()
  private symbolPriceMap: Map<string, number> = new Map()
  private tickerSignatureMap: Map<string, string> = new Map()
  private currentOrders: CurrentOrders = new Map()
  private currentPositions: CurrentPositions = new Map()
  private symbolsMap: Map<string, { data: ExchangeInfo; time: number }> =
    new Map()
  private newDataLimit = 30 * 1000
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Position.name) private positionModel: Model<PositionDocument>,
    @InjectModel(Leverage.name) private leverageModel: Model<LeverageDocument>,
    @InjectModel(Hedge.name) private hedgeModel: Model<HedgeDocument>,
    @Inject(UserService) private userService: UserService,
    @Inject(ExchangeService) private exchangeService: ExchangeService,
    @Inject(UserGateway) private userGateway: UserGateway,
  ) {
    this.processTickers = this.processTickers.bind(this)
    this.redisCb = this.redisCb.bind(this)
  }

  @IdMute(
    CreateOrderMutex,
    (order: CreateOrderDto) =>
      `${order.key}${order.secret}${order.symbol}${order.exchange}`,
  )
  async createOrder(order: CreateOrderDto): Promise<CreateOrderResponse> {
    const user = await this.userService.getUserByKeyAndSecretOrThrow(
      order.key,
      order.secret,
    )
    const symbol = await this.exchangeService.getExchangeInfo(
      order.symbol,
      order.exchange,
    )
    const balance = await this.userService.getUserBalanceByUserIdOrThrow(
      user.id,
      [symbol.baseAsset.name, symbol.quoteAsset.name],
    )
    const futures = isFutures(order.exchange)
    let leverage = 1
    if (futures) {
      const leverageDoc = await this.leverageModel.findOne({
        user: user._id,
        symbol: order.symbol,
        side: order.positionSide,
      })
      if (!leverageDoc) {
        await this.leverageModel.create({
          user: user._id,
          symbol: order.symbol,
          locked: false,
          leverage: 1,
          side: order.positionSide,
        })
      }
      leverage = leverageDoc?.leverage ?? 1
    }
    const quoteAsset = symbol.quoteAsset.name
    const baseAsset = symbol.baseAsset.name
    const baseAssetBalance = balance.balance.find((b) => b.asset === baseAsset)
    const quoteAssetBalance = balance.balance.find(
      (b) => b.asset === quoteAsset,
    )
    const currentPrice = await this.getLatestPriceInExchange(
      order.symbol,
      order.exchange,
    )
    let notEnough = false
    order.type =
      order.type === 'MARKET' ||
      (order.side === 'BUY' && order.price > currentPrice) ||
      (order.side === 'SELL' && order.price < currentPrice)
        ? 'MARKET'
        : 'LIMIT'
    const usedPrice = order.type === 'MARKET' ? currentPrice : order.price
    if (isFutures(order.exchange)) {
      const hedge =
        (await this.hedgeModel.findOne({ user: user._id }))?.hedge ?? false
      if (hedge && order.positionSide === PositionSide.both) {
        throw new HttpException(
          'Position side must be specified in hedge mode',
          400,
        )
      }
      const find = this.getPositionsBySymbols([order.symbol]).find(
        (p) =>
          p.user === user._id.toString() &&
          (hedge ? p.positionSide === order.positionSide : true),
      )
      if (find) {
        if (
          (find.positionSide === PositionSide.long && order.side === 'BUY') ||
          (find.positionSide === PositionSide.short && order.side === 'SELL')
        ) {
          notEnough = isCoinm(order.exchange)
            ? !baseAssetBalance ||
              baseAssetBalance.free <
                (order.amount * symbol.quoteAsset.minAmount) /
                  usedPrice /
                  leverage
            : !quoteAssetBalance ||
              quoteAssetBalance.free < (order.amount * usedPrice) / leverage
        } else if (
          ((find.positionSide === PositionSide.short && order.side === 'BUY') ||
            (find.positionSide === PositionSide.long &&
              order.side === 'SELL')) &&
          !order.reduceOnly
        ) {
          const diff = isCoinm(order.exchange)
            ? Math.max(
                0,
                ((order.amount - find.positionAmt) *
                  symbol.quoteAsset.minAmount) /
                  order.price /
                  leverage,
              )
            : Math.max(
                0,
                ((order.amount - find.positionAmt) * order.price) / leverage,
              )
          notEnough = isCoinm(order.exchange)
            ? !baseAssetBalance || baseAssetBalance.free < diff
            : !quoteAssetBalance || quoteAssetBalance.free < diff
        }
      }
      if (!find) {
        notEnough = isCoinm(order.exchange)
          ? !baseAssetBalance ||
            baseAssetBalance.free <
              (order.amount * symbol.quoteAsset.minAmount) /
                usedPrice /
                leverage
          : !quoteAssetBalance ||
            quoteAssetBalance.free < (order.amount * usedPrice) / leverage
      }
      if (notEnough) {
        throw new HttpException('Not enough balance', 400)
      }
      if (!find && order.reduceOnly) {
        Logger.warn(
          `Reduce order is rejected for ${order.externalId}. Position not found ${order.symbol}, user ${user.id}, hedge ${hedge}`,
        )
        throw new HttpException('Reduce order is rejected', 400)
      }
      if (order.type === 'LIMIT') {
        return this.createLimitOrder(order, user)
      }
      return this.processMarketOrder(order, user, leverage)
    }
    if (
      order.type === 'MARKET' ||
      (order.side === 'BUY' && order.price > currentPrice) ||
      (order.side === 'SELL' && order.price < currentPrice)
    ) {
      if (
        order.side === 'BUY' &&
        (!quoteAssetBalance ||
          quoteAssetBalance.free < order.amount * currentPrice)
      ) {
        Logger.warn(
          `Not enough balance for ${order.externalId}, quote ${quoteAssetBalance?.free} + ${quoteAssetBalance?.locked} < ${order.amount} * ${currentPrice}, asset ${quoteAsset}`,
        )
        throw new HttpException('Not enough balance', 400)
      }
      if (
        order.side === 'SELL' &&
        (!baseAssetBalance || baseAssetBalance.free < order.amount)
      ) {
        Logger.warn(
          `Not enough balance for ${order.externalId}, quote ${baseAssetBalance?.free} + ${baseAssetBalance?.locked} < ${order.amount} * ${currentPrice}, asset ${baseAsset}`,
        )
        throw new HttpException('Not enough balance', 400)
      }
      return this.processMarketOrder(order, user, leverage)
    } else {
      if (
        order.side === 'BUY' &&
        (!quoteAssetBalance ||
          quoteAssetBalance.free < order.amount * order.price)
      ) {
        throw new HttpException('Not enough balance', 400)
      }
      if (
        order.side === 'SELL' &&
        (!baseAssetBalance || baseAssetBalance.free < order.amount)
      ) {
        throw new HttpException('Not enough balance', 400)
      }
      return this.createLimitOrder(order, user)
    }
  }

  private getOrderByExternalIdAndSymbol(symbol: string, externalId: string) {
    const order = (this.currentOrders.get(symbol) ?? new Map()).get(externalId)
    if (!order) {
      return
    }
    return { ...order }
  }

  private getOrderById(id: string) {
    const order = Array.from(this.currentOrders.values(), (o) =>
      Array.from(o.values()),
    )
      .flat()
      .find((o) => o.id === id)
    if (!order) {
      return
    }
    return { ...order }
  }

  private setOrder(order: OrderDataType) {
    this.currentOrders.set(
      order.symbol,
      (this.currentOrders.get(order.symbol) ?? new Map()).set(
        order.externalId,
        order,
      ),
    )
  }

  private removeOrder(order: OrderDataType) {
    const bySymbol = this.currentOrders.get(order.symbol)
    if (bySymbol) {
      bySymbol.delete(order.externalId)
    }
  }

  private getOrdersBySymbols(symbols: string[]) {
    return getOrdersBySymbols(symbols, this.currentOrders)
  }

  private getPositionByUUID(uuid: string) {
    const order = Array.from(this.currentPositions.values(), (o) =>
      Array.from(o.values()),
    )
      .flat()
      .find((o) => o.uuid === uuid)
    if (!order) {
      return
    }
    return { ...order }
  }

  private setPosition(position: LocalPosition) {
    this.currentPositions.set(
      position.symbol,
      (this.currentPositions.get(position.symbol) ?? new Map()).set(
        position.uuid,
        position,
      ),
    )
  }

  private removePosition(position: LocalPosition) {
    const bySymbol = this.currentPositions.get(position.symbol)
    if (bySymbol) {
      bySymbol.delete(position.uuid)
    }
  }

  private getPositionsBySymbols(symbols: string[]) {
    return getPositionsBySymbols(symbols, this.currentPositions)
  }

  async getOrderByKeySecretExternalIdAndSymbol(
    key: string,
    secret: string,
    externalId: string,
    symbol: string,
  ): Promise<CommonOrder> {
    const user = await this.userService.getUserByKeyAndSecretOrThrow(
      key,
      secret,
    )
    const orderInRam = this.getOrderByExternalIdAndSymbol(symbol, externalId)
    if (orderInRam) {
      return {
        symbol: orderInRam.symbol,
        orderId: orderInRam._id.toString(),
        clientOrderId: orderInRam.externalId,
        transactTime: orderInRam.updatedAt.getTime(),
        updateTime: orderInRam.updatedAt.getTime(),
        price: `${orderInRam.price}`,
        origQty: `${orderInRam.amount}`,
        executedQty: `${orderInRam.filledAmount}`,
        cummulativeQuoteQty: `${
          orderInRam.filledAmount * orderInRam.avgFilledPrice
        }`,
        status: orderInRam.status,
        type: orderInRam.type,
        side: orderInRam.side,
        fills: [],
      }
    }
    const order = await this.orderModel
      .findOne({ user: user.id, externalId, symbol })
      .exec()
    if (!order) {
      throw new HttpException('Unknown order', 400)
    }

    return {
      symbol: order.symbol,
      orderId: order._id.toString(),
      clientOrderId: order.externalId,
      transactTime: order.updatedAt.getTime(),
      updateTime: order.updatedAt.getTime(),
      price: `${order.price}`,
      origQty: `${order.amount}`,
      executedQty: `${order.filledAmount}`,
      cummulativeQuoteQty: `${order.filledAmount * order.avgFilledPrice}`,
      status: order.status,
      type: order.type,
      side: order.side,
      fills: [],
    }
  }

  async cancelOrderByKeySecretExternalIdAndSymbol(
    key: string,
    secret: string,
    externalId: string,
    expired?: boolean,
  ): Promise<{ status?: string; reason?: string }> {
    const user = await this.userService.getUserByKeyAndSecretOrThrow(
      key,
      secret,
    )
    return this.processCancelOrder(externalId, user, expired)
  }

  async cancelOrderByKeySecretIdAndSymbol(
    key: string,
    secret: string,
    orderId: string,
    expired?: boolean,
  ): Promise<{ status?: string; reason?: string }> {
    const user = await this.userService.getUserByKeyAndSecretOrThrow(
      key,
      secret,
    )
    const order = await this.orderModel.findOne({ _id: orderId }).exec()
    return this.processCancelOrder(order.externalId, user, expired)
  }

  async getAllOpenOrdersByKeySecretAndSymbol(
    key: string,
    secret: string,
    symbol?: string,
  ): Promise<CommonOrder[]> {
    const user = await this.userService.getUserByKeyAndSecretOrThrow(
      key,
      secret,
    )
    const request = {
      user,
      status: OrderStatus.CREATED,
    }
    if (symbol) {
      request['symbol'] = symbol
    }
    const orders = await this.orderModel
      .find(request, undefined, { sort: { createdAt: -1 } })
      .exec()
    const preparedOrders = []
    for (const order of orders) {
      preparedOrders.push({
        symbol: order.symbol,
        orderId: order._id,
        clientOrderId: order.externalId,
        transactTime: order.updatedAt.getTime(),
        updateTime: order.updatedAt.getTime(),
        price: `${order.price}`,
        origQty: `${order.amount}`,
        executedQty: `${order.filledAmount}`,
        cummulativeQuoteQty: `${order.filledAmount * order.avgFilledPrice}`,
        status: order.status,
        type: order.type,
        side: order.side,
        fills: [],
      })
    }
    return preparedOrders
  }

  async getOrderByKeySecretAndOrderId(
    key: string,
    secret: string,
    orderId: string,
  ) {
    const user = await this.userService.getUserByKeyAndSecretOrThrow(
      key,
      secret,
    )
    if (!orderId) {
      throw new HttpException('Empty order id', 400)
    }
    const orderInRam = this.getOrderById(orderId)
    if (orderInRam) {
      return {
        symbol: orderInRam.symbol,
        orderId: orderInRam._id.toString(),
        clientOrderId: orderInRam.externalId,
        transactTime: orderInRam.updatedAt.getTime(),
        updateTime: orderInRam.updatedAt.getTime(),
        price: `${orderInRam.price}`,
        origQty: `${orderInRam.amount}`,
        executedQty: `${orderInRam.filledAmount}`,
        cummulativeQuoteQty: `${
          orderInRam.filledAmount * orderInRam.avgFilledPrice
        }`,
        status: orderInRam.status,
        type: orderInRam.type,
        side: orderInRam.side,
        fills: [],
      }
    }
    const order = await this.orderModel
      .findOne({ user: user.id, _id: orderId })
      .exec()
    if (!order) {
      throw new HttpException('Order not found', 400)
    }
    return {
      symbol: order.symbol,
      orderId: order._id,
      clientOrderId: order.externalId,
      transactTime: order.updatedAt.getTime(),
      updateTime: order.updatedAt.getTime(),
      price: `${order.price}`,
      origQty: `${order.amount}`,
      executedQty: `${order.filledAmount}`,
      cummulativeQuoteQty: `${order.filledAmount * order.avgFilledPrice}`,
      status: order.status,
      type: order.type,
      side: order.side,
      fills: [],
    }
  }

  onModuleInit() {
    ;(async () => {
      const ordersAndPositions = await this.getOpenOrdersAndPositions()
      this.updateBalances(
        ordersAndPositions.orders,
        ordersAndPositions.positions,
      )
      this.checkOrdersInDb(ordersAndPositions.orders)
      this.checkPositionsInDb(ordersAndPositions.positions)
      this.redisClient = await RedisClient.getInstance(true, 'common')
      const keys = [...this.watchSymbols.keys()].map((k) => `trade@${k}`)
      for (const k of keys) {
        this.redisClient.subscribe(k, this.redisCb)
      }
    })()

    this.addSymbols()
    ;(async () => {
      await this.orderModel.syncIndexes()
      await this.positionModel.syncIndexes()
      await this.hedgeModel.syncIndexes()
      await this.leverageModel.syncIndexes()
    })()
    this.updateNotSidedLeverages()
  }

  async updateNotSidedLeverages() {
    try {
      const find = await this.leverageModel.find({
        locked: true,
        side: { $exists: false },
      })
      if (!find.length) {
        return
      }
      Logger.log(`Found ${find.length} not sided leverages`)
      let i = 0
      for (const f of find) {
        i++
        Logger.log(`Process ${f.user} not sided leverages ${i}/${find.length}`)
        const hedge = await this.hedgeModel.findOne({ user: f.user })
        if (hedge?.hedge) {
          Logger.log(`User ${f.user} enabled hedge. ${i}/${find.length}`)
          const positions = await this.positionModel.find({
            status: PositionStatus.new,
            user: f.user,
            symbol: f.symbol,
          })
          if (positions?.length === 2) {
            Logger.log(`User ${f.user} have 2 position. ${i}/${find.length}`)
            await this.leverageModel.create({
              symbol: f.symbol,
              user: f.user,
              leverage: f.leverage,
              side: PositionSide.long,
              locked: true,
            })
            await this.leverageModel.updateOne(
              { _id: f._id },
              { $set: { side: PositionSide.short } },
            )
          } else {
            Logger.log(`User ${f.user} have one position. ${i}/${find.length}`)
            await this.leverageModel.updateOne(
              { _id: f._id },
              { $set: { side: positions?.[0]?.positionSide } },
            )
          }
        } else {
          Logger.log(
            `User ${f.user} NOT enable hedge. Set BOTH ${i}/${find.length}`,
          )
          await this.leverageModel.updateOne(
            { _id: f._id },
            { $set: { side: PositionSide.both } },
          )
        }
      }
    } catch (e) {
      Logger.error(`Cannot check not sided leverages ${e}`)
    }
  }

  redisCb(msg) {
    const parse = JSON.parse(msg) as Ticker & { exchange: ExchangeEnum }
    this.processTickers(parse.exchange, [parse])
  }

  private async addSymbols() {
    const time = +new Date()
    for (const ex of [
      ExchangeEnum.binance,
      ExchangeEnum.bybit,
      ExchangeEnum.kucoin,
      ExchangeEnum.bybitUsdm,
      ExchangeEnum.binanceUsdm,
      ExchangeEnum.bybitCoinm,
      ExchangeEnum.binanceCoinm,
      ExchangeEnum.bitget,
      ExchangeEnum.bitgetCoinm,
      ExchangeEnum.binanceUsdm,
      ExchangeEnum.okx,
      ExchangeEnum.okxInverse,
      ExchangeEnum.okxLinear,
      ExchangeEnum.kucoinInverse,
      ExchangeEnum.kucoinLinear,
    ]) {
      const symbols = await this.exchangeService.getAllExchangeInfo(ex)
      for (const symbol of symbols.data) {
        this.symbolsMap.set(`${symbol.pair}`, { data: symbol, time })
      }
    }
  }

  @IdMute(UpdateOrderMutex, (orderId: string) => orderId)
  private async processCancelOrder(
    orderId: string,
    user: UserDocument,
    expired?: boolean,
  ) {
    const order = await this.orderModel.findOne({ externalId: orderId, user })
    if (
      !order ||
      order.status === OrderStatus.FILLED ||
      order.status === OrderStatus.CANCELED ||
      order.status === OrderStatus.EXPIRED
    ) {
      throw new HttpException('Unknown order', 400)
    }
    order.status = expired ? OrderStatus.EXPIRED : OrderStatus.CANCELED
    await this.orderModel.updateOne(
      { _id: order._id },
      {
        $set: { status: order.status },
      },
    )
    if (order.type === 'LIMIT') {
      let symbol: ExchangeInfo | undefined
      const sym = `${order.symbol}@${order.exchange}`
      const getSymbolFromMap = this.symbolsMap.get(sym)
      symbol = getSymbolFromMap?.data
      if (
        !getSymbolFromMap ||
        getSymbolFromMap?.time + 3 * 60 * 60 * 1000 < new Date().getTime()
      ) {
        symbol = await this.exchangeService.getExchangeInfo(
          order.symbol,
          order.exchange,
        )
        this.symbolsMap.set(sym, { data: symbol, time: new Date().getTime() })
      }
      const asset =
        order.side === 'BUY'
          ? symbol?.quoteAsset.name ||
            (await this.exchangeService.getQuoteAsset(
              order.exchange,
              order.symbol,
            ))
          : symbol?.baseAsset.name ||
            (await this.exchangeService.getBaseAsset(
              order.exchange,
              order.symbol,
            ))
      let amount =
        order.side === 'BUY'
          ? order.quoteAmount - (order.filledQuoteAmount || 0)
          : order.amount - order.filledAmount
      if (isFutures(order.exchange)) {
        amount = 0
      }
      if (amount) {
        await this.updateBalance(user._id, {
          asset,
          free: amount,
          locked: -amount,
        })
      }
    }
    this.userGateway.sendOrderToClient(user.id, {
      ...order.toObject(),
      id: order._id.toString(),
    })
    const sym = `${order.symbol}@${order.exchange}`
    ;(this.watchSymbols.get(sym) ?? new Set()).delete(order.externalId)
    if ((this.watchSymbols.get(sym) ?? new Set()).size === 0) {
      this.watchSymbols.delete(sym)
      this.unsubscribeRedis(sym)
    }
    ;(this.currentOrders.get(order.symbol) ?? new Map()).delete(
      order.externalId,
    )
    return { status: 'canceled' }
  }

  private async checkOrdersInDb(_orders?: OrderDocument[]) {
    const orders =
      _orders ||
      (await this.orderModel
        .find({
          status: { $in: [OrderStatus.CREATED, OrderStatus.PARTIALLY_FILLED] },
          type: 'LIMIT',
        })
        .exec())
    for (const p of orders) {
      const sym = `${p.symbol}@${p.exchange}`
      this.watchSymbols.set(
        sym,
        (this.watchSymbols.get(sym) ?? new Set()).add(p.externalId),
      )
      this.pushPosition(p)
    }
  }

  private async checkPositionsInDb(_positions?: PositionDocument[]) {
    const positions =
      _positions ||
      (await this.positionModel
        .find({
          status: PositionStatus.new,
        })
        .exec())
    for (const p of positions) {
      const sym = `${p.symbol}@${p.exchange}`
      this.watchSymbols.set(
        sym,
        (this.watchSymbols.get(sym) ?? new Set()).add(p.id),
      )
      this.pushFuturePosition(p)
    }
  }

  private mapOrderDocumentToDataType(p: OrderDocument): OrderDataType {
    return {
      _id: p._id,
      id: p._id.toString(),
      quoteAmount: p.quoteAmount,
      amount: p.amount,
      filledAmount: p.filledAmount,
      filledQuoteAmount: p.filledQuoteAmount,
      price: p.price,
      avgFilledPrice: p.avgFilledPrice,
      fee: p.fee,
      symbol: p.symbol,

      //@ts-ignore
      user: p.user._id,
      exchange: p.exchange,
      status: p.status,
      type: p.type,
      side: p.side,
      externalId: p.externalId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      reduceOnly: p.reduceOnly,
      positionSide: p.positionSide,
    }
  }

  private mapPositionToDataType(
    p: PositionDocument,
  ): Omit<PositionDataType, 'user'> & { user: string } {
    return {
      _id: p._id,
      id: p._id.toString(),
      symbol: p.symbol,
      margin: p.margin,
      liquidationPrice: p.liquidationPrice,
      entryPrice: p.entryPrice,
      positionSide: p.positionSide,
      positionAmt: p.positionAmt,
      //@ts-ignore
      user: p.user._id.toString(),
      exchange: p.exchange,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      status: p.status,
      profit: p.profit,
      fee: p.fee,
      leverage: p.leverage,
      uuid: p.uuid,
      closePrice: p.closePrice,
    }
  }

  private pushPosition(p: OrderDocument) {
    this.setOrder(this.mapOrderDocumentToDataType(p))
  }

  private pushFuturePosition(p: PositionDocument) {
    this.setPosition(this.mapPositionToDataType(p))
  }

  private async getOpenOrdersAndPositions(): Promise<{
    orders: OrderDocument[]
    positions: PositionDocument[]
  }> {
    const orders = await this.orderModel
      .find({
        status: { $in: [OrderStatus.CREATED, OrderStatus.PARTIALLY_FILLED] },
        type: 'LIMIT',
      })
      .exec()
    const positions = await this.positionModel
      .find({
        status: PositionStatus.new,
      })
      .exec()
    return { orders, positions }
  }

  private async updateBalances(
    _orders?: OrderDocument[],
    _positions?: PositionDocument[],
  ) {
    const orders =
      _orders ||
      (await this.orderModel
        .find({
          status: { $in: [OrderStatus.CREATED, OrderStatus.PARTIALLY_FILLED] },
          type: 'LIMIT',
        })
        .exec())
    const positions =
      _positions ||
      (await this.positionModel
        .find({
          status: PositionStatus.new,
        })
        .exec())
    const lockedBalances: Map<string, Map<string, number>> = new Map()
    for (const o of orders) {
      if (isFutures(o.exchange)) {
        continue
      }
      try {
        const id = `${o.user.toString()}`
        const userBalances = lockedBalances.get(id) ?? new Map()
        const symbol = await this.exchangeService.getExchangeInfo(
          o.symbol,
          o.exchange,
        )
        const asset =
          o.side === 'BUY' ? symbol.quoteAsset.name : symbol.baseAsset.name
        const qty =
          o.side === 'BUY'
            ? o.quoteAmount - o.filledQuoteAmount
            : o.amount - o.filledAmount
        userBalances.set(asset, (userBalances.get(asset) ?? 0) + qty)
        lockedBalances.set(id, userBalances)
      } catch (e) {
        Logger.error(e)
      }
    }

    for (const p of positions) {
      try {
        const id = `${p.user.toString()}`
        const userBalances = lockedBalances.get(id) ?? new Map()
        const symbol = await this.exchangeService.getExchangeInfo(
          p.symbol,
          p.exchange,
        )
        const asset = isCoinm(p.exchange)
          ? symbol.baseAsset.name
          : symbol.quoteAsset.name
        const qty = p.margin
        userBalances.set(asset, (userBalances.get(asset) ?? 0) + qty)
        lockedBalances.set(id, userBalances)
      } catch (e) {
        Logger.error(e)
      }
    }
    const users = await this.userService.getAllUsersOrThrow()
    for (const u of users) {
      const v = lockedBalances.get(u.id)
      const ub = await this.userService.getUserBalanceByUserIdOrThrow(u.id)
      for (const b of ub.balance) {
        if (v) {
          const fromOrders = v.get(b.asset)
          if (fromOrders && fromOrders !== b.locked) {
            const diff = b.locked - fromOrders
            Logger.log(
              `user - ${u.id}, diff - ${diff}, asset - ${b.asset}, locked - ${b.locked}, calculated - ${fromOrders}`,
            )
            await this.updateBalance(u._id, {
              free: diff,
              locked: -diff,
              asset: b.asset,
            })
          }
          if (!fromOrders && b.locked !== 0) {
            Logger.log(
              `user - ${u.id}, locked - ${b.locked}, asset - ${b.asset}, locked but not in orders`,
            )
            await this.userService.setUserBalance(u.id, {
              free: b.free + (b.locked < 0 ? 0 : b.locked),
              locked: 0,
              asset: b.asset,
            })
          }
        } else if (b.locked !== 0) {
          Logger.log(
            `user - ${u.id}, locked - ${b.locked}, asset - ${b.asset}, locked but not in orders`,
          )
          await this.userService.setUserBalance(u.id, {
            free: b.free + (b.locked < 0 ? 0 : b.locked),
            locked: 0,
            asset: b.asset,
          })
        }
      }
    }
  }

  private getUserFee(type: 'taker' | 'maker', exchange: ExchangeEnum) {
    return type === 'maker'
      ? isFutures(exchange)
        ? isCoinm(exchange)
          ? coinmMakerFee
          : usdmMakerFee
        : spotMakerFee
      : isFutures(exchange)
        ? isCoinm(exchange)
          ? coinmMakerFee * 5
          : usdmMakerFee * 2
        : spotMakerFee
  }

  private async getLatestPriceInExchange(
    symbol: string,
    exchange: ExchangeEnum,
  ) {
    const key = `${symbol}@${exchange}`
    let currentPrice = this.symbolPriceMap.get(key)
    const tickerTime = this.tickerTimeMap.get(key) ?? 0
    if (!currentPrice || +new Date() - tickerTime > this.newDataLimit) {
      const request = await this.exchangeService.getLatestPriceInExchange(
        exchange,
        symbol,
      )
      if (request.status === 'NOTOK') {
        Logger.error(
          `Failed to get latest price from exchange ${request.reason}`,
        )
      }
      if (request.data === null) {
        Logger.error(`Failed to get latest price from exchange`)
      }
      currentPrice = request.data
      this.tickerTimeMap.set(key, +new Date())
      this.symbolPriceMap.set(key, currentPrice)
    }

    if (!currentPrice) {
      throw new HttpException('Failed to get latest price from exchange', 400)
    }
    return currentPrice
  }

  private async processMarketOrder(
    order: CreateOrderDto,
    user: UserDocument,
    leverage: number,
  ) {
    const currentPrice = await this.getLatestPriceInExchange(
      order.symbol,
      order.exchange,
    )

    const symbol = await this.exchangeService.getExchangeInfo(
      order.symbol,
      order.exchange,
    )
    const quoteAssetAmount = order.amount * currentPrice
    const baseAssetAmount = isCoinm(order.exchange)
      ? (order.amount * symbol.quoteAsset.minAmount) / currentPrice
      : order.amount
    let fee = 0
    const feePerc = this.getUserFee('taker', order.exchange)
    if (isFutures(order.exchange)) {
      if (isCoinm(order.exchange)) {
        fee = baseAssetAmount * feePerc
      } else {
        fee = quoteAssetAmount * feePerc
      }
    }
    let orderData:
      | Omit<OrderDataType, '_id' | 'createdAt' | 'updatedAt' | 'id'>
      | undefined
    if (order.side === 'SELL') {
      fee = isFutures(order.exchange) ? fee : quoteAssetAmount * feePerc
      orderData = {
        amount: order.amount,
        filledAmount: order.amount,
        filledQuoteAmount: quoteAssetAmount,
        quoteAmount: quoteAssetAmount,
        price: currentPrice,
        avgFilledPrice: currentPrice,
        fee,
        feePerc,
        symbol: order.symbol,
        user: user.id,
        exchange: order.exchange,
        status: OrderStatus.FILLED,
        side: order.side,
        externalId: order.externalId,
        type: 'MARKET',
        reduceOnly: order.reduceOnly,
        positionSide: order.positionSide,
      }
    } else {
      fee = isFutures(order.exchange) ? fee : order.amount * feePerc
      orderData = {
        amount: order.amount,
        quoteAmount: quoteAssetAmount,
        filledQuoteAmount: quoteAssetAmount,
        filledAmount: order.amount,
        price: currentPrice,
        avgFilledPrice: currentPrice,
        fee,
        feePerc,
        symbol: order.symbol,
        user: user.id,
        exchange: order.exchange,
        status: OrderStatus.FILLED,
        side: order.side,
        externalId: order.externalId,
        type: 'MARKET',
        reduceOnly: order.reduceOnly,
        positionSide: order.positionSide,
      }
    }
    const orderInDb = await this.orderModel.create(orderData)
    if (isFutures(order.exchange)) {
      await this.processFuturesPosition(orderInDb, leverage, symbol)
    } else {
      const balance: { asset: string; free: number; locked: number }[] = []
      if (order.side === 'SELL') {
        balance.push(
          {
            free: quoteAssetAmount - fee,
            locked: 0,
            asset: symbol.quoteAsset.name,
          },
          {
            free: -order.amount,
            asset: symbol.baseAsset.name,
            locked: 0,
          },
        )
      } else {
        balance.push(
          {
            free: baseAssetAmount - fee,
            locked: 0,
            asset: symbol.baseAsset.name,
          },
          {
            free: -quoteAssetAmount,
            asset: symbol.quoteAsset.name,
            locked: 0,
          },
        )
      }
      await this.updateBalance(user.id, ...balance)
    }
    this.userGateway.sendOrderToClient(
      user.id,
      this.mapOrderDocumentToDataType(orderInDb),
    )
    return { orderId: orderInDb.id, status: orderInDb.status }
  }

  private createPositionFromOrder(
    order: Omit<OrderDataType, 'id'> & { id?: string },
    leverage: number,
    _margin?: number,
    _fee?: number,
    amount?: number,
  ): Omit<PositionDataType, '_id' | 'id'> {
    const margin = _margin ?? (order.amount * order.price) / leverage
    const fee = _fee ?? order.fee
    const time = new Date()
    const feePerc = this.getUserFee(
      order.type === 'LIMIT' ? 'maker' : 'taker',
      order.exchange,
    )
    return {
      symbol: order.symbol,
      margin,
      entryPrice: order.price,
      liquidationPrice: this.liquidationPrice(
        order.price,
        order.side === 'BUY' ? PositionSide.long : PositionSide.short,
        feePerc,
        leverage,
      ),
      positionSide:
        order.side === 'BUY' ? PositionSide.long : PositionSide.short,
      positionAmt: amount ?? order.amount,
      user: order.user,
      exchange: order.exchange,
      status: PositionStatus.new,
      fee,
      leverage,
      profit: -fee,
      createdAt: time,
      updatedAt: time,
      uuid: v4(),
      closePrice: 0,
    }
  }

  private addPositionToWatchList(position: PositionDocument) {
    this.setPosition(this.mapPositionToDataType(position))
    const sym = `${position.symbol}@${position.exchange}`
    this.checkRedis(sym)
    this.watchSymbols.set(
      sym,
      (this.watchSymbols.get(sym) ?? new Set()).add(position.id),
    )
  }

  @IdMute(
    commonMutex,
    (user: Schema.Types.ObjectId, symbol: string) => `${user}-${symbol}`,
  )
  private async lockLeverage(
    user: Schema.Types.ObjectId,
    symbol: string,
    side: PositionSide,
  ) {
    await this.leverageModel.updateOne(
      { user, symbol, side },
      { $set: { locked: true } },
    )
  }

  @IdMute(
    commonMutex,
    (user: Schema.Types.ObjectId, symbol: string) => `${user}-${symbol}`,
  )
  private async unLockLeverage(
    user: Schema.Types.ObjectId,
    symbol: string,
    side: PositionSide,
  ) {
    await this.leverageModel.updateOne(
      { user, symbol, side },
      { $set: { locked: false } },
    )
  }

  private liquidationPrice(
    entryPrice: number,
    position: PositionSide,
    fee: number,
    leverage: number,
  ) {
    return (
      entryPrice *
      (leverage > 1
        ? (1 + (1 / leverage) * (position === PositionSide.long ? -1 : 1)) *
          (1 + fee * (position === PositionSide.long ? -1 : 1))
        : position === PositionSide.long
          ? fee
          : 1 / fee)
    )
  }

  private async processFuturesPosition(
    order: Omit<OrderDataType, 'id'> & { id?: string },
    leverage: number,
    symbol: ExchangeInfo,
  ) {
    const hedge =
      (await this.hedgeModel
        .findOne({
          //@ts-ignore
          user: order.user._id.toString(),
        })
        .then((res) => res?.hedge)) ?? false
    const current = this.getPositionsBySymbols([order.symbol]).find(
      (p) =>
        //@ts-ignore
        p.user === order.user._id.toString() &&
        (hedge ? p.positionSide === order.positionSide : true),
    )
    const margin = isCoinm(order.exchange)
      ? (order.amount * symbol.quoteAsset.minAmount) / order.price / leverage
      : (order.amount * order.price) / leverage
    const quote = margin
    let locked = quote
    let free = -locked - order.fee
    if (!current) {
      const position = await this.positionModel.create(
        this.createPositionFromOrder(order, leverage, margin),
      )
      this.addPositionToWatchList(position)
      this.lockLeverage(order.user, order.symbol, order.positionSide)
    } else {
      const feePerc =
        order.feePerc ||
        this.getUserFee(
          order.type === 'LIMIT' ? 'maker' : 'taker',
          order.exchange,
        )
      if (
        (order.side === 'BUY' && current.positionSide === PositionSide.long) ||
        (order.side === 'SELL' && current.positionSide === PositionSide.short)
      ) {
        current.margin += margin

        current.entryPrice =
          (current.entryPrice * current.positionAmt +
            order.price * order.amount) /
          (current.positionAmt + order.amount)
        current.positionAmt += order.amount
        current.liquidationPrice = this.liquidationPrice(
          current.entryPrice,
          current.positionSide,
          feePerc,
          leverage,
        )

        current.updatedAt = new Date()
        current.fee += order.fee
        current.profit -= order.fee
      } else {
        const long = current.positionSide === PositionSide.long
        const diff = current.positionAmt - order.amount
        const roundedDiff = math.round(diff, 10)
        if (
          Math.abs(diff) <= Number.EPSILON ||
          (isCoinm(order.exchange)
            ? Math.abs(roundedDiff) < 1
            : Math.abs(roundedDiff) < symbol.baseAsset.minAmount)
        ) {
          current.status = PositionStatus.closed
          const profit = isCoinm(order.exchange)
            ? ((current.positionAmt * symbol.quoteAsset.minAmount) /
                current.entryPrice -
                (current.positionAmt * symbol.quoteAsset.minAmount) /
                  order.price) *
                (long ? 1 : -1) -
              order.fee
            : (current.positionAmt * order.price -
                current.positionAmt * current.entryPrice) *
                (long ? 1 : -1) -
              order.fee
          current.profit += profit
          current.fee += order.fee
          const old = current.margin
          current.margin = 0
          locked = -old
          free = old + profit
          current.closePrice = order.price
          this.unLockLeverage(order.user, order.symbol, order.positionSide)
          const sym = `${order.symbol}@${order.exchange}`
          ;(this.watchSymbols.get(sym) ?? new Set()).delete(current.id)
          if ((this.watchSymbols.get(sym) ?? new Set()).size === 0) {
            this.watchSymbols.delete(sym)
            this.unsubscribeRedis(sym)
          }
        } else if (diff <= 0) {
          if (order.reduceOnly) {
            order.fee -= isCoinm(order.exchange)
              ? (Math.abs(diff) * symbol.quoteAsset.minAmount) / order.price
              : Math.abs(diff) * feePerc
            order.amount = current.positionAmt
            order.filledAmount = order.amount
            order.quoteAmount = order.amount * order.price
            order.filledQuoteAmount = order.quoteAmount
            current.status = PositionStatus.closed
            const profit = isCoinm(order.exchange)
              ? ((order.amount * symbol.quoteAsset.minAmount) /
                  current.entryPrice -
                  (order.amount * symbol.quoteAsset.minAmount) / order.price) *
                  (long ? 1 : -1) -
                order.fee
              : (order.amount * order.price -
                  order.amount * current.entryPrice) *
                  (long ? 1 : -1) -
                order.fee
            current.profit += profit
            current.fee += order.fee
            const old = current.margin
            current.margin = 0
            locked = -old
            free = old + profit
            current.closePrice = order.price
            await this.orderModel.findOneAndUpdate(
              { externalId: order.externalId },
              { ...order },
            )
            this.unLockLeverage(order.user, order.symbol, order.positionSide)
          } else {
            const diffMargin = isCoinm(order.exchange)
              ? (current.positionAmt * symbol.quoteAsset.minAmount) /
                current.entryPrice /
                leverage
              : (current.positionAmt * current.entryPrice) / leverage
            const fee =
              (isCoinm(order.exchange)
                ? (current.positionAmt * symbol.quoteAsset.minAmount) /
                  order.price
                : current.positionAmt * order.price) * feePerc
            current.status = PositionStatus.closed
            const profit = isCoinm(order.exchange)
              ? ((current.positionAmt * symbol.quoteAsset.minAmount) /
                  current.entryPrice -
                  (current.positionAmt * symbol.quoteAsset.minAmount) /
                    order.price) *
                  (long ? 1 : -1) -
                fee
              : (current.positionAmt * order.price -
                  current.positionAmt * current.entryPrice) *
                  (long ? 1 : -1) -
                fee
            current.profit += profit
            locked = -diffMargin + (margin - diffMargin)
            free = diffMargin + profit + fee - order.fee - (margin - diffMargin)
            current.fee += fee
            current.margin -= diffMargin
            current.closePrice = order.price
            const position = await this.positionModel.create(
              this.createPositionFromOrder(
                order,
                leverage,
                margin - diffMargin,
                order.fee - fee,
                order.amount - current.positionAmt,
              ),
            )
            this.addPositionToWatchList(position)
          }
        } else {
          current.margin -= margin
          current.positionAmt -= order.amount
          const profit = isCoinm(order.exchange)
            ? ((order.amount * symbol.quoteAsset.minAmount) /
                current.entryPrice -
                (order.amount * symbol.quoteAsset.minAmount) / order.price) *
                (long ? 1 : -1) -
              order.fee
            : (order.amount * order.price - order.amount * current.entryPrice) *
                (long ? 1 : -1) -
              order.fee
          current.profit += profit
          current.fee += order.fee
          locked = -margin
          free = margin + profit
        }
      }
      if (current.status === PositionStatus.closed) {
        this.removePosition(current)
      } else {
        this.setPosition(current)
      }
      await this.positionModel.findOneAndUpdate(
        { uuid: current.uuid },
        {
          ...current,
          updatedAt: new Date(),
        },
      )
    }
    await this.updateBalance(order.user, {
      asset: isCoinm(order.exchange)
        ? symbol.baseAsset.name
        : symbol.quoteAsset.name,
      free,
      locked,
    })
  }

  private async updateBalance(
    user: Schema.Types.ObjectId | Types.ObjectId,
    ...data: { asset: string; free: number; locked: number }[]
  ) {
    if (!data.length) {
      return
    }
    await this.userService.increaseUserBalance(user, ...data).then(async () => {
      try {
        this.userGateway.sendBalanceToClient(
          user.toString(),
          await this.userService.getUserBalanceByUserIdOrThrow(
            user.toString(),
            data.map((d) => d.asset),
          ),
        )
      } catch (e) {
        Logger.error(`${e.message}`)
      }
    })
  }

  checkRedis(sym: string) {
    if (!this.watchSymbols.has(sym)) {
      this.redisClient?.subscribe(`trade@${sym}`, this.redisCb)
    }
  }

  unsubscribeRedis(sym: string) {
    this.redisClient?.unsubscribe(`trade@${sym}`, this.redisCb)
  }

  private async createLimitOrder(order: CreateOrderDto, user: UserDocument) {
    const symbol = await this.exchangeService.getExchangeInfo(
      order.symbol,
      order.exchange,
    )
    const quoteAssetAmount = order.amount * order.price

    const orderInDb = await this.orderModel.create({
      amount: order.amount,
      filledAmount: 0,
      filledQuoteAmount: 0,
      quoteAmount: quoteAssetAmount,
      price: order.price,
      avgFilledPrice: 0,
      fee: 0,
      feePerc: this.getUserFee('maker', order.exchange),
      symbol: order.symbol,
      user: user,
      exchange: order.exchange,
      status: OrderStatus.CREATED,
      type: order.type,
      side: order.side,
      externalId: order.externalId,
      reduceOnly: order.reduceOnly,
      positionSide: order.positionSide,
    })
    const balance: { asset: string; free: number; locked: number }[] = []
    if (!isFutures(order.exchange)) {
      if (order.side === 'SELL') {
        balance.push({
          free: -order.amount,
          asset: symbol.baseAsset.name,
          locked: order.amount,
        })
      } else {
        balance.push({
          free: -quoteAssetAmount,
          asset: symbol.quoteAsset.name,
          locked: quoteAssetAmount,
        })
      }
    }
    await this.updateBalance(user._id, ...balance)

    this.pushPosition(orderInDb)

    const sym = `${order.symbol}@${order.exchange}`
    this.checkRedis(sym)
    this.watchSymbols.set(
      sym,
      (this.watchSymbols.get(sym) ?? new Set()).add(order.externalId),
    )
    this.userGateway.sendOrderToClient(
      user.id,
      this.mapOrderDocumentToDataType(orderInDb),
    )
    return { orderId: orderInDb.id, status: orderInDb.status }
  }

  @IdMute(commonMutex, (position: PositionDataType) => position.uuid)
  private async closeFuturePosition(
    position: Omit<PositionDataType, 'user'> & { user: string },
  ) {
    if (!position || position.status !== PositionStatus.new) {
      return
    }
    let symbol: ExchangeInfo
    const sym = `${position.symbol}@${position.exchange}`
    const getSymbolFromMap = this.symbolsMap.get(sym)
    symbol = getSymbolFromMap?.data
    if (
      !getSymbolFromMap ||
      getSymbolFromMap?.time + 3 * 60 * 60 * 1000 < new Date().getTime()
    ) {
      symbol = await this.exchangeService.getExchangeInfo(
        position.symbol,
        position.exchange,
      )
      this.symbolsMap.set(sym, { data: symbol, time: new Date().getTime() })
    }
    try {
      const user = await this.userService.getUserByIdOrThrow(
        position.user.toString(),
      )

      const allSymbolReduceOrders = await this.orderModel.find({
        symbol: position.symbol,
        reduceOnly: true,
        user: user._id,
        status: {
          $nin: [OrderStatus.FILLED, OrderStatus.CANCELED, OrderStatus.EXPIRED],
        },
      })

      for (const o of allSymbolReduceOrders ?? []) {
        await this.cancelOrderByKeySecretExternalIdAndSymbol(
          user.key,
          user.secret,
          o.externalId,
          true,
        ).catch((e) => Logger.error(e))
      }

      const orderData: CreateOrderDto = {
        amount: position.positionAmt,
        price: position.liquidationPrice,
        symbol: position.symbol,
        exchange: position.exchange,
        side: position.positionSide === PositionSide.long ? 'SELL' : 'BUY',
        type: 'MARKET',
        reduceOnly: true,
        positionSide: position.positionSide,
        key: user.key,
        secret: user.secret,
        externalId: `liquidation_${v4()}`,
      }
      await this.createOrder(orderData)
    } catch (e) {
      Logger.error(
        `Catch error in close future position ${(e as Error)?.message}`,
      )
      if (`${(e as Error)?.message}` === 'User not found') {
        position.status = PositionStatus.closed
        this.removePosition(position)
        this.positionModel.updateOne(
          { uuid: position.uuid },
          { $set: { status: position.status, updatedAt: new Date() } },
        )
      }
    }
  }

  @IdMute(UpdateOrderMutex, (order: OrderDataType) => order.externalId)
  private async processLimitOrder(order: OrderDataType, data: Tick) {
    if (
      !order ||
      [OrderStatus.CANCELED, OrderStatus.FILLED, OrderStatus.EXPIRED].includes(
        order.status,
      )
    ) {
      return
    }
    const inCurrent = this.getOrderByExternalIdAndSymbol(
      order.symbol,
      order.externalId,
    )
    if (
      !inCurrent ||
      [OrderStatus.CANCELED, OrderStatus.FILLED, OrderStatus.EXPIRED].includes(
        inCurrent.status,
      )
    ) {
      Logger.error(`Order ${order.externalId} already processed`)
      return
    }
    const queries: Promise<any>[] = []
    let symbol: ExchangeInfo
    const sym = `${order.symbol}@${order.exchange}`
    const getSymbolFromMap = this.symbolsMap.get(sym)
    symbol = getSymbolFromMap?.data
    if (
      !getSymbolFromMap ||
      getSymbolFromMap?.time + 3 * 60 * 60 * 1000 < new Date().getTime()
    ) {
      symbol = await this.exchangeService.getExchangeInfo(
        order.symbol,
        order.exchange,
      )
      this.symbolsMap.set(sym, { data: symbol, time: new Date().getTime() })
    }
    let isFilled = false
    const feePerc = order.feePerc || this.getUserFee('maker', order.exchange)
    const futures = isFutures(order.exchange)
    if (
      order.side === 'SELL' &&
      order.price <= data.bestBid &&
      (futures || data.bidQty > 0)
    ) {
      let baseAssetAmount = order.amount - order.filledAmount
      if (futures || order.price < data.bestBid) {
        isFilled = true
      } else if (baseAssetAmount <= data.bidQty) {
        isFilled = true
      } else {
        baseAssetAmount = data.bidQty
      }
      const quoteAssetAmount = baseAssetAmount * order.price
      const fee = isCoinm(order.exchange)
        ? ((baseAssetAmount * symbol.quoteAsset.minAmount) / order.price) *
          feePerc
        : quoteAssetAmount * feePerc
      const status = isFilled
        ? OrderStatus.FILLED
        : OrderStatus.PARTIALLY_FILLED
      order = {
        ...order,
        status,
        filledAmount: order.filledAmount + baseAssetAmount,
        filledQuoteAmount: order.filledQuoteAmount + quoteAssetAmount,
        fee: order.fee + fee,
        avgFilledPrice: order.price,
        updatedAt: new Date(data.time),
        feePerc,
      }
      queries.push(
        this.orderModel
          .updateOne(
            { _id: order._id },
            {
              $inc: {
                filledAmount: baseAssetAmount,
                filledQuoteAmount: quoteAssetAmount,
                fee: fee,
              },
              avgFilledPrice: order.price,
              status,
              updatedAt: order.updatedAt,
            },
          )
          .exec()
          .then(async () => {
            this.userGateway.sendOrderToClient(order.user.toString(), order)
          }),
      )
      if (!futures) {
        queries.push(
          this.updateBalance(
            order.user,
            {
              free: quoteAssetAmount - fee,
              locked: 0,
              asset: symbol.quoteAsset.name,
            },
            {
              free: 0,
              asset: symbol.baseAsset.name,
              locked: -baseAssetAmount,
            },
          ),
        )
      }
      this.setOrder(order)
    } else if (
      order.side === 'BUY' &&
      order.price >= data.bestAsk &&
      (futures || data.askQty > 0)
    ) {
      let baseAssetAmount = order.amount - order.filledAmount
      if (futures || order.price > data.bestAsk) {
        isFilled = true
      } else if (baseAssetAmount <= data.askQty) {
        isFilled = true
      } else {
        baseAssetAmount = data.askQty
      }
      const quoteAssetAmount = baseAssetAmount * order.price
      const fee = isCoinm(order.exchange)
        ? ((baseAssetAmount * symbol.quoteAsset.minAmount) / order.price) *
          feePerc
        : isFutures(order.exchange)
          ? quoteAssetAmount * feePerc
          : baseAssetAmount * feePerc
      const status = isFilled
        ? OrderStatus.FILLED
        : OrderStatus.PARTIALLY_FILLED
      order = {
        ...order,
        status,
        filledAmount: order.filledAmount + baseAssetAmount,
        filledQuoteAmount: order.filledQuoteAmount + quoteAssetAmount,
        fee: order.fee + fee,
        avgFilledPrice: order.price,
        updatedAt: new Date(data.time),
        feePerc,
      }
      queries.push(
        this.orderModel
          .updateOne(
            { _id: order._id },
            {
              $inc: {
                filledAmount: baseAssetAmount,
                filledQuoteAmount: quoteAssetAmount,
                fee: fee,
              },
              avgFilledPrice: order.price,
              status,
              updatedAt: order.updatedAt,
            },
          )
          .exec()
          .then(async () => {
            this.userGateway.sendOrderToClient(order.user.toString(), order)
          }),
      )
      if (!futures) {
        queries.push(
          this.updateBalance(
            order.user,
            {
              free: baseAssetAmount - fee,
              locked: 0,
              asset: symbol.baseAsset.name,
            },
            {
              free: 0,
              asset: symbol.quoteAsset.name,
              locked: -quoteAssetAmount,
            },
          ),
        )
      }
      this.setOrder(order)
    }
    await Promise.all(queries)
    if (isFilled) {
      ;(this.watchSymbols.get(sym) ?? new Set()).delete(order.externalId)
      if ((this.watchSymbols.get(sym) ?? new Set()).size === 0) {
        this.watchSymbols.delete(sym)
        this.unsubscribeRedis(sym)
      }
      this.removeOrder(order)
      if (isFutures(order.exchange)) {
        try {
          const user = await this.userService.getUserByIdOrThrow(
            order.user.toString(),
          )
          const leverage = await this.leverageModel.findOne({
            user: user._id,
            exchange: order.exchange,
            symbol: order.symbol,
            side: order.positionSide,
          })
          await this.processFuturesPosition(
            order,
            leverage?.leverage ?? 1,
            symbol,
          )
        } catch (e) {
          Logger.error(
            `Catch error processing limit order ${(e as Error).message}`,
          )
        }
      }
    }
  }
  @IdMute(TickerMutex, ({ exchange }: { exchange: ExchangeEnum }) => exchange)
  private async processTickerQueue(data: {
    exchange: ExchangeEnum
    tickerData: Map<string, Tick>
  }) {
    const { exchange, tickerData } = data
    const positions = this.getOrdersBySymbols(
      Array.from(tickerData.keys()),
    ).filter(
      (o) =>
        o.exchange === exchange &&
        [OrderStatus.CREATED, OrderStatus.PARTIALLY_FILLED].includes(
          o.status,
        ) &&
        o.type === 'LIMIT',
    )
    const futures = this.getPositionsBySymbols(
      Array.from(tickerData.keys()),
    ).filter((p) => p.exchange === exchange && p.status === PositionStatus.new)
    for (const [symbol, data] of tickerData) {
      if (!data) {
        continue
      }
      const isFuturesExchange = isFutures(exchange)
      const filteredFutures = futures.filter((p) => p.symbol === symbol)

      const longPositions = filteredFutures
        .filter(
          (p) =>
            p.positionSide === PositionSide.long &&
            p.liquidationPrice >= data.bestBid,
        )
        .sort((a, b) => a.liquidationPrice - b.liquidationPrice)

      const shortPositions = filteredFutures
        .filter(
          (p) =>
            p.positionSide === PositionSide.short &&
            p.liquidationPrice <= data.bestAsk,
        )
        .sort((a, b) => b.liquidationPrice - a.liquidationPrice)

      for (const position of [...longPositions, ...shortPositions]) {
        this.closeFuturePosition(position)
      }

      const filterPositions = positions.filter((p) => p.symbol === symbol)

      const sellPositions = filterPositions
        .filter(
          (p) =>
            p.side === 'SELL' &&
            p.price <= data.bestBid &&
            (isFuturesExchange || data.bidQty > 0),
        )
        .sort((a, b) => a.price - b.price)
      const buyPositions = filterPositions
        .filter(
          (p) =>
            p.side === 'BUY' &&
            p.price >= data.bestAsk &&
            (isFuturesExchange || data.askQty > 0),
        )
        .sort((a, b) => b.price - a.price)
      for (const order of [...sellPositions, ...buyPositions]) {
        this.processLimitOrder(order, data)
      }
    }
  }

  private async processTickers(exchange: ExchangeEnum, tickers: Ticker[]) {
    const tickerData = new Map<string, Tick>()
    const tickerTime = tickers[0]?.eventTime ?? tickers[0]?.time ?? 0
    if (tickerTime < (this.tickerTimeMap.get(exchange) ?? 0)) {
      return
    }
    this.tickerTimeMap.set(exchange, tickerTime)
    const time = +new Date()
    for (const t of tickers) {
      const sym = `${t.symbol}@${exchange}`
      if ((this.watchSymbols.get(sym) ?? new Set()).size === 0) {
        continue
      }
      const tickerTime = t.eventTime ?? t.time
      if (tickerTime < (this.tickerTimeMap.get(sym) ?? 0)) {
        continue
      }

      if (tickerTime + this.newDataLimit < time) {
        this.tickerTimeMap.set(sym, time)
        this.symbolPriceMap.delete(sym)

        Logger.warn(`${sym} outdated ticker ${time - tickerTime} ms`)

        continue
      }
      this.tickerTimeMap.set(sym, tickerTime)
      const signature = `${t.bestAsk}${t.bestBid}${t.bestAskQnt}${t.bestBidQnt}${t.price}`
      if (this.tickerSignatureMap.get(sym) === signature) {
        continue
      }
      this.tickerSignatureMap.set(sym, signature)
      this.symbolPriceMap.set(sym, t.price)
      tickerData.set(t.symbol, {
        bestBid: +t.bestBid,
        bestAsk: +t.bestAsk,
        askQty: +t.bestAskQnt,
        bidQty: +t.bestBidQnt,
        time: t.eventTime ?? t.time,
      })
    }
    if (tickerData.size) {
      await this.processTickerQueue({ exchange, tickerData })
    }
  }
}
