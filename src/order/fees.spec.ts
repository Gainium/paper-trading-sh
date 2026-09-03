process.env.NODE_ENV = 'testing'

/**
 * Checks that the simulated fee paper-trading now REPORTS is the same one it
 * has always CHARGED.
 *
 * Run: `npm test` (mocha).
 *
 * The side is the part worth pinning. `paperOrderFee` restates a rule that is
 * otherwise spread across `createOrder` and the resting-order fill loop, where
 * it is expressed only as which wallet balance gets debited — spot debits the
 * asset RECEIVED, futures debit the settle coin. If the two ever disagree, a
 * paper deal books its cost against the wrong side of the pair, so the
 * expectations below are written against the debit each code path performs.
 */
import { describe, it } from 'mocha'
import { paperOrderFee } from './fees'
import { ExchangeEnum } from '../exchange/types'

function expect(label: string, actual: unknown, want: unknown) {
  it(label, () => {
    const ok = JSON.stringify(actual) === JSON.stringify(want)
    if (!ok) {
      throw new Error(
        `${label}: got ${JSON.stringify(actual)} want ${JSON.stringify(want)}`,
      )
    }
  })
}

describe('paperOrderFee', () => {
  // Spot: `createOrder` credits `baseAssetAmount - fee` on a BUY and
  // `quoteAssetAmount - fee` on a SELL — the fee comes out of what was received.
  expect(
    'spot BUY takes the fee out of base',
    paperOrderFee({ fee: 0.001, exchange: ExchangeEnum.binance, side: 'BUY' }),
    { feePaid: '0.001', feeSide: 'base' },
  )
  expect(
    'spot SELL takes the fee out of quote',
    paperOrderFee({ fee: 0.9, exchange: ExchangeEnum.binance, side: 'SELL' }),
    { feePaid: '0.9', feeSide: 'quote' },
  )

  // Linear futures settle in the quote coin, on both sides.
  for (const side of ['BUY', 'SELL'] as const) {
    expect(
      `linear futures ${side} settles in quote`,
      paperOrderFee({ fee: 0.4, exchange: ExchangeEnum.binanceUsdm, side }),
      { feePaid: '0.4', feeSide: 'quote' },
    )
  }

  // Inverse futures settle in the base coin — `isCoinm` is why the fill loop
  // divides by price before applying the rate.
  for (const side of ['BUY', 'SELL'] as const) {
    expect(
      `inverse futures ${side} settles in base`,
      paperOrderFee({
        fee: 0.00002,
        exchange: ExchangeEnum.binanceCoinm,
        side,
      }),
      { feePaid: '0.00002', feeSide: 'base' },
    )
  }

  // Nothing charged → nothing reported. Never `feePaid: '0'`: the live
  // connectors omit an unobservable fee so the caller keeps its estimate, and
  // the simulated path must not be the one that teaches a consumer that a `0`
  // means a free fill.
  for (const [label, fee] of [
    ['zero', 0],
    ['undefined', undefined],
    ['negative', -1],
    ['NaN', Number.NaN],
  ] as [string, any][]) {
    expect(
      `no fee reported for ${label}`,
      paperOrderFee({ fee, exchange: ExchangeEnum.binance, side: 'BUY' }),
      {},
    )
  }
})
