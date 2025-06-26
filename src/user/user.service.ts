import { InjectModel } from '@nestjs/mongoose'
import { User, UserDocument } from '../schema/user.schema'
import mongoose, { Model } from 'mongoose'
import { Wallet, WalletDocument } from '../schema/wallet.schema'
import { Leverage, LeverageDocument } from '../schema/leverage.schema'
import {
  PositionInfo,
  Position,
  PositionDocument,
  PositionStatus,
  PositionSide,
} from '../schema/positions.schema'
import {
  ExchangeEnum,
  spotMakerFee,
  usdmMakerFee,
  coinmMakerFee,
} from '../exchange/types'
import { HttpException, Logger } from '@nestjs/common'
import { isFutures, isCoinm } from '../exchange/utils'
import { Hedge, HedgeDocument } from '../schema/hedge.schema'

export type CreateUserDto = {
  username: string
  key: string
  secret: string
  balance: { exchange: ExchangeEnum; asset: string; amount: number }[]
}

export type UserFeesResponse = {
  taker: number
  maker: number
}

export type UserBalanceResponse = {
  balance: { asset: string; free: number; locked: number }[]
}

export class UserService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Wallet.name) private walletModel: Model<WalletDocument>,
    @InjectModel(Leverage.name) private leverageModel: Model<LeverageDocument>,
    @InjectModel(Position.name) private positionModel: Model<PositionDocument>,
    @InjectModel(Hedge.name) private hedgeModel: Model<HedgeDocument>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<{ userId: string }> {
    const exchange = createUserDto.balance[0].exchange
    const makerFee = isFutures(exchange)
      ? isCoinm(exchange)
        ? coinmMakerFee
        : usdmMakerFee
      : spotMakerFee
    const takerFee = isFutures(exchange)
      ? isCoinm(exchange)
        ? coinmMakerFee * 5
        : usdmMakerFee * 2
      : spotMakerFee
    const createdUser = new this.userModel({
      username: createUserDto.username,
      key: createUserDto.key,
      secret: createUserDto.secret,
      makerFee,
      takerFee,
    })
    try {
      await createdUser.save()
    } catch (e) {
      throw new HttpException('Failed to create user', 400)
    }
    const wallets: Promise<any>[] = []
    createUserDto.balance.forEach((b) => {
      wallets.push(
        this.walletModel.create({
          user: createdUser,
          exchange: b.exchange,
          free: b.amount,
          locked: 0,
          asset: b.asset,
        }),
      )
    })
    await Promise.all(wallets)
    return { userId: createdUser.id }
  }

  async changeLeverage(
    key: string,
    secret: string,
    symbol: string,
    leverage: number,
    side: PositionSide,
  ) {
    const user = await this.getUserByKeyAndSecretOrThrow(key, secret)
    const current = await this.leverageModel.findOne({
      user: user._id,
      symbol,
      side,
    })
    if (!current) {
      return await this.leverageModel
        .create({
          user: user._id,
          symbol,
          leverage,
          locked: false,
          side,
        })
        .then((l) => l.leverage)
    }
    if (current.locked && current.leverage !== leverage) {
      throw new HttpException(
        'Cannot change leverage with active position',
        400,
      )
    }
    if (current.leverage !== leverage) {
      await this.leverageModel.updateOne(
        { _id: current._id },
        { $set: { leverage } },
      )
      return leverage
    }
    return leverage
  }

  async changeHedge(key: string, secret: string, hedge: boolean) {
    const user = await this.getUserByKeyAndSecretOrThrow(key, secret)
    const current = await this.positionModel.find({
      user: user._id,
      status: PositionStatus.new,
    })
    if (current.length) {
      throw new HttpException('Cannot change hedge with active position', 400)
    }
    await this.hedgeModel.findOneAndUpdate(
      { user: user._id },
      { hedge, user: user._id },
      { upsert: true },
    )
    return hedge
  }

  async getHedge(key: string, secret: string) {
    const user = await this.getUserByKeyAndSecretOrThrow(key, secret)
    const current = await this.hedgeModel.findOne({
      user: user._id,
    })
    if (!current) {
      return false
    }
    return current.hedge
  }

  onModuleInit() {
    ;(async () => {
      await this.walletModel.syncIndexes()
    })()
  }

  async getPositions(key: string, secret: string): Promise<PositionInfo[]> {
    const user = await this.getUserByKeyAndSecretOrThrow(key, secret)
    const positions = await this.positionModel.find({
      user: user._id,
      status: PositionStatus.new,
    })

    return (positions ?? []).map((p) => ({
      symbol: p.symbol,
      initialMargin: `${p.margin}`,
      maintMargin: '0',
      unrealizedProfit: '0',
      positionInitialMargin: '0',
      openOrderInitialMargin: '0',
      leverage: `${p.leverage}`,
      isolated: true,
      entryPrice: `${p.entryPrice}`,
      maxNotional: '0',
      positionSide: p.positionSide,
      positionAmt: `${p.positionAmt}`,
      notional: '0',
      isolatedWallet: '0',
      updateTime: +new Date(p.updatedAt),
      bidNotional: '0',
      askNotional: '0',
    }))
  }

  async getUserByKeyAndSecretOrThrow(
    key: string,
    secret: string,
  ): Promise<UserDocument> {
    const user = await this.userModel.findOne({ key, secret }).exec()
    if (!user) {
      throw new HttpException('User not found', 400)
    }
    return user
  }

  async getAllUsersOrThrow(): Promise<UserDocument[]> {
    const user = await this.userModel.find().exec()
    if (!user) {
      throw new HttpException('User not found', 400)
    }
    return user
  }

  async getUserByIdOrThrow(_id: string): Promise<UserDocument> {
    const user = await this.userModel.findOne({ _id }).exec()
    if (!user) {
      throw new HttpException('User not found', 400)
    }
    return user
  }

  async getUserBalanceByKeyAndSecret(
    key: string,
    secret: string,
  ): Promise<UserBalanceResponse> {
    const user = await this.getUserByKeyAndSecretOrThrow(key, secret)
    return await this.getUserBalanceByUserIdOrThrow(user.id)
  }

  async getUserBalanceByUserIdOrThrow(
    user: string,
    asset?: string[],
  ): Promise<UserBalanceResponse> {
    const filter: Record<string, unknown> = {
      user: user,
    }
    if (asset && asset.length > 0) {
      filter.asset = { $in: asset }
    }
    const wallets = await this.walletModel.find(filter)
    if (!wallets) {
      throw Error('Users wallet not found')
    }
    return {
      balance: wallets.map((w) => ({
        asset: w.asset,
        free: w.free,
        locked: w.locked,
      })),
    }
  }

  async increaseUserBalance(
    user: mongoose.Schema.Types.ObjectId | mongoose.Types.ObjectId,
    ...updates: { asset: string; free: number; locked: number }[]
  ): Promise<void> {
    const queries: Promise<any>[] = []
    updates.forEach((u) => {
      queries.push(
        this.walletModel
          .findOneAndUpdate(
            {
              user: user,
              asset: u.asset,
              /*free: {
                $gte: u.free < 0 ? Math.abs(u.free) - eps : -eps,
              },
              locked: {
                $gte: u.locked < 0 ? Math.abs(u.locked) - eps : -eps,
              },*/
            },
            {
              user: user,
              asset: u.asset,
              $inc: { free: u.free, locked: u.locked },
            },
            { upsert: true },
          )
          .exec()
          .catch((e) =>
            Logger.error(
              `Failed to update user balance ${
                e?.message || e
              }, user - ${user}, asset - ${u.asset}, free - ${
                u.free
              }, locked - ${u.locked}`,
            ),
          ),
      )
    })
    await Promise.all(queries)
  }

  async setUserBalance(
    user: mongoose.Schema.Types.ObjectId | mongoose.Types.ObjectId,
    updates: { asset: string; free: number; locked: number },
  ): Promise<void> {
    this.walletModel
      .findOneAndUpdate(
        {
          user: user,
          asset: updates.asset,
        },
        {
          ...updates,
        },
        { upsert: true },
      )
      .exec()
      .catch((e) =>
        Logger.error(`Failed to update use balance ${e?.message || e}`),
      )
  }

  async getUserFeesByKeyAndSecret(
    key: string,
    secret: string,
  ): Promise<UserFeesResponse> {
    const user = await this.getUserByKeyAndSecretOrThrow(key, secret)
    return { maker: user.makerFee, taker: user.takerFee }
  }

  async topUpUserBalance(
    key: string,
    secret: string,
    usdtBalance: number,
    _exchange: ExchangeEnum,
    coinToTopUp: string,
  ) {
    const user = await this.getUserByKeyAndSecretOrThrow(key, secret)
    if (usdtBalance < 0) {
      throw new HttpException('Insufficient amount', 400)
    }
    await this.walletModel
      .updateOne(
        { user: user._id, asset: coinToTopUp },
        { $inc: { free: usdtBalance, locked: 0 } },
        { upsert: true },
      )
      .exec()
    return { success: true }
  }
}
