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

/**
 * `applied`   — the delta landed in full.
 * `contained` — it asked to release more than the wallet held, the clamp took
 *               the excess back off the credit side and the corrected write
 *               landed, so the ledger is still consistent with the position it
 *               backs. Not a full apply, but nothing was lost or minted.
 * `failed`    — nothing landed, or part of the delta set was skipped: the
 *               wallet may now disagree with the open orders.
 */
export type WalletDeltaResult = 'applied' | 'contained' | 'failed'

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
   * Returns `applied` when every delta landed in full, `contained` when a clamp
   * absorbed an over-release without leaving the ledger inconsistent, `failed`
   * otherwise. Only `applied` means the caller got what it asked for.
   *
   * Debits are applied before credits. `applyWalletDelta` keeps one wallet's
   * free/locked pair consistent, but a delta set spanning two assets (a spot
   * fill credits the bought asset and debits the sold one) would still mint
   * balance if the credit landed while the debit was refused, so nothing is
   * credited unless every debit stuck — a clamped debit aborts the credit pass
   * exactly as a failed one does, which is why a delta set that still had
   * credits to skip is reported as failed rather than contained.
   */
  async increaseUserBalance(
    user: mongoose.Schema.Types.ObjectId | mongoose.Types.ObjectId,
    ...updates: { asset: string; free: number; locked: number }[]
  ): Promise<WalletDeltaResult> {
    const isDebit = (u: { free: number; locked: number }) =>
      u.free < 0 || u.locked < 0
    const credits = updates.filter((u) => !isDebit(u))
    const debited = await Promise.all(
      updates.filter(isDebit).map((u) => this.applyWalletDelta(user, u)),
    )
    if (debited.includes('failed')) {
      return 'failed'
    }
    if (debited.includes('contained')) {
      return credits.length ? 'failed' : 'contained'
    }
    const credited = await Promise.all(
      credits.map((u) => this.applyWalletDelta(user, u)),
    )
    if (credited.includes('failed')) {
      return 'failed'
    }
    return credited.includes('contained') ? 'contained' : 'applied'
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
   *
   * Clamping `free` and `locked` independently was just as wrong: a clamped
   * debit paired with a credit that still landed in full raised the wallet's
   * free+locked total out of nothing, so the paper ledger drifted away from the
   * open positions it is supposed to back. The two fields of one delta are a
   * pair, so a shortfall on the debit side is taken back off the credit side —
   * opening a futures position whose fee the wallet cannot quite cover now locks
   * that much less margin instead of conjuring the fee. When the credit side
   * cannot absorb the shortfall (a net debit larger than the wallet) nothing is
   * applied at all.
   *
   * A clamp that absorbed the whole over-release is reported as `contained`,
   * not as a failure: the wallet it wrote is consistent, so the callers must
   * not log it as an accounting break — only a delta that could not be
   * contained is an error.
   */
  private async applyWalletDelta(
    user: mongoose.Schema.Types.ObjectId | mongoose.Types.ObjectId,
    u: { asset: string; free: number; locked: number },
  ): Promise<WalletDeltaResult> {
    const filter = { user: user, asset: u.asset }
    if (await this.incWalletGuarded(filter, u.free, u.locked)) {
      return 'applied'
    }
    const wallet = await this.walletModel.findOne(filter).exec()
    // How much of each requested debit the wallet cannot cover.
    const shortOf = (have: number, delta: number) =>
      delta < 0 ? Math.max(0, -delta - Math.max(have, 0)) : 0
    const shortFree = shortOf(wallet?.free ?? 0, u.free)
    const shortLocked = shortOf(wallet?.locked ?? 0, u.locked)
    const shortfall = shortFree + shortLocked
    // Clamp each debit to what is actually there and take the same amount off
    // the credit side, so the applied pair never nets to more than was asked.
    const free = u.free > 0 ? u.free - shortfall : u.free + shortFree
    const locked = u.locked > 0 ? u.locked - shortfall : u.locked + shortLocked
    const absorbed =
      free + locked <= u.free + u.locked - walletBalanceMin &&
      free >= -Math.max(wallet?.free ?? 0, 0) &&
      locked >= -Math.max(wallet?.locked ?? 0, 0)
    const applied =
      absorbed &&
      // Nothing survived the clamp — a release against a lock that is not
      // there is a no-op, and writing it would only create an empty wallet.
      ((free === 0 && locked === 0) ||
        // The guarded $inc can never match a wallet doc that does not exist
        // yet, so the first write for this (user, asset) has to upsert. It
        // upserts the CLAMPED pair, which with nothing to take from is never
        // negative, so a delta that is part release and part credit still
        // lands its credit instead of being dropped whole.
        (wallet
          ? await this.incWalletGuarded(filter, free, locked)
          : await this.upsertWallet(filter, u, free, locked)))
    if (applied && shortfall === 0) {
      return 'applied'
    }
    // Fully absorbed by the clamp = contained, no ledger damage: log it as a
    // warning so it stops paging. Only an unabsorbed delta is an error.
    const message = `Wallet over-release, user - ${user}, asset - ${u.asset}, requested free - ${u.free}, locked - ${u.locked}, wallet free - ${wallet?.free ?? 0}, locked - ${wallet?.locked ?? 0}, applied free - ${applied ? free : 0}, locked - ${applied ? locked : 0}`
    if (applied) {
      Logger.warn(message)
      return 'contained'
    }
    Logger.error(message)
    return 'failed'
  }

  /** First write for a (user, asset) pair: the guarded $inc matches nothing. */
  private async upsertWallet(
    filter: {
      user: mongoose.Schema.Types.ObjectId | mongoose.Types.ObjectId
      asset: string
    },
    u: { asset: string; free: number; locked: number },
    free: number,
    locked: number,
  ): Promise<boolean> {
    return await this.walletModel
      .updateOne(
        filter,
        { ...filter, $inc: { free, locked } },
        { upsert: true },
      )
      .exec()
      .then(() => true)
      .catch((e) => {
        Logger.error(
          `Failed to create user balance ${e?.message || e}, user - ${filter.user}, asset - ${u.asset}, free - ${u.free}, locked - ${u.locked}`,
        )
        return false
      })
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
