import { InjectModel } from '@nestjs/mongoose'
import { User, UserDocument } from '../schema/user.schema'
import mongoose, { Model } from 'mongoose'
import {
  Wallet,
  WalletDocument,
  walletBalanceMin,
} from '../schema/wallet.schema'
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

  /**
   * Returns true when every delta was applied in full.
   */
  async increaseUserBalance(
    user: mongoose.Schema.Types.ObjectId | mongoose.Types.ObjectId,
    ...updates: { asset: string; free: number; locked: number }[]
  ): Promise<boolean> {
    const applied = await Promise.all(
      updates.map((u) => this.applyWalletDelta(user, u)),
    )
    return applied.every(Boolean)
  }

  /**
   * `paperWallets` carries a server-side validator that refuses free/locked
   * below `walletBalanceMin`, so an unguarded $inc that over-releases one field
   * made Mongo reject the WHOLE update — the credit half of the same delta was
   * lost too and the failure was only logged. Guard the decrement instead:
   * a conditional $inc in the common case, and a clamped retry when the wallet
   * genuinely holds less than the caller is trying to remove. The guarded
   * update never upserts, so a failed precondition can no longer insert a
   * duplicate wallet doc for the same (user, asset).
   */
  private async applyWalletDelta(
    user: mongoose.Schema.Types.ObjectId | mongoose.Types.ObjectId,
    u: { asset: string; free: number; locked: number },
  ): Promise<boolean> {
    const filter = { user: user, asset: u.asset }
    if (await this.incWalletGuarded(filter, u.free, u.locked)) {
      return true
    }
    const wallet = await this.walletModel.findOne(filter).exec()
    if (!wallet) {
      // First write for this (user, asset): there is nothing to take from, and
      // the validator refuses to insert a negative balance, so only the credit
      // side of the delta can land.
      const free = Math.max(u.free, 0)
      const locked = Math.max(u.locked, 0)
      await this.walletModel
        .updateOne(
          filter,
          { ...filter, $inc: { free, locked } },
          { upsert: true },
        )
        .exec()
        .catch((e) =>
          Logger.error(
            `Failed to create user balance ${e?.message || e}, user - ${user}, asset - ${u.asset}, free - ${u.free}, locked - ${u.locked}`,
          ),
        )
      return free === u.free && locked === u.locked
    }
    const free = Math.max(u.free, -Math.max(wallet.free, 0))
    const locked = Math.max(u.locked, -Math.max(wallet.locked, 0))
    const applied = await this.incWalletGuarded(filter, free, locked)
    Logger.error(
      `Wallet over-release, user - ${user}, asset - ${u.asset}, requested free - ${u.free}, locked - ${u.locked}, wallet free - ${wallet.free}, locked - ${wallet.locked}, applied free - ${applied ? free : 0}, locked - ${applied ? locked : 0}`,
    )
    return false
  }

  private async incWalletGuarded(
    filter: {
      user: mongoose.Schema.Types.ObjectId | mongoose.Types.ObjectId
      asset: string
    },
    free: number,
    locked: number,
  ): Promise<boolean> {
    const guarded: Record<string, unknown> = { ...filter }
    // The wallet must hold enough to cover a decrement, within the same
    // tolerance the collection validator allows for rounding dust.
    if (free < 0) {
      guarded.free = { $gte: -free + walletBalanceMin / 2 }
    }
    if (locked < 0) {
      guarded.locked = { $gte: -locked + walletBalanceMin / 2 }
    }
    const res = await this.walletModel
      .updateOne(guarded, { $inc: { free, locked } })
      .exec()
      .catch((e) => {
        Logger.error(
          `Failed to update user balance ${e?.message || e}, user - ${filter.user}, asset - ${filter.asset}, free - ${free}, locked - ${locked}`,
        )
        return null
      })
    return (res?.matchedCount ?? 0) > 0
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
