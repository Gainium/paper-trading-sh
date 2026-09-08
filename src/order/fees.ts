import { ExchangeEnum } from '../exchange/types'
import { OrderSide } from '../schema/order.schema'
import { isCoinm, isFutures } from '../exchange/utils'

/**
 * The simulated fee for a paper order, in the shape the real connectors report
 * theirs (`CommonOrder.feePaid` + `feeSide`).
 *
 * paper-trading mirrors the exchange-connector's contract, and that contract
 * now carries the fee the venue actually charged. The simulator has always
 * charged a fee — `order.fee`, accrued across partial fills and debited from
 * the wallet — it simply never reported one, so a paper deal booked its cost
 * only through main-app's `qty * price * rate` estimate. Reporting the same
 * number the simulation actually took keeps the paper and live paths on one
 * code path in the consumer.
 *
 * `feeSide` is not a new decision. It restates, in one place, the rule the
 * simulator already applies when it debits the wallet in `createOrder` and in
 * the resting-order fill loop:
 *
 *   - inverse futures (coin-m) settle in the BASE coin
 *   - linear futures settle in the QUOTE coin
 *   - spot takes the fee out of the asset RECEIVED: base on a buy, quote on a
 *     sell
 *
 * A zero fee is reported as no fee at all rather than `feePaid: '0'` — the
 * same rule the live connectors follow, so that a consumer treats an
 * unobservable fee as "keep your estimate" rather than as "this fill was
 * free". This is a separate question from WHICH asset a real fee came out
 * of — see `isThirdAssetFeeSymbol` below.
 */

/**
 * Symbols whose fee is reported as paid in a THIRD asset (default ticker
 * `GNM`) rather than split onto `feeSide: base | quote` — for testing how
 * the platform behaves against a genuine BNB/BGB/KCS-style discount account
 * without one. Comma-separated, exchange-agnostic (matches `order.symbol`),
 * e.g. `PAPER_FEE_ASSET_SYMBOLS=BTCUSDT,ETHUSDT` (spec 004).
 *
 * The charged amount and the paper wallet's debit are UNCHANGED — this only
 * changes which asset the fee is reported as having come out of. A real
 * discount account's `fee` amount is the same regardless of which asset
 * happened to cover it; this mirrors that.
 */
export function isThirdAssetFeeSymbol(symbol: string): boolean {
  const list = process.env.PAPER_FEE_ASSET_SYMBOLS
  if (!list) {
    return false
  }
  const target = `${symbol ?? ''}`.toUpperCase()
  return list
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .includes(target)
}

/** The ticker `isThirdAssetFeeSymbol` symbols report their fee as paid in. */
export function thirdAssetFeeTicker(): string {
  return (process.env.PAPER_FEE_ASSET || 'GNM').trim().toUpperCase()
}

export function paperOrderFee(order: {
  fee?: number
  exchange: ExchangeEnum
  side: OrderSide
  symbol: string
}): { feePaid?: string; feeSide?: 'base' | 'quote'; feeAsset?: string } {
  const fee = Number(order?.fee)
  if (!Number.isFinite(fee) || fee <= 0) {
    return {}
  }
  if (isThirdAssetFeeSymbol(order.symbol)) {
    return { feePaid: `${fee}`, feeAsset: thirdAssetFeeTicker() }
  }
  const feeSide: 'base' | 'quote' = isFutures(order.exchange)
    ? isCoinm(order.exchange)
      ? 'base'
      : 'quote'
    : order.side === 'BUY'
      ? 'base'
      : 'quote'
  return { feePaid: `${fee}`, feeSide }
}
