process.env.NODE_ENV = 'testing'

/**
 * Spec 007: two ticks queued on one paper LIMIT order must not fill it for
 * more than its size.
 *
 * `processTickerQueue` hands `processLimitOrder` the RAM order object and does
 * not await it. `processLimitOrder` is serialised per order, but it used to
 * size the fill from that argument. A second tick queued before the first one
 * stored its fill still carried the pre-fill `filledAmount`, so it filled the
 * whole remainder again.
 *
 * Run: `npm test` (mocha). The harness drives the real `processTickerQueue`
 * and `processLimitOrder` off the prototype, decorators (mutexes) included.
 * The models resolve on a later turn, the way a Mongo round trip does.
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

const later = <T>(v: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(v), 5))

const SYMBOL = 'MNTUSDT'
const EXCHANGE = ExchangeEnum.binance

const symbolInfo: ExchangeInfo = {
  baseAsset: {
    minAmount: 0.01,
    maxAmount: 1e9,
    step: 0.01,
    name: 'MNT',
    maxMarketAmount: 1e9,
  },
  quoteAsset: { minAmount: 0, name: 'USDT' },
  maxOrders: 200,
  priceAssetPrecision: 4,
}

function makeService(order: any) {
  const writes: any[] = []
  const balances: any[][] = []
  const pushes: any[] = []
  const svc: any = Object.create(OrderService.prototype)
  svc.currentOrders = new Map([[SYMBOL, new Map([[order.externalId, order]])]])
  svc.currentPositions = new Map()
  svc.liquidatingPositions = new Set()
  svc.watchSymbols = new Map([
    [`${SYMBOL}@${EXCHANGE}`, new Set([order.externalId])],
  ])
  svc.symbolsMap = new Map([
    [`${SYMBOL}@${EXCHANGE}`, { data: symbolInfo, time: Date.now() }],
  ])
  svc.getUserFee = () => 0.001
  svc.getPairCodeByPairNameAndExchange = (s: string) => s
  svc.unsubscribeRedis = () => undefined
  svc.userGateway = {
    sendOrderToClient: (_u: string, o: any) => pushes.push(o),
  }
  // A Mongo-faithful row: honours the filter (including a filledAmount guard)
  // and applies $inc only when it matches.
  const row = { ...order }
  svc.orderModel = {
    updateOne: (filter: any, update: any) => ({
      exec: () => {
        writes.push({ filter, update })
        const guard = filter?.filledAmount?.$lte
        const matched = guard === undefined || row.filledAmount <= guard
        if (matched) {
          for (const [k, v] of Object.entries(update.$inc ?? {})) {
            row[k] += v as number
          }
        }
        return later({
          acknowledged: true,
          matchedCount: matched ? 1 : 0,
          modifiedCount: matched ? 1 : 0,
        })
      },
    }),
  }
  svc.orderModel.findOne = () => ({
    lean: () => ({ exec: () => later({ ...row }) }),
  })
  svc.updateBalance = async (_u: any, ...d: any[]) => {
    balances.push(d)
    return later(true)
  }
  return { svc, row, writes, balances, pushes }
}

// Unique per test: the order mutex is module-level and keyed by externalId.
let seq = 0
function limitOrder(side: 'BUY' | 'SELL', filledAmount = 0): any {
  const price = 1.2
  seq += 1
  return {
    _id: `oid-${seq}`,
    user: { toString: () => 'user-1' },
    symbol: SYMBOL,
    exchange: EXCHANGE,
    side,
    type: 'LIMIT',
    externalId: `D-${side}-${seq}`,
    status: filledAmount ? 'PARTIALLY_FILLED' : 'NEW',
    price,
    amount: 100,
    filledAmount,
    quoteAmount: 100 * price,
    filledQuoteAmount: filledAmount * price,
    fee: 0,
    feePerc: 0.001,
  }
}

// A tick AT the order price with limited book depth, so the fill is partial
// unless the depth covers the remainder.
function tick(side: 'BUY' | 'SELL', qty: number): any {
  return side === 'SELL'
    ? { bestBid: 1.2, bidQty: qty, bestAsk: 1.21, askQty: 0, time: Date.now() }
    : { bestBid: 1.19, bidQty: 0, bestAsk: 1.2, askQty: qty, time: Date.now() }
}

const settle = () => new Promise((r) => setTimeout(r, 200))

const ticker = (svc: any, t: any) =>
  svc.processTickerQueue({
    exchange: EXCHANGE,
    tickerData: new Map([[SYMBOL, t]]),
  })

for (const side of ['SELL', 'BUY'] as const) {
  describe(`queued ticks on one paper ${side} LIMIT order (spec 007)`, () => {
    it('§1.1/§1.2 ticks queued behind an in-flight fill fill exactly the order size', async () => {
      const order = limitOrder(side)
      const { svc, row, balances } = makeService(order)
      // The production shape: the first partial fill holds the order mutex
      // while its Mongo writes are in flight. Two more ticks arrive meanwhile.
      // Both read the same RAM object (filledAmount 30) and queue behind it,
      // because processTickerQueue does not await the fill.
      await Promise.all([
        ticker(svc, tick(side, 30)),
        ticker(svc, tick(side, 30)),
        ticker(svc, tick(side, 1000)),
      ])
      await settle()
      assert.ok(
        Math.abs(row.filledAmount - 100) < 1e-9,
        `order row filledAmount ${row.filledAmount} != amount 100`,
      )
      const released = balances
        .flat()
        .filter((d) => d.locked < 0)
        .reduce((s, d) => s + d.locked, 0)
      const expectedRelease = side === 'SELL' ? -100 : -100 * 1.2
      assert.ok(
        Math.abs(released - expectedRelease) < 1e-9,
        `locked released ${released}, expected ${expectedRelease}`,
      )
      assert.strictEqual(
        svc.currentOrders.get(SYMBOL)?.has(order.externalId) ?? false,
        false,
        'FILLED order left in RAM',
      )
    })

    it('§1.3 a queued tick reaching an order with nothing left writes nothing', async () => {
      const order = limitOrder(side)
      const { svc, writes, balances, pushes } = makeService(order)
      // partial (30), then two full-cover ticks queued on the same stale
      // object: the first fills the remaining 70, the second has nothing left.
      await Promise.all([
        ticker(svc, tick(side, 30)),
        ticker(svc, tick(side, 1000)),
        ticker(svc, tick(side, 1000)),
      ])
      await settle()
      assert.strictEqual(
        writes.length,
        2,
        'a tick with nothing left wrote the order row',
      )
      assert.strictEqual(
        balances.length,
        2,
        'a tick with nothing left moved the wallet',
      )
      assert.strictEqual(pushes.length, 2)
      assert.strictEqual(pushes[1].status, 'FILLED')
      assert.ok(Math.abs(pushes[1].filledAmount - 100) < 1e-9)
    })

    it('§1.4 the fill write is guarded by filledAmount <= amount - fill', async () => {
      const order = limitOrder(side, 40)
      const { svc, writes } = makeService(order)
      await ticker(svc, tick(side, 1000))
      await settle()
      assert.strictEqual(writes.length, 1)
      assert.ok(
        Math.abs(writes[0].filter.filledAmount?.$lte - 40) < 1e-9,
        `fill write filter ${JSON.stringify(writes[0].filter)}`,
      )
    })

    it('§1.4 a fill the row refuses moves no wallet and re-syncs RAM from the row', async () => {
      const order = limitOrder(side, 40)
      const { svc, row, writes, balances, pushes } = makeService(order)
      row.filledAmount = 100 // the row is already fully filled; RAM says 40
      row.status = 'FILLED'
      await ticker(svc, tick(side, 1000))
      await settle()
      assert.strictEqual(writes.length, 1)
      assert.strictEqual(row.filledAmount, 100, 'refused write applied')
      assert.strictEqual(balances.length, 0, 'refused fill moved the wallet')
      assert.strictEqual(pushes.length, 0)
      const inRam = svc.currentOrders.get(SYMBOL).get(order.externalId)
      assert.strictEqual(inRam.filledAmount, 100)
      assert.strictEqual(inRam.status, 'FILLED')
    })
  })
}
