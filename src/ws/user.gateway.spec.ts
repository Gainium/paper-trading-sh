process.env.NODE_ENV = 'testing'

/**
 * `sendOrderToClient` is the one place every filled/cancelled paper order's
 * socket.io push funnels through (spec 003, `order.service.ts` has 5 call
 * sites, all passing an `OrderDataType`). It must carry the same
 * `feePaid`/`feeSide` the REST endpoints already report via `paperOrderFee`
 * — this is main-app's live order-update stream, the path TP placement
 * actually runs on, and it was never wired to the fee report when
 * `paperOrderFee` shipped (1.3.8): only the REST response shape was updated.
 *
 * Run: `npm test` (mocha). No Nest container, no Mongo, no socket.io server
 * — `UserGateway`'s only constructor dependency is unused by this method, and
 * `.server`/the subscriber map are stubbed directly.
 */
import { describe, it } from 'mocha'
import assert from 'assert'
import { ExchangeEnum } from '../exchange/types'
// Type-only: a value import here would pull in `order.schema.ts`'s runtime
// `@Prop()` decorators (→ `positions.schema.ts`) ahead of the stub below.
import type { OrderDataType } from '../schema/order.schema'

/* eslint-disable @typescript-eslint/no-require-imports */
// Same workaround as `reduce-only-clamp.spec.ts`: the suite runs ts-node with
// `TS_NODE_TRANSPILE_ONLY=1`, which compiles each file alone and can't
// resolve an imported type, so every `@Prop()` field's enum/union type comes
// out as `Object` — `@nestjs/mongoose` then throws
// `Cannot determine a type for "Wallet.exchange"` while walking
// `UserGateway`'s import chain (→ `UserService` → the wallet schema), before
// any test runs. Nothing here touches a mongoose model — stub the decorator
// away before loading the gateway. Must stay above the require below.
require('@nestjs/mongoose/dist/decorators/prop.decorator').Prop = () => () =>
  undefined
const { UserGateway } = require('./user.gateway')

function baseOrder(fee: number): OrderDataType {
  return {
    _id: null as never,
    amount: 1,
    filledAmount: 1,
    filledQuoteAmount: 100,
    quoteAmount: 100,
    price: 100,
    avgFilledPrice: 100,
    fee,
    symbol: 'BTCUSDT',
    user: null as never,
    exchange: ExchangeEnum.binance,
    status: 'FILLED' as OrderDataType['status'],
    type: 'MARKET',
    side: 'BUY',
    externalId: 'ext-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    id: 'id-1',
  }
}

async function emitted(fee: number) {
  const gateway = new UserGateway(undefined as never)
  let captured: { type: string; data: unknown } | undefined
  ;(gateway as unknown as { server: unknown }).server = {
    to: () => ({
      emit: (_event: string, payload: { type: string; data: unknown }) => {
        captured = payload
      },
    }),
  }
  ;(
    gateway as unknown as {
      orderClientUsersMap: Map<string, Set<string>>
    }
  ).orderClientUsersMap.set('user-1', new Set(['client-1']))
  await gateway.sendOrderToClient('user-1', baseOrder(fee))
  return captured!.data as OrderDataType & {
    feePaid?: string
    feeSide?: 'base' | 'quote'
  }
}

describe('UserGateway.sendOrderToClient', () => {
  it('carries feePaid/feeSide for a filled order (spec 003 §1.2, §3.A)', async () => {
    const data = await emitted(0.05)
    assert.strictEqual(data.feePaid, '0.05')
    assert.strictEqual(data.feeSide, 'base') // spot BUY: fee out of base
  })

  it('omits feePaid/feeSide when no fee was charged (matches REST path, spec 003 §4)', async () => {
    const data = await emitted(0)
    assert.strictEqual(data.feePaid, undefined)
    assert.strictEqual(data.feeSide, undefined)
  })

  it('leaves every other field on the order untouched', async () => {
    const data = await emitted(0.05)
    assert.strictEqual(data.symbol, 'BTCUSDT')
    assert.strictEqual(data.status, 'FILLED')
    assert.strictEqual(data.filledAmount, 1)
  })
})
