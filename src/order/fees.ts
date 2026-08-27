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
 * free". A paper account configured with a 0% fee genuinely paid nothing, and
 * an estimate of nothing is also nothing, so the two agree.
 */
export function paperOrderFee(order: {
  fee?: number
  exchange: ExchangeEnum
  side: OrderSide
}): { feePaid?: string; feeSide?: 'base' | 'quote' } {
  const fee = Number(order?.fee)
  if (!Number.isFinite(fee) || fee <= 0) {
    return {}
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
