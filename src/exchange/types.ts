export const spotMakerFee = 0.001
export const usdmMakerFee = 0.0002
export const coinmMakerFee = 0.0001

export enum StatusEnum {
  ok = 'OK',
  notok = 'NOTOK',
}

export type BaseReturn<T = any> = ReturnGood<T> | ReturnBad

export enum ExchangeEnum {
  binance = 'binance',
  kucoin = 'kucoin',
  kucoinLinear = 'kucoinLinear',
  kucoinInverse = 'kucoinInverse',
  ftx = 'ftx',
  bybit = 'bybit',
  binanceCoinm = 'binanceCoinm',
  binanceUsdm = 'binanceUsdm',
  bybitCoinm = 'bybitInverse',
  bybitUsdm = 'bybitLinear',
  okx = 'okx',
  okxLinear = 'okxLinear',
  okxInverse = 'okxInverse',
  coinbase = 'coinbase',
  bitget = 'bitget',
  bitgetCoinm = 'bitgetCoinm',
  bitgetUsdm = 'bitgetUsdm',
  mexc = 'mexc',
  hyperliquid = 'hyperliquid',
  hyperliquidInverse = 'hyperliquidInverse',
}

export type Ticker = {
  bestAsk: number
  bestBid: number
  bestAskQnt: number
  bestBidQnt: number
  symbol: string
  time: number
  price: number
  eventTime?: number
}

export type ExchangeTimeProfile = {
  attempts: number
  incomingTime: number
  outcomingTime: number
  inQueueStartTime: number
  inQueueEndTime: number
  exchangeRequestStartTime: number
  exchangeRequestEndTime: number
}

export type BalancerTimeProfile = Partial<ExchangeTimeProfile> & {
  balancerIncomingTime: number
  balancerOutcomingTime: number
  balancerRequestStartTime: number
  balancerRequestEndTime: number
}

export type ReturnGood<T> = {
  status: StatusEnum
  data: T
  reason?: null
  timeProfile?: BalancerTimeProfile
}

export type ReturnBad = {
  status: StatusEnum
  data: null
  reason: string
  timeProfile?: BalancerTimeProfile
}

export type ExchangeInfo = {
  code?: string
  baseAsset: {
    minAmount: number
    maxAmount: number
    step: number
    name: string
    maxMarketAmount: number
  }
  quoteAsset: {
    minAmount: number
    name: string
  }
  maxOrders: number
  priceAssetPrecision: number
  priceMultiplier?: {
    up: number
    down: number
    decimals: number
  }
}

export type CandleResponse = {
  open: string
  high: string
  low: string
  close: string
  time: number
  volume: string
}

export type TradeResponse = {
  symbol: string
  price: string
  quantity: string
  firstId: number
  lastId: number
  timestamp: number
}

export enum ExchangeIntervals {
  oneM = '1m',
  threeM = '3m',
  fiveM = '5m',
  fifteenM = '15m',
  thirtyM = '30m',
  oneH = '1h',
  twoH = '2h',
  fourH = '4h',
  eightH = '8h',
  oneD = '1d',
  oneW = '1w',
}

export type AllPricesResponse = {
  pair: string
  price: number
}

export type Tick = {
  bestBid: number
  bestAsk: number
  bidQty: number
  askQty: number
  time: number
}
