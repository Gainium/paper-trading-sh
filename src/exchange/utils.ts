import { Ticker, ExchangeEnum } from './types'

export const sleep = (milliseconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

type BinanceTicker = {
  eventType: string
  eventTime: number
  symbol: string
  priceChange: string
  priceChangePercent: string
  weightedAvg: string
  prevDayClose: string
  curDayClose: string
  closeTradeQuantity: string
  bestBid: string
  bestBidQnt: string
  bestAsk: string
  bestAskQnt: string
  open: string
  high: string
  low: string
  volume: string
  volumeQuote: string
  openTime: number
  closeTime: number
  firstTradeId: number
  lastTradeId: number
  totalTrades: number
}

export const convertBinanceTickers = (tickers: BinanceTicker[]): Ticker[] => {
  return tickers.map((ticker) => ({
    bestAsk: +ticker.bestAsk,
    bestBid: +ticker.bestBid,
    bestAskQnt: +ticker.bestAskQnt,
    bestBidQnt: +ticker.bestBidQnt,
    symbol: ticker.symbol,
    time: ticker.eventTime,
    price: +ticker.curDayClose,
  }))
}

export const isFutures = (exchange: ExchangeEnum) => {
  return [
    ExchangeEnum.binanceCoinm,
    ExchangeEnum.binanceUsdm,
    ExchangeEnum.bybitCoinm,
    ExchangeEnum.bybitUsdm,
    ExchangeEnum.okxLinear,
    ExchangeEnum.okxInverse,
    ExchangeEnum.kucoinLinear,
    ExchangeEnum.kucoinInverse,
    ExchangeEnum.bitgetCoinm,
    ExchangeEnum.bitgetUsdm,
    ExchangeEnum.hyperliquidInverse,
  ].includes(exchange)
}

export const isCoinm = (exchange: ExchangeEnum) => {
  return [
    ExchangeEnum.binanceCoinm,
    ExchangeEnum.bybitCoinm,
    ExchangeEnum.okxInverse,
    ExchangeEnum.kucoinInverse,
    ExchangeEnum.bitgetCoinm,
    ExchangeEnum.hyperliquidInverse,
  ].includes(exchange)
}
