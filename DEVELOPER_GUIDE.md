# Developer Guide - Paper Trading Exchange Simulator

This comprehensive guide covers the architecture, implementation details, and advanced features of the Paper Trading Exchange Simulator based on the actual codebase.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Components](#core-components)
- [Order Processing System](#order-processing-system)
- [Futures Trading Implementation](#futures-trading-implementation)
- [Exchange Integration](#exchange-integration)
- [WebSocket Real-time Updates](#websocket-real-time-updates)
- [Database Schema Design](#database-schema-design)
- [Balance Management](#balance-management)
- [Advanced Features](#advanced-features)
- [Performance Optimization](#performance-optimization)
- [API Reference](#api-reference)

## Architecture Overview

The Paper Trading Exchange Simulator is built as a comprehensive NestJS application that simulates real cryptocurrency exchange functionality. It supports both spot and futures trading across multiple exchanges with real-time price updates and order matching.

### System Architecture

```
┌─────────────────────────────────────────┐
│           Client Applications            │
│     • Web Dashboard                     │
│     • Trading Bots                      │
│     • Mobile Apps                       │
└─────────────┬───────────────────────────┘
              │ HTTP/REST + WebSocket
┌─────────────▼───────────────────────────┐
│        Paper Trading Service            │
│  ┌─────────────┐ ┌─────────────────────┐│
│  │ Order       │ │   Exchange          ││
│  │ Processing  │ │   Connector         ││
│  │             │ │                     ││
│  │ ┌─────────┐ │ │ ┌─────────────────┐ ││
│  │ │ Spot    │ │ │ │ Market Data     │ ││
│  │ │ Trading │ │ │ │ Integration     │ ││
│  │ └─────────┘ │ │ └─────────────────┘ ││
│  │ ┌─────────┐ │ │                     ││
│  │ │ Futures │ │ │ ┌─────────────────┐ ││
│  │ │ Trading │ │ │ │ Real-time       │ ││
│  │ └─────────┘ │ │ │ Ticker Data     │ ││
│  └─────────────┘ │ └─────────────────┘ ││
│  ┌─────────────┐ │                     ││
│  │ Balance     │ │                     ││
│  │ Management  │ │                     ││
│  └─────────────┘ │                     ││
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│          Data Layer                     │
│  ┌─────────────┐ ┌─────────────────────┐│
│  │ MongoDB     │ │   Redis Cache       ││
│  │ • Orders    │ │   • Ticker Data     ││
│  │ • Positions │ │   • Price Cache     ││
│  │ • Users     │ │   • Session Data    ││
│  │ • Balances  │ │                     ││
│  └─────────────┘ └─────────────────────┘│
└─────────────────────────────────────────┘
```

### Technology Stack

- **Framework**: NestJS with TypeScript
- **Database**: MongoDB with Mongoose ODM
- **Caching**: Redis for real-time data and session management
- **WebSockets**: Socket.IO for real-time client updates
- **Scheduling**: NestJS Schedule for background tasks
- **Validation**: class-validator and class-transformer
- **Testing**: Jest for unit and integration tests

## Core Components

### Application Module Structure

```typescript
// src/app.module.ts
@Module({
  imports: [
    HealthModule,                    // Health checks and monitoring
    ScheduleModule.forRoot(),        // Background task scheduling
    MongooseModule.forRootAsync({    // Database connection
      useFactory: async (configService: ConfigService) => ({
        uri: configService.getMongoUri()
      }),
      inject: [ConfigService]
    }),
    UserModule,                      // User management and authentication
    UserGatewayModule,               // WebSocket connections
    OrderModule,                     // Order processing and management
    ExchangeModule,                  // Exchange integrations and market data
  ],
})
export class AppModule {}
```

### Service Layer Architecture

#### 1. Exchange Service

Handles all exchange-related operations and market data:

```typescript
// src/exchange/exchange.service.ts
export class ExchangeService {
  constructor(
    @InjectModel(Symbol.name) private symbolModel: Model<SymbolDocument>
  ) {}

  async getLatestPriceInExchange(
    exchange: ExchangeEnum,
    symbol: string,
  ): Promise<BaseReturn<number>> {
    return this.getExchange(exchange).latestPrice(symbol)
  }

  async getExchangeInfo(
    symbol: string,
    exchange: ExchangeEnum,
  ): Promise<ExchangeInfo> {
    // Check database cache first
    let symbolData = await this.symbolModel.findOne({ pair: symbol, exchange })
    
    if (!symbolData) {
      // Fetch from exchange API
      symbolData = await this.getExchange(exchange).getExchangeInfo(symbol)
      // Cache in database for future requests
    }
    
    return symbolData.data
  }

  private getExchange(exchange: ExchangeEnum): AbstractExchange {
    return new Exchange(exchange)
  }
}
```

#### 2. Order Service

Core business logic for order processing and execution:

```typescript
// src/order/order.service.ts
export class OrderService implements OnModuleInit {
  private readonly watchSymbols: Map<string, Set<string>> = new Map()
  private currentOrders: CurrentOrders = new Map()
  private currentPositions: CurrentPositions = new Map()
  
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Position.name) private positionModel: Model<PositionDocument>,
    @Inject(UserService) private userService: UserService,
    @Inject(ExchangeService) private exchangeService: ExchangeService,
    @Inject(UserGateway) private userGateway: UserGateway,
  ) {}

  async onModuleInit() {
    // Load existing orders and positions into memory
    const ordersAndPositions = await this.getOpenOrdersAndPositions()
    this.updateBalances(ordersAndPositions.orders, ordersAndPositions.positions)
    
    // Initialize Redis connections for real-time data
    this.redisClient = await RedisClient.getInstance(true, 'common')
    
    // Subscribe to ticker updates
    const keys = [...this.watchSymbols.keys()].map(k => `trade@${k}`)
    for (const k of keys) {
      this.redisClient.subscribe(k, this.redisCb)
    }
  }
}
```

## Order Processing System

### Order Lifecycle

The order processing system handles both spot and futures orders with sophisticated matching logic:

```typescript
// Order creation flow
async createOrder(order: CreateOrderDto): Promise<CreateOrderResponse> {
  // 1. Validate user credentials
  const user = await this.userService.getUserByKeyAndSecretOrThrow(
    order.key, order.secret
  )
  
  // 2. Get symbol information and validate
  const symbol = await this.exchangeService.getExchangeInfo(
    order.symbol, order.exchange
  )
  
  // 3. Check user balances
  const balance = await this.userService.getUserBalanceByUserIdOrThrow(
    user.id, [symbol.baseAsset.name, symbol.quoteAsset.name]
  )
  
  // 4. Determine order type (market vs limit)
  const currentPrice = await this.getLatestPriceInExchange(
    order.symbol, order.exchange
  )
  
  order.type = this.determineOrderType(order, currentPrice)
  
  // 5. Process based on order type
  if (order.type === 'MARKET') {
    return this.processMarketOrder(order, user, leverage)
  } else {
    return this.createLimitOrder(order, user)
  }
}
```

### Market Order Processing

Market orders are executed immediately at current market price:

```typescript
private async processMarketOrder(
  order: CreateOrderDto,
  user: UserDocument,
  leverage: number
): Promise<CreateOrderResponse> {
  const currentPrice = await this.getLatestPriceInExchange(
    order.symbol, order.exchange
  )

  const symbol = await this.exchangeService.getExchangeInfo(
    order.symbol, order.exchange
  )

  // Calculate amounts and fees
  const quoteAssetAmount = order.amount * currentPrice
  const feePerc = this.getUserFee('taker', order.exchange)
  
  let fee = 0
  if (isFutures(order.exchange)) {
    fee = isCoinm(order.exchange) 
      ? (order.amount * symbol.quoteAsset.minAmount) / currentPrice * feePerc
      : quoteAssetAmount * feePerc
  } else {
    fee = order.side === 'SELL' 
      ? quoteAssetAmount * feePerc 
      : order.amount * feePerc
  }

  // Create filled order record
  const orderData = {
    amount: order.amount,
    filledAmount: order.amount,
    filledQuoteAmount: quoteAssetAmount,
    price: currentPrice,
    avgFilledPrice: currentPrice,
    fee,
    status: OrderStatus.FILLED,
    // ... other fields
  }

  const orderInDb = await this.orderModel.create(orderData)

  // Handle balance updates
  if (isFutures(order.exchange)) {
    await this.processFuturesPosition(orderInDb, leverage, symbol)
  } else {
    await this.updateSpotBalances(order, symbol, fee)
  }

  // Send real-time update to client
  this.userGateway.sendOrderToClient(user.id, orderData)

  return { orderId: orderInDb.id, status: orderInDb.status }
}
```

### Limit Order Processing

Limit orders are stored and matched against incoming ticker data:

```typescript
private async createLimitOrder(
  order: CreateOrderDto, 
  user: UserDocument
): Promise<CreateOrderResponse> {
  // Create pending order in database
  const orderInDb = await this.orderModel.create({
    amount: order.amount,
    filledAmount: 0,
    price: order.price,
    status: OrderStatus.CREATED,
    type: 'LIMIT',
    // ... other fields
  })

  // Lock required balance for spot trading
  if (!isFutures(order.exchange)) {
    const balance = order.side === 'SELL' 
      ? { asset: symbol.baseAsset.name, free: -order.amount, locked: order.amount }
      : { asset: symbol.quoteAsset.name, free: -(order.amount * order.price), locked: order.amount * order.price }
    
    await this.updateBalance(user._id, balance)
  }

  // Add to in-memory tracking for efficient matching
  this.setOrder(this.mapOrderDocumentToDataType(orderInDb))

  // Subscribe to ticker updates for this symbol
  const sym = `${order.symbol}@${order.exchange}`
  this.watchSymbols.set(sym, (this.watchSymbols.get(sym) ?? new Set()).add(order.externalId))
  this.checkRedis(sym)

  return { orderId: orderInDb.id, status: orderInDb.status }
}
```

### Real-time Order Matching

Orders are matched against incoming ticker data from Redis:

```typescript
private async processLimitOrder(order: OrderDataType, data: Tick) {
  if ([OrderStatus.CANCELED, OrderStatus.FILLED, OrderStatus.EXPIRED].includes(order.status)) {
    return
  }

  const symbol = await this.exchangeService.getExchangeInfo(order.symbol, order.exchange)
  let isFilled = false
  const feePerc = this.getUserFee('maker', order.exchange)

  // Check if order can be filled
  if (order.side === 'SELL' && order.price <= data.bestBid) {
    let fillAmount = order.amount - order.filledAmount
    
    // Determine fill quantity based on order book depth
    if (!isFutures(order.exchange) && fillAmount > data.bidQty) {
      fillAmount = data.bidQty
    } else {
      isFilled = true
    }

    // Calculate fill values
    const quoteAmount = fillAmount * order.price
    const fee = this.calculateFee(fillAmount, quoteAmount, symbol, order.exchange, feePerc)

    // Update order
    order.filledAmount += fillAmount
    order.filledQuoteAmount += quoteAmount
    order.fee += fee
    order.status = isFilled ? OrderStatus.FILLED : OrderStatus.PARTIALLY_FILLED

    // Update database and balances
    await this.updateOrderInDatabase(order, fillAmount, quoteAmount, fee)
    await this.updateBalanceAfterFill(order, fillAmount, quoteAmount, fee, symbol)

    // Send real-time update
    this.userGateway.sendOrderToClient(order.user.toString(), order)
  }
  // Similar logic for BUY orders...

  // Handle order completion
  if (isFilled) {
    this.removeOrderFromTracking(order)
    
    if (isFutures(order.exchange)) {
      await this.processFuturesPosition(order, leverage, symbol)
    }
  }
}
```

## Futures Trading Implementation

### Position Management

Futures trading involves complex position management with margin, leverage, and liquidation:

```typescript
// src/schema/positions.schema.ts
export interface PositionDataType {
  symbol: string
  margin: number                    // Locked margin amount
  liquidationPrice: number          // Price at which position is liquidated
  entryPrice: number               // Average entry price
  positionSide: PositionSide       // LONG, SHORT, or BOTH
  positionAmt: number              // Position size
  leverage: number                 // Applied leverage
  profit: number                   // Unrealized P&L
  fee: number                      // Accumulated fees
  status: PositionStatus           // NEW or CLOSED
  uuid: string                     // Unique position identifier
  closePrice: number               // Price at position close
}

export enum PositionSide {
  long = 'LONG',
  short = 'SHORT', 
  both = 'BOTH'
}

export enum PositionStatus {
  new = 'NEW',
  closed = 'CLOSED'
}
```

### Position Creation and Updates

```typescript
private async processFuturesPosition(
  order: OrderDataType,
  leverage: number,
  symbol: ExchangeInfo
) {
  const hedge = await this.getHedgeMode(order.user)
  const existingPosition = this.findExistingPosition(order, hedge)

  // Calculate margin requirement
  const margin = isCoinm(order.exchange)
    ? (order.amount * symbol.quoteAsset.minAmount) / order.price / leverage
    : (order.amount * order.price) / leverage

  if (!existingPosition) {
    // Create new position
    const position = await this.positionModel.create({
      symbol: order.symbol,
      margin,
      entryPrice: order.price,
      liquidationPrice: this.calculateLiquidationPrice(
        order.price, 
        order.side === 'BUY' ? PositionSide.long : PositionSide.short,
        this.getUserFee('taker', order.exchange),
        leverage
      ),
      positionSide: order.side === 'BUY' ? PositionSide.long : PositionSide.short,
      positionAmt: order.amount,
      user: order.user,
      exchange: order.exchange,
      leverage,
      profit: -order.fee,
      uuid: v4()
    })

    this.addPositionToWatchList(position)
    await this.lockLeverage(order.user, order.symbol, order.positionSide)
    
  } else {
    await this.updateExistingPosition(existingPosition, order, leverage, symbol)
  }

  // Update user balance with margin requirements
  await this.updateBalance(order.user, {
    asset: isCoinm(order.exchange) ? symbol.baseAsset.name : symbol.quoteAsset.name,
    free: -margin - order.fee,
    locked: margin
  })
}
```

### Liquidation System

Positions are monitored for liquidation conditions:

```typescript
private liquidationPrice(
  entryPrice: number,
  positionSide: PositionSide,
  fee: number,
  leverage: number
): number {
  return entryPrice * (
    leverage > 1
      ? (1 + (1 / leverage) * (positionSide === PositionSide.long ? -1 : 1)) *
        (1 + fee * (positionSide === PositionSide.long ? -1 : 1))
      : positionSide === PositionSide.long ? fee : 1 / fee
  )
}

private async checkLiquidationConditions(positions: PositionDataType[], tickerData: Map<string, Tick>) {
  for (const [symbol, data] of tickerData) {
    const symbolPositions = positions.filter(p => p.symbol === symbol)

    // Check long positions for liquidation (price drops below liquidation price)
    const longPositions = symbolPositions
      .filter(p => 
        p.positionSide === PositionSide.long && 
        p.liquidationPrice >= data.bestBid
      )
      .sort((a, b) => a.liquidationPrice - b.liquidationPrice)

    // Check short positions for liquidation (price rises above liquidation price)  
    const shortPositions = symbolPositions
      .filter(p => 
        p.positionSide === PositionSide.short && 
        p.liquidationPrice <= data.bestAsk
      )
      .sort((a, b) => b.liquidationPrice - a.liquidationPrice)

    // Execute liquidations
    for (const position of [...longPositions, ...shortPositions]) {
      await this.liquidatePosition(position)
    }
  }
}

private async liquidatePosition(position: PositionDataType) {
  try {
    const user = await this.userService.getUserByIdOrThrow(position.user)

    // Cancel any existing reduce-only orders for this position
    await this.cancelReduceOnlyOrders(user, position.symbol)

    // Create market order to close position at liquidation price
    const liquidationOrder: CreateOrderDto = {
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
      externalId: `liquidation_${v4()}`
    }

    await this.createOrder(liquidationOrder)
    
  } catch (error) {
    Logger.error(`Liquidation failed for position ${position.uuid}:`, error)
  }
}
```

### Hedge Mode Support

Support for both hedge and one-way position modes:

```typescript
// src/schema/hedge.schema.ts
@Schema()
export class Hedge {
  @Prop({ type: Schema.Types.ObjectId, ref: 'User' })
  user: Schema.Types.ObjectId

  @Prop({ default: false })
  hedge: boolean // true = hedge mode, false = one-way mode
}

// Position side determination based on hedge mode
private determinePositionSide(order: CreateOrderDto, hedgeMode: boolean): PositionSide {
  if (hedgeMode) {
    // In hedge mode, position side must be explicitly specified
    if (!order.positionSide || order.positionSide === PositionSide.both) {
      throw new HttpException('Position side must be specified in hedge mode', 400)
    }
    return order.positionSide
  } else {
    // In one-way mode, position side is determined by order side
    return PositionSide.both
  }
}
```

## Exchange Integration

### Abstract Exchange Interface

All exchanges implement the same interface for consistent behavior:

```typescript
// src/exchange/abstractExchange.ts
abstract class AbstractExchange implements Exchange {
  /** Calculate price precision from price string */
  getPricePrecision(price: string): number {
    let use = price
    
    // Handle exponential notation (e.g., "1e-7")
    if (price.indexOf('e-') !== -1) {
      use = Number(price).toFixed(parseFloat(price.split('e-')[1]))
    }
    
    // Handle decimal precision (e.g., "0.00025")
    if (use.indexOf('1') === -1) {
      const dec = use.replace('0.', '')
      const numbers = dec.replace(/0/g, '')
      const place = dec.indexOf(numbers)
      
      if (place <= 1) return place
      use = `0.${'0'.repeat(place - 1)}1`
    }
    
    return use.indexOf('1') === 0 ? 0 : use.replace('0.', '').indexOf('1') + 1
  }

  returnBad() {
    return (e: Error) => ({
      status: StatusEnum.notok,
      reason: e.message,
      data: null,
    })
  }

  // Abstract methods that each exchange must implement
  abstract latestPrice(symbol: string): Promise<BaseReturn<number>>
  abstract getExchangeInfo(symbol: string): Promise<BaseReturn<ExchangeInfo>>
  abstract getAllExchangeInfo(): Promise<BaseReturn<(ExchangeInfo & { pair: string })[]>>
  abstract getCandles(/* params */): Promise<BaseReturn<CandleResponse[]>>
  abstract getTrades(/* params */): Promise<BaseReturn<TradeResponse[]>>
  abstract getAllPrices(): Promise<BaseReturn<AllPricesResponse[]>>
}
```

### Exchange Factory Pattern

```typescript
// src/exchange/exchange.ts
export default class Exchange extends AbstractExchange {
  constructor(private readonly exchange: ExchangeEnum) {
    super()
  }

  async latestPrice(symbol: string): Promise<BaseReturn<number>> {
    return this.getConnector().latestPrice(symbol)
  }

  private getConnector(): AbstractExchange {
    switch (this.exchange) {
      case ExchangeEnum.binance:
      case ExchangeEnum.binanceUsdm:
      case ExchangeEnum.binanceCoinm:
        return new BinanceConnector(this.exchange)
      
      case ExchangeEnum.bybit:
      case ExchangeEnum.bybitUsdm:
      case ExchangeEnum.bybitCoinm:
        return new BybitConnector(this.exchange)
        
      case ExchangeEnum.kucoin:
      case ExchangeEnum.kucoinLinear:
      case ExchangeEnum.kucoinInverse:
        return new KucoinConnector(this.exchange)
        
      // Add other exchanges...
      
      default:
        throw new Error(`Unsupported exchange: ${this.exchange}`)
    }
  }
}
```

### Exchange Implementation Example

```typescript
// Example Binance connector implementation
export class BinanceConnector extends AbstractExchange {
  private baseUrl: string
  
  constructor(private exchange: ExchangeEnum) {
    super()
    this.baseUrl = this.getBaseUrl(exchange)
  }

  async latestPrice(symbol: string): Promise<BaseReturn<number>> {
    try {
      const response = await fetch(`${this.baseUrl}/ticker/price?symbol=${symbol}`)
      const data = await response.json()
      
      return {
        status: StatusEnum.ok,
        data: parseFloat(data.price),
        reason: null
      }
    } catch (error) {
      return this.returnBad()(error)
    }
  }

  async getExchangeInfo(symbol: string): Promise<BaseReturn<ExchangeInfo>> {
    try {
      const response = await fetch(`${this.baseUrl}/exchangeInfo`)
      const data = await response.json()
      
      const symbolInfo = data.symbols.find(s => s.symbol === symbol)
      if (!symbolInfo) {
        throw new Error(`Symbol ${symbol} not found`)
      }

      return {
        status: StatusEnum.ok,
        data: {
          baseAsset: {
            name: symbolInfo.baseAsset,
            minAmount: parseFloat(symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE')?.minQty || '0')
          },
          quoteAsset: {
            name: symbolInfo.quoteAsset,
            minAmount: parseFloat(symbolInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL')?.minNotional || '0')
          },
          priceAssetPrecision: this.getPricePrecision(symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize || '1'),
          priceMultiplier: symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize || '1',
          maxOrders: symbolInfo.filters.find(f => f.filterType === 'MAX_NUM_ORDERS')?.maxNumOrders || 200
        },
        reason: null
      }
    } catch (error) {
      return this.returnBad()(error)
    }
  }

  private getBaseUrl(exchange: ExchangeEnum): string {
    switch (exchange) {
      case ExchangeEnum.binance:
        return 'https://api.binance.com/api/v3'
      case ExchangeEnum.binanceUsdm:
        return 'https://fapi.binance.com/fapi/v1'
      case ExchangeEnum.binanceCoinm:
        return 'https://dapi.binance.com/dapi/v1'
      default:
        throw new Error(`Unknown Binance exchange type: ${exchange}`)
    }
  }
}
```

## WebSocket Real-time Updates

### WebSocket Gateway Implementation

```typescript
// src/ws/user.gateway.ts
@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class UserGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server

  private clients: Map<string, Socket> = new Map()

  afterInit(server: Server) {
    Logger.log('WebSocket Gateway initialized')
  }

  handleConnection(client: Socket, ...args: any[]) {
    const userId = this.extractUserId(client)
    if (userId) {
      this.clients.set(userId, client)
      Logger.log(`Client ${userId} connected`)
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.findUserIdByClient(client)
    if (userId) {
      this.clients.delete(userId)
      Logger.log(`Client ${userId} disconnected`)
    }
  }

  sendOrderToClient(userId: string, order: OrderDataType) {
    const client = this.clients.get(userId)
    if (client) {
      client.emit('orderUpdate', {
        eventType: 'executionReport',
        symbol: order.symbol,
        orderId: order._id.toString(),
        clientOrderId: order.externalId,
        side: order.side,
        orderStatus: order.status,
        orderType: order.type,
        price: order.price.toString(),
        quantity: order.amount.toString(),
        executedQty: order.filledAmount.toString(),
        timestamp: order.updatedAt.getTime()
      })
    }
  }

  sendBalanceToClient(userId: string, balance: UserBalance) {
    const client = this.clients.get(userId)
    if (client) {
      client.emit('balanceUpdate', {
        eventType: 'balanceUpdate',
        balances: balance.balance.map(b => ({
          asset: b.asset,
          free: b.free.toString(),
          locked: b.locked.toString()
        })),
        timestamp: Date.now()
      })
    }
  }

  sendPositionToClient(userId: string, position: PositionDataType) {
    const client = this.clients.get(userId)
    if (client) {
      client.emit('positionUpdate', {
        eventType: 'positionUpdate',
        symbol: position.symbol,
        positionSide: position.positionSide,
        positionAmt: position.positionAmt.toString(),
        entryPrice: position.entryPrice.toString(),
        liquidationPrice: position.liquidationPrice.toString(),
        unrealizedProfit: position.profit.toString(),
        timestamp: Date.now()
      })
    }
  }

  private extractUserId(client: Socket): string | null {
    // Extract user ID from connection query, headers, or authentication
    return client.handshake.query.userId as string
  }
}
```

### Real-time Data Flow

```typescript
// Redis ticker data processing
redisCb(msg: string) {
  const tickerData = JSON.parse(msg) as Ticker & { exchange: ExchangeEnum }
  this.processTickers(tickerData.exchange, [tickerData])
}

private async processTickers(exchange: ExchangeEnum, tickers: Ticker[]) {
  const tickerData = new Map<string, Tick>()
  const tickerTime = tickers[0]?.eventTime ?? tickers[0]?.time ?? 0
  
  // Prevent processing of outdated data
  if (tickerTime < (this.tickerTimeMap.get(exchange) ?? 0)) {
    return
  }
  
  this.tickerTimeMap.set(exchange, tickerTime)
  
  // Process each ticker
  for (const ticker of tickers) {
    const sym = `${ticker.symbol}@${exchange}`
    
    // Only process symbols we're watching
    if ((this.watchSymbols.get(sym) ?? new Set()).size === 0) {
      continue
    }
    
    // Check for data freshness
    const tickerTime = ticker.eventTime ?? ticker.time
    if (tickerTime + this.newDataLimit < Date.now()) {
      Logger.warn(`${sym} outdated ticker ${Date.now() - tickerTime} ms`)
      continue
    }
    
    // Cache latest price
    this.symbolPriceMap.set(sym, ticker.price)
    
    // Prepare tick data for order matching
    tickerData.set(ticker.symbol, {
      bestBid: +ticker.bestBid,
      bestAsk: +ticker.bestAsk,
      askQty: +ticker.bestAskQnt,
      bidQty: +ticker.bestBidQnt,
      time: ticker.eventTime ?? ticker.time
    })
  }
  
  if (tickerData.size) {
    await this.processTickerQueue({ exchange, tickerData })
  }
}
```

## Database Schema Design

### Order Schema

```typescript
// src/schema/order.schema.ts
@Schema({ timestamps: true })
export class Order {
  @Prop({ required: true })
  amount: number

  @Prop({ required: true })
  quoteAmount: number

  @Prop({ default: 0 })
  filledAmount: number

  @Prop({ default: 0 })
  filledQuoteAmount: number

  @Prop({ required: true })
  price: number

  @Prop({ default: 0 })
  avgFilledPrice: number

  @Prop({ default: 0 })
  fee: number

  @Prop({ required: true })
  symbol: string

  @Prop({ type: Schema.Types.ObjectId, ref: 'User' })
  user: Schema.Types.ObjectId

  @Prop({ required: true, enum: ExchangeEnum })
  exchange: ExchangeEnum

  @Prop({ required: true, enum: OrderStatus })
  status: OrderStatus

  @Prop({ required: true, enum: OrderType })
  type: OrderType

  @Prop({ required: true, enum: OrderSide })
  side: OrderSide

  @Prop({ required: true, unique: true })
  externalId: string

  @Prop({ default: false })
  reduceOnly: boolean

  @Prop({ enum: PositionSide })
  positionSide?: PositionSide
}

// Indexes for performance
OrderSchema.index({ user: 1, symbol: 1, status: 1 })
OrderSchema.index({ externalId: 1 }, { unique: true })
OrderSchema.index({ symbol: 1, exchange: 1, status: 1 })
OrderSchema.index({ createdAt: -1 })
```

### Position Schema

```typescript
// src/schema/positions.schema.ts
@Schema({ timestamps: true })
export class Position {
  @Prop({ required: true })
  symbol: string

  @Prop({ required: true })
  margin: number

  @Prop({ required: true })
  liquidationPrice: number

  @Prop({ required: true })
  entryPrice: number

  @Prop({ required: true, enum: PositionSide })
  positionSide: PositionSide

  @Prop({ required: true })
  positionAmt: number

  @Prop({ type: Schema.Types.ObjectId, ref: 'User' })
  user: Schema.Types.ObjectId

  @Prop({ required: true, enum: ExchangeEnum })
  exchange: ExchangeEnum

  @Prop({ required: true, enum: PositionStatus })
  status: PositionStatus

  @Prop({ default: 0 })
  profit: number

  @Prop({ default: 0 })
  fee: number

  @Prop({ required: true })
  leverage: number

  @Prop({ required: true, unique: true })
  uuid: string

  @Prop({ default: 0 })
  closePrice: number
}

// Indexes for efficient querying
PositionSchema.index({ user: 1, symbol: 1, status: 1 })
PositionSchema.index({ uuid: 1 }, { unique: true })
PositionSchema.index({ symbol: 1, exchange: 1, status: 1 })
PositionSchema.index({ status: 1, liquidationPrice: 1 })
```

### User and Balance Schema

```typescript
// src/schema/user.schema.ts
@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true })
  key: string

  @Prop({ required: true })
  secret: string

  @Prop({ type: [BalanceSchema], default: [] })
  balance: Balance[]
}

@Schema()
export class Balance {
  @Prop({ required: true })
  asset: string

  @Prop({ required: true, default: 0 })
  free: number

  @Prop({ required: true, default: 0 })
  locked: number
}

// Compound indexes
UserSchema.index({ key: 1, secret: 1 }, { unique: true })
UserSchema.index({ 'balance.asset': 1 })
```

## Balance Management

### Balance Update System

```typescript
async updateBalance(
  user: Schema.Types.ObjectId | Types.ObjectId,
  ...balanceUpdates: { asset: string; free: number; locked: number }[]
): Promise<void> {
  if (!balanceUpdates.length) return

  // Update balances atomically
  await this.userService.increaseUserBalance(user, ...balanceUpdates)

  // Send real-time update to client
  try {
    const updatedBalance = await this.userService.getUserBalanceByUserIdOrThrow(
      user.toString(),
      balanceUpdates.map(update => update.asset)
    )
    
    this.userGateway.sendBalanceToClient(user.toString(), updatedBalance)
  } catch (error) {
    Logger.error(`Failed to send balance update: ${error.message}`)
  }
}

// Atomic balance operations in UserService
async increaseUserBalance(
  userId: string | Schema.Types.ObjectId,
  ...updates: { asset: string; free: number; locked: number }[]
): Promise<void> {
  const user = await this.userModel.findById(userId)
  if (!user) throw new HttpException('User not found', 404)

  for (const update of updates) {
    const balanceIndex = user.balance.findIndex(b => b.asset === update.asset)
    
    if (balanceIndex >= 0) {
      // Update existing balance
      user.balance[balanceIndex].free += update.free
      user.balance[balanceIndex].locked += update.locked
    } else {
      // Create new balance entry
      user.balance.push({
        asset: update.asset,
        free: Math.max(0, update.free),
        locked: Math.max(0, update.locked)
      })
    }
  }

  await user.save()
}
```

### Balance Validation and Recovery

```typescript
private async updateBalances(orders?: OrderDocument[], positions?: PositionDocument[]) {
  const lockedBalances: Map<string, Map<string, number>> = new Map()

  // Calculate expected locked balances from orders
  for (const order of orders || []) {
    if (isFutures(order.exchange)) continue

    const userId = order.user.toString()
    const userBalances = lockedBalances.get(userId) ?? new Map()
    const symbol = await this.exchangeService.getExchangeInfo(order.symbol, order.exchange)
    
    const asset = order.side === 'BUY' ? symbol.quoteAsset.name : symbol.baseAsset.name
    const lockedAmount = order.side === 'BUY' 
      ? order.quoteAmount - order.filledQuoteAmount
      : order.amount - order.filledAmount
    
    userBalances.set(asset, (userBalances.get(asset) ?? 0) + lockedAmount)
    lockedBalances.set(userId, userBalances)
  }

  // Calculate expected locked balances from futures positions
  for (const position of positions || []) {
    const userId = position.user.toString()
    const userBalances = lockedBalances.get(userId) ?? new Map()
    const symbol = await this.exchangeService.getExchangeInfo(position.symbol, position.exchange)
    
    const asset = isCoinm(position.exchange) ? symbol.baseAsset.name : symbol.quoteAsset.name
    
    userBalances.set(asset, (userBalances.get(asset) ?? 0) + position.margin)
    lockedBalances.set(userId, userBalances)
  }

  // Reconcile with actual user balances
  const users = await this.userService.getAllUsersOrThrow()
  
  for (const user of users) {
    const expectedLocked = lockedBalances.get(user.id) ?? new Map()
    const actualBalance = await this.userService.getUserBalanceByUserIdOrThrow(user.id)
    
    for (const balance of actualBalance.balance) {
      const expectedLockedAmount = expectedLocked.get(balance.asset) ?? 0
      
      if (expectedLockedAmount !== balance.locked) {
        const difference = balance.locked - expectedLockedAmount
        
        Logger.warn(`Balance mismatch for user ${user.id}, asset ${balance.asset}`, {
          expected: expectedLockedAmount,
          actual: balance.locked,
          difference
        })

        // Correct the balance
        await this.updateBalance(user._id, {
          asset: balance.asset,
          free: difference,
          locked: -difference
        })
      }
    }
  }
}
```

## Advanced Features

### Thread Safety with Mutex

```typescript
// src/utils/mutex.ts
export class IdMutex {
  private locks = new Map<string, Promise<void>>()

  async acquire(id: string): Promise<() => void> {
    // Wait for existing lock to release
    while (this.locks.has(id)) {
      await this.locks.get(id)
    }

    let release: () => void
    const promise = new Promise<void>(resolve => {
      release = resolve
    })

    this.locks.set(id, promise)

    return () => {
      this.locks.delete(id)
      release!()
    }
  }

  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire(id)
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

// Decorator for automatic mutex application
export function IdMute<T extends any[], R>(
  mutex: IdMutex,
  keyFn: (...args: T) => string
) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value

    descriptor.value = async function (...args: T): Promise<R> {
      const key = keyFn(...args)
      return mutex.withLock(key, () => method.apply(this, args))
    }
  }
}

// Usage in OrderService
const CreateOrderMutex = new IdMutex()

@IdMute(
  CreateOrderMutex,
  (order: CreateOrderDto) => `${order.key}-${order.secret}-${order.symbol}-${order.exchange}`
)
async createOrder(order: CreateOrderDto): Promise<CreateOrderResponse> {
  // Thread-safe order creation logic
}
```

### Mathematical Utilities

```typescript
// src/utils/math.ts
export class MathHelper {
  round(num: number, decimals: number): number {
    const multiplier = Math.pow(10, decimals)
    return Math.round(num * multiplier) / multiplier
  }

  precise(num: number, precision: number): string {
    return num.toFixed(precision)
  }

  percentage(value: number, total: number): number {
    return total === 0 ? 0 : (value / total) * 100
  }

  compound(principal: number, rate: number, periods: number): number {
    return principal * Math.pow(1 + rate, periods)
  }
}
```

### Redis Integration

```typescript
// src/utils/redis.ts
export interface RedisWrapper {
  subscribe(channel: string, callback: (message: string) => void): void
  unsubscribe(channel: string, callback: (message: string) => void): void
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttl?: number): Promise<void>
  del(key: string): Promise<void>
}

export default class RedisClient {
  private static instance: RedisWrapper | null = null

  static async getInstance(subscribe: boolean = false, prefix: string = ''): Promise<RedisWrapper> {
    if (!this.instance) {
      this.instance = await this.createClient(subscribe, prefix)
    }
    return this.instance
  }

  private static async createClient(subscribe: boolean, prefix: string): Promise<RedisWrapper> {
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      keyPrefix: prefix ? `${prefix}:` : '',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    })

    return {
      subscribe: (channel: string, callback: (message: string) => void) => {
        if (subscribe) {
          redis.subscribe(channel)
          redis.on('message', (chan, message) => {
            if (chan === channel) callback(message)
          })
        }
      },

      unsubscribe: (channel: string, callback: (message: string) => void) => {
        redis.unsubscribe(channel)
        redis.off('message', callback)
      },

      get: (key: string) => redis.get(key),
      
      set: (key: string, value: string, ttl?: number) => 
        ttl ? redis.setex(key, ttl, value) : redis.set(key, value),
      
      del: (key: string) => redis.del(key).then(() => void 0)
    }
  }
}
```

## Performance Optimization

### In-Memory Caching

```typescript
// Order and position caching for fast access
private currentOrders: CurrentOrders = new Map()
private currentPositions: CurrentPositions = new Map()
private symbolPriceMap: Map<string, number> = new Map()
private tickerTimeMap: Map<string, number> = new Map()

// Fast order lookup
private getOrderByExternalIdAndSymbol(symbol: string, externalId: string) {
  const symbolOrders = this.currentOrders.get(symbol) ?? new Map()
  return symbolOrders.get(externalId)
}

// Efficient order filtering
private getOrdersBySymbols(symbols: string[]): OrderDataType[] {
  const result: OrderDataType[] = []
  
  for (const symbol of symbols) {
    const symbolOrders = this.currentOrders.get(symbol)
    if (symbolOrders) {
      result.push(...Array.from(symbolOrders.values()))
    }
  }
  
  return result
}
```

### Database Optimization

```typescript
// Compound indexes for efficient queries
OrderSchema.index({ user: 1, symbol: 1, status: 1 })
OrderSchema.index({ symbol: 1, exchange: 1, status: 1 })
PositionSchema.index({ user: 1, symbol: 1, status: 1 })
PositionSchema.index({ status: 1, liquidationPrice: 1 })

// Projection for faster queries
const orders = await this.orderModel
  .find({ status: OrderStatus.CREATED }, {
    symbol: 1,
    price: 1,
    amount: 1,
    filledAmount: 1,
    side: 1,
    exchange: 1
  })
  .lean() // Use lean() for read-only operations
  .exec()
```

### Batch Processing

```typescript
// Batch ticker processing
private async processTickerQueue(data: {
  exchange: ExchangeEnum
  tickerData: Map<string, Tick>
}) {
  const { exchange, tickerData } = data
  
  // Get all relevant orders in one query
  const relevantOrders = this.getOrdersBySymbols(Array.from(tickerData.keys()))
    .filter(order => 
      order.exchange === exchange &&
      [OrderStatus.CREATED, OrderStatus.PARTIALLY_FILLED].includes(order.status)
    )

  // Group orders by symbol for efficient processing
  const ordersBySymbol = new Map<string, OrderDataType[]>()
  for (const order of relevantOrders) {
    const orders = ordersBySymbol.get(order.symbol) ?? []
    orders.push(order)
    ordersBySymbol.set(order.symbol, orders)
  }

  // Process each symbol's orders
  const promises: Promise<void>[] = []
  for (const [symbol, ticker] of tickerData) {
    const orders = ordersBySymbol.get(symbol) ?? []
    if (orders.length > 0) {
      promises.push(this.processSymbolOrders(orders, ticker))
    }
  }

  await Promise.all(promises)
}
```

## API Reference

### Exchange Endpoints

#### Get Latest Price

```
GET /exchange/latestPrice?symbol=BTCUSDT&exchange=binance
```

**Response:**
```json
{
  "status": "OK",
  "data": 50000.50,
  "reason": null
}
```

#### Get Exchange Information

```
GET /exchange?symbol=BTCUSDT&exchange=binance
```

**Response:**
```json
{
  "baseAsset": {
    "name": "BTC",
    "minAmount": 0.00001
  },
  "quoteAsset": {
    "name": "USDT", 
    "minAmount": 10
  },
  "priceAssetPrecision": 2,
  "priceMultiplier": "0.01",
  "maxOrders": 200
}
```

### Order Endpoints

#### Create Order

```
POST /order
```

**Request Body:**
```json
{
  "key": "user_api_key",
  "secret": "user_api_secret",
  "symbol": "BTCUSDT",
  "amount": 0.001,
  "price": 50000,
  "side": "BUY",
  "type": "LIMIT",
  "exchange": "binance",
  "externalId": "user_order_123",
  "reduceOnly": false,
  "positionSide": "LONG"
}
```

**Response:**
```json
{
  "orderId": "64a1b2c3d4e5f6789012345",
  "status": "CREATED"
}
```

#### Get Order Status

```
GET /order?symbol=BTCUSDT&key=user_api_key&secret=user_api_secret
```

**Response:**
```json
[
  {
    "symbol": "BTCUSDT",
    "orderId": "64a1b2c3d4e5f6789012345",
    "clientOrderId": "user_order_123",
    "side": "BUY",
    "orderStatus": "CREATED",
    "orderType": "LIMIT",
    "price": "50000.00",
    "quantity": "0.001",
    "executedQty": "0.000",
    "transactTime": 1669876543210,
    "updateTime": 1669876543210
  }
]
```

### WebSocket Events

#### Order Updates

```json
{
  "eventType": "executionReport",
  "symbol": "BTCUSDT",
  "orderId": "64a1b2c3d4e5f6789012345",
  "clientOrderId": "user_order_123",
  "side": "BUY",
  "orderStatus": "FILLED",
  "orderType": "LIMIT",
  "price": "50000.00",
  "quantity": "0.001",
  "executedQty": "0.001",
  "timestamp": 1669876543210
}
```

#### Balance Updates

```json
{
  "eventType": "balanceUpdate",
  "balances": [
    {
      "asset": "BTC",
      "free": "0.001",
      "locked": "0.000"
    },
    {
      "asset": "USDT",
      "free": "9950.00",
      "locked": "0.00"
    }
  ],
  "timestamp": 1669876543210
}
```

#### Position Updates (Futures)

```json
{
  "eventType": "positionUpdate",
  "symbol": "BTCUSDT",
  "positionSide": "LONG",
  "positionAmt": "0.001",
  "entryPrice": "50000.00",
  "liquidationPrice": "25000.00",
  "unrealizedProfit": "-0.50",
  "timestamp": 1669876543210
}
```

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `MONGO_DB_USERNAME` | MongoDB username | Yes | - |
| `MONGO_DB_PASSWORD` | MongoDB password | Yes | - |
| `MONGO_DB_NAME` | Database name | Yes | `paper_trading` |
| `MONGO_DB_HOST` | MongoDB host | Yes | `localhost` |
| `MONGO_DB_PORT` | MongoDB port | Yes | `27017` |
| `APP_PORT` | Application port | No | `3000` |
| `REDIS_HOST` | Redis host | Yes | `localhost` |
| `REDIS_PORT` | Redis port | Yes | `6379` |
| `REDIS_PASSWORD` | Redis password | No | - |
| `EXCHANGE_SERVICE_API_URL` | External exchange service | No | `http://localhost:7507` |

This developer guide provides comprehensive coverage of the Paper Trading Exchange Simulator's architecture and implementation. The system is designed to handle high-frequency trading scenarios with real-time updates, complex order matching, and robust futures trading support.