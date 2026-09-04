process.env.NODE_ENV = 'testing'

/**
 * `processFuturesPosition`'s reduceOnly clamp must leave the order's fee on the
 * SAME invariant every other fee in this file obeys:
 *
 *     fee === (isCoinm ? (qty * contractSize) / price : qty * price) * feePerc
 *
 * When a reduceOnly order is larger than the position it is closing, the clamp
 * shrinks `order.amount` down to `current.positionAmt` and refunds the fee for
 * the units that were clamped off. `diff` is a BASE-asset quantity and `fee` is
 * a notional-denominated amount, so the refund only balances if it is converted
 * the same way the fill converted it. The non-reduceOnly sibling branch right
 * below recomputes the whole fee as `(positionAmt * price) * feePerc`; these
 * cases pin the clamp to the same result.
 *
 * Run: `npm test` (mocha).
 *
 * The harness drives the real (private) `processFuturesPosition` off the
 * prototype with stubbed models — no Nest container, no Mongo, no Redis — so
 * the arithmetic under test is the shipped arithmetic, not a copy of it.
 */
import { describe, it } from 'mocha'
import assert from 'assert'
import { ExchangeEnum, ExchangeInfo } from '../exchange/types'

/* eslint-disable @typescript-eslint/no-require-imports */
// `@Prop()` reads the `design:type` metadata TypeScript emits for each field,
// and the suite runs ts-node with `TS_NODE_TRANSPILE_ONLY=1`, which compiles
// each file alone and therefore cannot resolve an IMPORTED type — every enum
// prop comes out as `Object` and `@nestjs/mongoose` throws
// `Cannot determine a type for "Position.exchange"` at import time, before any
// service code runs. Nothing here builds a mongoose model (every model is
// stubbed below), so the property decorators are dead weight for this file:
// neutralise them, then load the service. Must stay above these requires.
// The package's own barrel re-exports `Prop` through a getter, so the stub has
// to land on the module the getter reads from.
require('@nestjs/mongoose/dist/decorators/prop.decorator').Prop = () => () =>
  undefined
const { OrderService } = require('./order.service')
const { PositionSide, PositionStatus } = require('../schema/positions.schema')

type Case = {
  exchange: ExchangeEnum
  /** Contract size for coin-m; ignored on linear. */
  contractSize: number
  price: number
  feePerc: number
  /** What is actually left on the book. */
  positionAmt: number
  /** What the caller asked to close — deliberately bigger. */
  orderAmount: number
  entryPrice: number
}

function exchangeInfo(c: Case): ExchangeInfo {
  return {
    baseAsset: {
      minAmount: 0.001,
      maxAmount: 1e9,
      step: 0.001,
      name: 'BASE',
      maxMarketAmount: 1e9,
    },
    quoteAsset: { minAmount: c.contractSize, name: 'QUOTE' },
    maxOrders: 200,
    priceAssetPrecision: 8,
  }
}

const isCoinm = (e: ExchangeEnum) =>
  [
    ExchangeEnum.binanceCoinm,
    ExchangeEnum.bybitCoinm,
    ExchangeEnum.okxInverse,
    ExchangeEnum.kucoinInverse,
    ExchangeEnum.bitgetCoinm,
    ExchangeEnum.krakenCoinm,
  ].includes(e)

/** The fee the fill charged, before the clamp — `createOrder`'s own formula. */
function feeAtFill(c: Case, qty: number) {
  return (
    (isCoinm(c.exchange) ? (qty * c.contractSize) / c.price : qty * c.price) *
    c.feePerc
  )
}

/** Drive the shipped clamp and report what it left on the order + wallet. */
async function runClamp(c: Case) {
  const user: any = {
    _id: { toString: () => 'user-1' },
    toString: () => 'user-1',
  }
  const order: any = {
    user,
    symbol: 'TESTPAIR',
    exchange: c.exchange,
    side: 'SELL',
    positionSide: PositionSide.long,
    type: 'MARKET',
    reduceOnly: true,
    externalId: 'ext-1',
    status: 'FILLED',
    price: c.price,
    avgFilledPrice: c.price,
    amount: c.orderAmount,
    filledAmount: c.orderAmount,
    quoteAmount: c.orderAmount * c.price,
    filledQuoteAmount: c.orderAmount * c.price,
    feePerc: c.feePerc,
    fee: feeAtFill(c, c.orderAmount),
  }

  const position: any = {
    id: 'pos-1',
    uuid: 'pos-uuid-1',
    user: 'user-1',
    symbol: 'TESTPAIR',
    exchange: c.exchange,
    positionSide: PositionSide.long,
    status: PositionStatus.new,
    positionAmt: c.positionAmt,
    entryPrice: c.entryPrice,
    closePrice: 0,
    liquidationPrice: 0,
    margin: isCoinm(c.exchange)
      ? (c.positionAmt * c.contractSize) / c.entryPrice
      : c.positionAmt * c.entryPrice,
    profit: 0,
    fee: 0,
    leverage: 1,
    updatedAt: new Date(0),
  }

  const walletDeltas: { asset: string; free: number; locked: number }[] = []
  const svc: any = Object.create(OrderService.prototype)
  svc.currentPositions = new Map([
    ['TESTPAIR', new Map([[position.uuid, position]])],
  ])
  svc.watchSymbols = new Map()
  svc.hedgeModel = { findOne: () => Promise.resolve(null) }
  svc.orderModel = { findOneAndUpdate: () => Promise.resolve(null) }
  svc.positionModel = { findOneAndUpdate: () => Promise.resolve(null) }
  svc.unLockLeverage = async () => undefined
  svc.lockLeverage = async () => undefined
  svc.getUserFee = () => c.feePerc
  svc.updateBalance = async (_u: unknown, ...d: any[]) => {
    walletDeltas.push(...d)
    return true
  }

  await (svc as any).processFuturesPosition(
    order,
    1,
    exchangeInfo(c),
    position.uuid,
  )
  return { order, position, walletDeltas }
}

/** Floating point: compare to the shipped formula's own rounding. */
function close(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(1e-12, Math.abs(b) * 1e-9)
}

describe('reduceOnly clamp keeps the order fee on the fill invariant', () => {
  const cases: [string, Case][] = [
    // price > 1: the refund is understated by a factor of `price`, so the user
    // is billed for units that were never closed.
    [
      'linear, asset priced above 1',
      {
        exchange: ExchangeEnum.binanceUsdm,
        contractSize: 0,
        price: 2000,
        feePerc: 0.0004,
        positionAmt: 0.05,
        orderAmount: 0.2,
        entryPrice: 1900,
      },
    ],
    // price < 1: the same error flips sign and can overshoot the whole fee,
    // leaving a NEGATIVE fee that credits the paper wallet.
    [
      'linear, asset priced below 1',
      {
        exchange: ExchangeEnum.binanceUsdm,
        contractSize: 0,
        price: 0.1,
        feePerc: 0.0004,
        positionAmt: 100,
        orderAmount: 1100,
        entryPrice: 0.11,
      },
    ],
    // coin-m: the refund is a raw notional with no rate applied at all.
    [
      'inverse (coin-m)',
      {
        exchange: ExchangeEnum.binanceCoinm,
        contractSize: 100,
        price: 50000,
        feePerc: 0.0005,
        positionAmt: 2,
        orderAmount: 5,
        entryPrice: 49000,
      },
    ],
  ]

  for (const [label, c] of cases) {
    const want = feeAtFill(c, c.positionAmt)

    it(`${label}: fee equals the fee for the amount actually closed`, async () => {
      const { order } = await runClamp(c)
      assert.ok(
        close(order.fee, want),
        `fee ${order.fee} should be ${want} (${(order.fee / want).toFixed(4)}x)`,
      )
    })

    it(`${label}: fee is never negative`, async () => {
      const { order } = await runClamp(c)
      assert.ok(order.fee >= 0, `fee ${order.fee} is negative`)
    })

    it(`${label}: clamps the order down to the position size`, async () => {
      const { order } = await runClamp(c)
      assert.strictEqual(order.amount, c.positionAmt)
      assert.ok(close(order.filledQuoteAmount, c.positionAmt * c.price))
    })

    it(`${label}: wallet is credited margin + pnl net of that same fee`, async () => {
      const { position, walletDeltas } = await runClamp(c)
      const gross = isCoinm(c.exchange)
        ? (c.positionAmt * c.contractSize) / c.entryPrice -
          (c.positionAmt * c.contractSize) / c.price
        : c.positionAmt * c.price - c.positionAmt * c.entryPrice
      const expectedFree =
        (isCoinm(c.exchange)
          ? (c.positionAmt * c.contractSize) / c.entryPrice
          : c.positionAmt * c.entryPrice) +
        gross -
        want
      const free = walletDeltas.reduce((a, d) => a + d.free, 0)
      assert.ok(
        close(free, expectedFree),
        `wallet credit ${free} should be ${expectedFree}`,
      )
      assert.strictEqual(position.status, PositionStatus.closed)
    })
  }
})
