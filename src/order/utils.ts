import { OrderDataType, CurrentOrders } from '../schema/order.schema'
import { LocalPosition, CurrentPositions } from '../schema/positions.schema'

export const getOrdersBySymbols = (
  symbols: string[],
  currentOrders: CurrentOrders,
) => {
  return symbols
    .reduce((acc, symbol) => {
      acc.push(Array.from(currentOrders.get(symbol)?.values() ?? []))
      return acc
    }, [] as OrderDataType[][])
    .flat()
}

export const getPositionsBySymbols = (
  symbols: string[],
  currentPositions: CurrentPositions,
) => {
  return symbols
    .reduce((acc, symbol) => {
      acc.push(Array.from(currentPositions.get(symbol)?.values() ?? []))
      return acc
    }, [] as LocalPosition[][])
    .flat()
}
