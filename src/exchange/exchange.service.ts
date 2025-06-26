import {
  AllPricesResponse,
  BaseReturn,
  CandleResponse,
  ExchangeEnum,
  ExchangeInfo,
  ExchangeIntervals,
  ReturnBad,
  ReturnGood,
  StatusEnum,
  TradeResponse,
} from './types'
import AbstractExchange from './abstractExchange'
import { HttpException, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { SymbolDocument } from '../schema/symbol.schema'
import Exchange from './exchange'

export class ExchangeService {
  constructor(
    @InjectModel(Symbol.name) private symbolModel: Model<SymbolDocument>,
  ) {}

  async getLatestPriceInExchange(
    exchange: ExchangeEnum,
    symbol: string,
  ): Promise<BaseReturn<number>> {
    return this.getExchange(exchange).latestPrice(symbol)
  }

  async getAllPrices(
    exchange: ExchangeEnum,
  ): Promise<BaseReturn<AllPricesResponse[]>> {
    return this.getExchange(exchange).getAllPrices()
  }

  async getExchangeInfo(
    symbol: string,
    exchange: ExchangeEnum,
  ): Promise<ExchangeInfo> {
    let symbolData: ReturnGood<ExchangeInfo> | ReturnBad =
      await this.symbolModel
        .findOne({
          pair: symbol,
          exchange,
        })
        .then((data) => ({
          baseAsset: data.baseAsset,
          quoteAsset: data.quoteAsset,
          maxOrders: data.maxOrders,
          priceAssetPrecision: data.priceAssetPrecision,
          priceMultiplier: data.priceMultiplier,
        }))
        .then((data) => {
          return {
            status: StatusEnum.ok,
            data,
            reason: null,
          }
        })
        .catch((e: Error) => {
          return {
            status: StatusEnum.notok,
            data: null,
            reason: e.message,
          }
        })
    if (
      !symbolData ||
      !symbolData.data ||
      symbolData.status === StatusEnum.notok
    ) {
      Logger.warn(`${symbol} not found in DB`)
      symbolData = await this.getExchange(exchange).getExchangeInfo(symbol)
    }
    if (!symbolData) {
      throw new HttpException('Symbol not found', 400)
    }
    return symbolData.data
  }

  async getAllExchangeInfo(
    exchange: ExchangeEnum,
  ): Promise<BaseReturn<(ExchangeInfo & { pair: string })[]>> {
    let symbolsData:
      | ReturnGood<(ExchangeInfo & { pair: string })[]>
      | ReturnBad = await this.symbolModel
      .find({
        exchange,
      })
      .then((data) => {
        return data.map((d) => ({
          baseAsset: d.baseAsset,
          quoteAsset: d.quoteAsset,
          maxOrders: d.maxOrders,
          priceAssetPrecision: d.priceAssetPrecision,
          priceMultiplier: d.priceMultiplier,
          pair: d.pair,
        }))
      })
      .then((data) => {
        return {
          status: StatusEnum.ok,
          data,
          reason: null,
        }
      })
      .catch((e) => {
        Logger.warn(e?.message || e)
        return {
          status: StatusEnum.notok,
          data: null,
          reason: e.message,
        }
      })
    if (
      !symbolsData ||
      symbolsData.status === StatusEnum.notok ||
      !symbolsData.data ||
      symbolsData.data.length === 0
    ) {
      symbolsData = await this.getExchange(exchange).getAllExchangeInfo()
    }
    if (!symbolsData) {
      throw new HttpException('Symbol not found', 400)
    }
    return symbolsData
  }

  getCandles(
    exchange: ExchangeEnum,
    interval: ExchangeIntervals,
    symbol: string,
    from?: number,
    to?: number,
    count?: number,
  ): Promise<BaseReturn<CandleResponse[]>> {
    return this.getExchange(exchange).getCandles(
      symbol,
      interval,
      from,
      to,
      count,
    )
  }

  getTrades(
    exchange: ExchangeEnum,
    symbol: string,
    fromId?: number,
    startTime?: number,
    endTime?: number,
  ): Promise<BaseReturn<TradeResponse[]>> {
    return this.getExchange(exchange).getTrades(
      symbol,
      fromId,
      startTime,
      endTime,
    )
  }

  getBaseAsset(exchange: ExchangeEnum, symbol: string): Promise<string> {
    return this.getExchangeInfo(symbol, exchange)
      .then((res) => res.baseAsset.name)
      .catch(() => {
        throw new HttpException('Asset not found', 400)
      })
  }

  getQuoteAsset(exchange: ExchangeEnum, symbol: string): Promise<string> {
    return this.getExchangeInfo(symbol, exchange)
      .then((res) => res.quoteAsset.name)
      .catch(() => {
        throw new HttpException('Asset not found', 400)
      })
  }

  private getExchange(exchange: ExchangeEnum): AbstractExchange {
    return new Exchange(exchange)
  }
}
