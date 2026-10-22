process.env.NODE_ENV = 'testing'

/**
 * Spec 005 — two paper futures fills for one user and symbol that land on the
 * same tick must end up in ONE position, as they would on the exchange.
 *
 * `processTickerQueue` fires `processLimitOrder` for every crossed order on a
 * tick without awaiting it, and `processLimitOrder` is only serialised per
 * order. Each fill then reaches `processFuturesPosition`, which looks the
 * position up in memory and, when there is none, awaits `positionModel.create`
 * before registering the new one. Two fills inside that window both see "no
 * position" and both create one (§2, §3).
 *
 * Run: `npm test` (mocha). The harness drives the real (private)
 * `processFuturesPosition` off the prototype — decorators included — with
 * stubbed models whose promises resolve on a later turn, the way a Mongo round
 * trip does.
 */
import { describe, it } from 'mocha'
import assert from 'assert'
import { ExchangeEnum, ExchangeInfo } from '../exchange/types'

/* eslint-disable @typescript-eslint/no-require-imports */
// See reduce-only-clamp.spec.ts: `@Prop()` cannot resolve imported enum types
// under TS_NODE_TRANSPILE_ONLY, and nothing here builds a mongoose model.
require('@nestjs/mongoose/dist/decorators/prop.decorator').Prop = () => () =>
  undefined
const { OrderService } = require('./order.service')
const { PositionSide, PositionStatus } = require('../schema/positions.schema')

const later = <T>(v: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(v), 5))

const symbolInfo: ExchangeInfo = {
  baseAsset: {
    minAmount: 0.001,
    maxAmount: 1e9,
    step: 0.001,
    name: 'XAUT',
    maxMarketAmount: 1e9,
  },
  quoteAsset: { minAmount: 0, name: 'USDT' },
  maxOrders: 200,
  priceAssetPrecision: 2,
}

function makeService(hedge: boolean) {
  const created: any[] = []
  const svc: any = Object.create(OrderService.prototype)
  svc.currentPositions = new Map()
  svc.watchSymbols = new Map()
  svc.hedgeModel = { findOne: () => later(hedge ? { hedge } : null) }
  svc.orderModel = { findOneAndUpdate: () => later(null) }
  svc.positionModel = {
    create: (doc: any) => {
      created.push(doc)
      const id = `pos-${created.length}`
      return later({ ...doc, _id: { toString: () => id }, id })
    },
    findOneAndUpdate: () => later(null),
  }
  // The real addPositionToWatchList + mapPositionToDataType run; only the
  // Redis subscription and the pair-code lookup are stubbed.
  svc.checkRedis = () => undefined
  svc.getPairCodeByPairNameAndExchange = (s: string) => s
  svc.unLockLeverage = async () => undefined
  svc.lockLeverage = async () => undefined
  svc.getUserFee = () => 0.0002
  svc.updateBalance = async () => true
  return { svc, created }
}

function userId(id: string): any {
  const u: any = { toString: () => id }
  u._id = u
  return u
}

function fill(user: any, externalId: string, amount = 0.006): any {
  const price = 4086.83
  return {
    user,
    symbol: 'XAUTUSDT',
    exchange: ExchangeEnum.binanceUsdm,
    side: 'SELL',
    positionSide: PositionSide.both,
    type: 'LIMIT',
    reduceOnly: false,
    externalId,
    status: 'FILLED',
    price,
    avgFilledPrice: price,
    amount,
    filledAmount: amount,
    quoteAmount: amount * price,
    filledQuoteAmount: amount * price,
    feePerc: 0.0002,
    fee: amount * price * 0.0002,
  }
}

const open = (svc: any) =>
  Array.from(svc.currentPositions.get('XAUTUSDT')?.values() ?? []).filter(
    (p: any) => p.status === PositionStatus.new,
  )

describe('same-tick paper futures fills merge into one position (spec 005)', () => {
  it('§1.1 two same-side fills on one tick open ONE position with the summed size', async () => {
    const { svc, created } = makeService(false)
    const user = userId('user-1')
    await Promise.all([
      svc.processFuturesPosition(fill(user, 'BO-1'), 1, symbolInfo),
      svc.processFuturesPosition(fill(user, 'BO-2'), 1, symbolInfo),
    ])
    assert.strictEqual(created.length, 1, 'positionModel.create ran twice')
    const positions = open(svc)
    assert.strictEqual(positions.length, 1)
    assert.ok(Math.abs((positions[0] as any).positionAmt - 0.012) < 1e-12)
  })

  it('§1.1 holds in hedge mode too', async () => {
    const { svc, created } = makeService(true)
    const user = userId('user-1')
    await Promise.all(
      ['BO-1', 'BO-2', 'BO-3'].map((id) =>
        svc.processFuturesPosition(
          { ...fill(user, id), positionSide: PositionSide.short },
          1,
          symbolInfo,
        ),
      ),
    )
    assert.strictEqual(created.length, 1)
    const positions = open(svc)
    assert.strictEqual(positions.length, 1)
    assert.ok(Math.abs((positions[0] as any).positionAmt - 0.018) < 1e-12)
  })

  it('§1.2 different users on the same tick still get a position each', async () => {
    const { svc, created } = makeService(false)
    await Promise.all([
      svc.processFuturesPosition(fill(userId('user-1'), 'BO-1'), 1, symbolInfo),
      svc.processFuturesPosition(fill(userId('user-2'), 'BO-2'), 1, symbolInfo),
    ])
    assert.strictEqual(created.length, 2)
    assert.strictEqual(open(svc).length, 2)
  })
})
