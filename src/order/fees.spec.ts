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
import { describe, it, afterEach } from 'mocha'
import { paperOrderFee, isThirdAssetFeeSymbol, thirdAssetFeeTicker } from './fees'
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
    paperOrderFee({
      fee: 0.001,
      exchange: ExchangeEnum.binance,
      side: 'BUY',
      symbol: 'BTCUSDT',
    }),
    { feePaid: '0.001', feeSide: 'base' },
  )
  expect(
    'spot SELL takes the fee out of quote',
    paperOrderFee({
      fee: 0.9,
      exchange: ExchangeEnum.binance,
      side: 'SELL',
      symbol: 'BTCUSDT',
    }),
    { feePaid: '0.9', feeSide: 'quote' },
  )

  // Linear futures settle in the quote coin, on both sides.
  for (const side of ['BUY', 'SELL'] as const) {
    expect(
      `linear futures ${side} settles in quote`,
      paperOrderFee({
        fee: 0.4,
        exchange: ExchangeEnum.binanceUsdm,
        side,
        symbol: 'BTCUSDT',
      }),
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
        symbol: 'BTCUSDT',
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
      paperOrderFee({
        fee,
        exchange: ExchangeEnum.binance,
        side: 'BUY',
        symbol: 'BTCUSDT',
      }),
      {},
    )
  }

  // spec 004: `PAPER_FEE_ASSET_SYMBOLS` reports the SAME charged amount as
  // paid in a third asset (`feeAsset`) instead of splitting it onto
  // `feeSide` — for testing the platform's BNB/BGB/KCS-style discount-asset
  // path without a real account that has one.
  describe('third-asset fee override (spec 004)', () => {
    afterEach(() => {
      delete process.env.PAPER_FEE_ASSET_SYMBOLS
      delete process.env.PAPER_FEE_ASSET
    })

    it('a listed symbol reports feeAsset, not feeSide', () => {
      process.env.PAPER_FEE_ASSET_SYMBOLS = 'BTCUSDT'
      const result = paperOrderFee({
        fee: 0.001,
        exchange: ExchangeEnum.binance,
        side: 'BUY',
        symbol: 'BTCUSDT',
      })
      if (
        result.feePaid !== '0.001' ||
        result.feeAsset !== 'GNM' ||
        result.feeSide !== undefined
      ) {
        throw new Error(`unexpected shape: ${JSON.stringify(result)}`)
      }
    })

    it('defaults the ticker to GNM when PAPER_FEE_ASSET is unset', () => {
      process.env.PAPER_FEE_ASSET_SYMBOLS = 'BTCUSDT'
      if (thirdAssetFeeTicker() !== 'GNM') {
        throw new Error(`expected GNM, got ${thirdAssetFeeTicker()}`)
      }
    })

    it('honors a custom PAPER_FEE_ASSET ticker', () => {
      process.env.PAPER_FEE_ASSET_SYMBOLS = 'BTCUSDT'
      process.env.PAPER_FEE_ASSET = 'test'
      const result = paperOrderFee({
        fee: 0.001,
        exchange: ExchangeEnum.binance,
        side: 'BUY',
        symbol: 'BTCUSDT',
      })
      if (result.feeAsset !== 'TEST') {
        throw new Error(`expected TEST, got ${result.feeAsset}`)
      }
    })

    it('applies identically to futures — the override is venue-type agnostic', () => {
      process.env.PAPER_FEE_ASSET_SYMBOLS = 'BTCUSDT'
      const result = paperOrderFee({
        fee: 0.4,
        exchange: ExchangeEnum.binanceCoinm,
        side: 'SELL',
        symbol: 'BTCUSDT',
      })
      if (result.feeAsset !== 'GNM' || result.feeSide !== undefined) {
        throw new Error(`unexpected shape: ${JSON.stringify(result)}`)
      }
    })

    it('leaves an unlisted symbol on the normal feeSide path', () => {
      process.env.PAPER_FEE_ASSET_SYMBOLS = 'BTCUSDT'
      const result = paperOrderFee({
        fee: 0.001,
        exchange: ExchangeEnum.binance,
        side: 'BUY',
        symbol: 'ETHUSDT',
      })
      if (result.feeSide !== 'base' || result.feeAsset !== undefined) {
        throw new Error(`unexpected shape: ${JSON.stringify(result)}`)
      }
    })

    it('a zero fee still reports nothing at all, listed symbol or not', () => {
      process.env.PAPER_FEE_ASSET_SYMBOLS = 'BTCUSDT'
      const result = paperOrderFee({
        fee: 0,
        exchange: ExchangeEnum.binance,
        side: 'BUY',
        symbol: 'BTCUSDT',
      })
      if (Object.keys(result).length !== 0) {
        throw new Error(`expected {}, got ${JSON.stringify(result)}`)
      }
    })
  })

  describe('isThirdAssetFeeSymbol', () => {
    afterEach(() => {
      delete process.env.PAPER_FEE_ASSET_SYMBOLS
    })

    it('unset → nothing matches', () => {
      delete process.env.PAPER_FEE_ASSET_SYMBOLS
      if (isThirdAssetFeeSymbol('BTCUSDT')) {
        throw new Error('expected false')
      }
    })

    it('matches a listed symbol, case-insensitively', () => {
      process.env.PAPER_FEE_ASSET_SYMBOLS = 'btcusdt,ETHUSDT'
      if (
        !isThirdAssetFeeSymbol('BTCUSDT') ||
        !isThirdAssetFeeSymbol('ethusdt')
      ) {
        throw new Error('expected true for both')
      }
    })

    it('does not match a symbol outside the list', () => {
      process.env.PAPER_FEE_ASSET_SYMBOLS = 'BTCUSDT'
      if (isThirdAssetFeeSymbol('ETHUSDT')) {
        throw new Error('expected false')
      }
    })
  })
})
