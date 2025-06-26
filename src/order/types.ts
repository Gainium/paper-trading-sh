import { CurrentOrders } from '../schema/order.schema'
import { CurrentPositions } from '../schema/positions.schema'
import { ExchangeEnum, Tick } from '../exchange/types'

export type WorkerDataDto = {
  currentOrders: CurrentOrders
  currentPositions: CurrentPositions
  exchange: ExchangeEnum
  tickerData: Map<string, Tick>
}

export type ReturnData = {
  closePositions: string[]
  processOrders: { order: { symbol: string; externalId: string }; data: Tick }[]
}
