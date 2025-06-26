import type {
  AllPricesResponse,
  BaseReturn,
  CandleResponse,
  ExchangeInfo,
  TradeResponse,
} from './types'
import { ExchangeIntervals, StatusEnum } from './types'

export interface Exchange {
  latestPrice(symbol: string): Promise<BaseReturn<number>>

  getExchangeInfo(symbol: string): Promise<BaseReturn<ExchangeInfo>>

  getAllExchangeInfo(): Promise<BaseReturn<(ExchangeInfo & { pair: string })[]>>

  getCandles(
    symbol: string,
    interval: ExchangeIntervals,
    from?: number,
    to?: number,
    count?: number,
  ): Promise<BaseReturn<CandleResponse[]>>

  getTrades(
    symbol: string,
    fromId?: number,
    startTime?: number,
    endTime?: number,
  ): Promise<BaseReturn<TradeResponse[]>>

  getAllPrices(): Promise<BaseReturn<AllPricesResponse[]>>
}

/** Abstract class for exchanges. Every supported exchange must extends this class */
abstract class AbsctractExchange implements Exchange {
  /** Count price precision */
  getPricePrecision(price: string) {
    let use = price
    // if price exp fromat, 1e-7
    if (price.indexOf('e-') !== -1) {
      use = Number(price).toFixed(parseFloat(price.split('e-')[1]))
    }
    // if price have no 1, 0.00025
    if (use.indexOf('1') === -1) {
      const dec = use.replace('0.', '')
      const numbers = dec.replace(/0/g, '')
      const place = dec.indexOf(numbers)
      if (place <= 1) {
        return place
      }
      //0.0000025
      use = `0.${'0'.repeat(place - 1)}1`
    }
    return use.indexOf('1') === 0 ? 0 : use.replace('0.', '').indexOf('1') + 1
  }

  abstract latestPrice(symbol: string): Promise<BaseReturn<number>>

  abstract getExchangeInfo(symbol: string): Promise<BaseReturn<ExchangeInfo>>

  abstract getAllExchangeInfo(): Promise<
    BaseReturn<(ExchangeInfo & { pair: string })[]>
  >

  abstract getCandles(
    symbol: string,
    interval: ExchangeIntervals,
    from?: number,
    to?: number,
    count?: number,
  ): Promise<BaseReturn<CandleResponse[]>>

  abstract getTrades(
    symbol: string,
    fromId?: number,
    startTime?: number,
    endTime?: number,
  ): Promise<BaseReturn<TradeResponse[]>>

  /**
   * Get all prices
   */
  abstract getAllPrices(): Promise<BaseReturn<AllPricesResponse[]>>

  returnBad() {
    return (e: Error) => ({
      status: StatusEnum.notok,
      reason: e.message,
      data: null,
    })
  }
}

export default AbsctractExchange
