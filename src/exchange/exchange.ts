import { Logger } from '@nestjs/common'
import AbstractExchange from './abstractExchange'
import {
  AllPricesResponse,
  BaseReturn,
  CandleResponse,
  ExchangeEnum,
  ExchangeInfo,
  ExchangeIntervals,
  StatusEnum,
  TradeResponse,
} from './types'
import fetch from 'isomorphic-unfetch'
import queryString from 'querystring'
import RedisClient from '../utils/redis'

class Exchange extends AbstractExchange implements Exchange {
  private readonly exchange: ExchangeEnum
  private allPricesCachePeriod = 1 * 60 * 1000

  constructor(exchange: ExchangeEnum) {
    super()
    this.exchange = exchange
  }

  async getAllExchangeInfo(): Promise<
    BaseReturn<(ExchangeInfo & { pair: string })[]>
  > {
    return this.apiCall<BaseReturn<(ExchangeInfo & { pair: string })[]>>({
      endpoint: 'exchange/all',
      method: 'GET',
      params: {
        exchange: this.exchange,
      },
    }).catch(this.handleError())
  }

  async getExchangeInfo(symbol: string): Promise<BaseReturn<ExchangeInfo>> {
    return this.apiCall<BaseReturn<ExchangeInfo>>({
      endpoint: 'exchange',
      method: 'GET',
      params: {
        symbol,
        exchange: this.exchange,
      },
      isPrivate: true,
    }).catch(this.handleError())
  }

  async latestPrice(symbol: string): Promise<BaseReturn<number>> {
    try {
      const client = await RedisClient.getInstance()
      if (client.isReady) {
        const prices = await client.hGet('allPrice', this.exchange)
        if (prices) {
          const parse = JSON.parse(`${prices}`) as BaseReturn<
            AllPricesResponse[]
          >
          if (parse && parse.data && parse.data.length) {
            if (
              !parse.timeProfile?.exchangeRequestEndTime ||
              +new Date() - parse.timeProfile.exchangeRequestEndTime >
                this.allPricesCachePeriod
            ) {
              Logger.log(
                `Got all prices from cache but expired, delete ${this.exchange} from cache`,
              )
              client.hDel('allPrice', this.exchange)
              return this.latestPrice(symbol)
            } else {
              const find = parse.data.find((p) => p.pair === symbol)
              if (find) {
                return {
                  status: StatusEnum.ok,
                  data: find.price,
                  reason: null,
                }
              } else {
                Logger.error(`Symbol not found in cache: ${symbol}`)
              }
            }
          }
        }
      }
    } catch (e) {
      Logger.error(`Error in latestPrice redis cache: ${e}`)
    }
    return this.apiCall<BaseReturn<number>>({
      endpoint: 'latestPrice',
      method: 'GET',
      params: {
        symbol,
        exchange: this.exchange,
      },
    }).catch(this.handleError())
  }

  async getCandles(
    symbol: string,
    interval: ExchangeIntervals,
    from?: number,
    to?: number,
  ): Promise<BaseReturn<CandleResponse[]>> {
    const params: {
      symbol: string
      interval: ExchangeIntervals
      from?: number
      to?: number
    } = {
      symbol,
      interval,
    }
    if (from) {
      params.from = from
    }
    if (to) {
      params.to = to
    }
    return this.apiCall<BaseReturn<CandleResponse[]>>({
      endpoint: 'candles',
      method: 'GET',
      params: {
        ...params,
        exchange: this.exchange,
      },
    }).catch(this.handleError())
  }

  async getTrades(
    symbol: string,
    fromId?: number,
    startTime?: number,
    endTime?: number,
  ): Promise<BaseReturn<TradeResponse[]>> {
    return this.apiCall<BaseReturn<TradeResponse[]>>({
      endpoint: 'trades',
      method: 'GET',
      params: {
        ...{
          symbol,
          fromId,
          startTime,
          endTime,
        },
        exchange: this.exchange,
      },
    }).catch(this.handleError())
  }

  async getAllPrices(): Promise<BaseReturn<AllPricesResponse[]>> {
    try {
      const client = await RedisClient.getInstance()
      if (client.isReady) {
        const prices = await client.hGet('allPrice', this.exchange)
        if (prices) {
          const parse = JSON.parse(`${prices}`) as BaseReturn<
            AllPricesResponse[]
          >
          if (parse && parse.data && parse.data.length) {
            if (
              !parse.timeProfile?.exchangeRequestEndTime ||
              +new Date() - parse.timeProfile.exchangeRequestEndTime >
                this.allPricesCachePeriod
            ) {
              Logger.log(
                `Got all prices from cache but expired, delete ${this.exchange} from cache`,
              )
              client.hDel('allPrice', this.exchange)
              return this.getAllPrices()
            } else {
              return parse
            }
          }
        }
      }
    } catch (e) {
      Logger.error(`Error in getAllPrices redis cache: ${e}`)
    }
    return this.apiCall<BaseReturn<AllPricesResponse[]>>({
      endpoint: 'prices',
      method: 'GET',
      params: {
        exchange: this.exchange,
      },
    }).catch(this.handleError())
  }

  private handleError() {
    return async () => {
      return null
    }
  }

  private apiCall<R>(
    request: {
      endpoint: string
      method: 'POST' | 'GET' | 'DELETE'
      params?: Record<string, string | number | boolean>
      body?: Record<string, unknown>
      isPrivate?: boolean
    },
    count = 0,
  ): Promise<R> {
    const { endpoint, params, body, method } = request
    const query = params ? this.formatQuery(params) : ''
    const authHeaders: Record<string, string> = {
      'Content-type': 'application/json',
    }
    return fetch(
      `${process.env.EXCHANGE_SERVICE_API_URL}/${endpoint}${query}`,
      {
        method,
        body: body ? JSON.stringify(body) : null,
        headers: authHeaders,
      },
    )
      .then((res) => {
        return res.json()
      })
      .then((res) => {
        if (res.statusCode && res.statusCode >= 400) {
          throw new Error(res.message)
        }
        return res
      })
      .catch(async (e) => {
        if (count < 5) {
          return await this.apiCall.bind(this)(request, count + 1)
        }
        throw new Error((e as Error).message)
      })
  }

  private formatQuery(queryObj: Record<string, string | number | boolean>) {
    if (JSON.stringify(queryObj).length !== 2) {
      return '?' + queryString.stringify(queryObj)
    } else {
      return ''
    }
  }
}

export default Exchange
