import { Controller, Get, Inject, Query } from '@nestjs/common'
import { ExchangeEnum, ExchangeIntervals } from './types'
import { ExchangeService } from './exchange.service'

@Controller('/exchange')
export class ExchangeController {
  constructor(
    @Inject(ExchangeService) private exchangeService: ExchangeService,
  ) {}

  @Get('/latestPrice')
  async getLatestPrice(
    @Query('symbol') symbol: string,
    @Query('exchange') exchange: ExchangeEnum,
  ) {
    return this.exchangeService.getLatestPriceInExchange(exchange, symbol)
  }

  @Get()
  async getExchangeInfo(
    @Query('symbol') symbol: string,
    @Query('exchange') exchange: ExchangeEnum,
  ) {
    return this.exchangeService.getExchangeInfo(symbol, exchange)
  }

  @Get('/all')
  async getAllExchangeInfo(@Query('exchange') exchange: ExchangeEnum) {
    return this.exchangeService.getAllExchangeInfo(exchange)
  }

  @Get('/candles')
  async getCandles(
    @Query('exchange') exchange: ExchangeEnum,
    @Query('interval') interval: ExchangeIntervals,
    @Query('symbol') symbol: ExchangeIntervals,
    @Query('from') from: number = null,
    @Query('to') to: number = null,
    @Query('count') count: number = null,
  ) {
    return this.exchangeService.getCandles(
      exchange,
      interval,
      symbol,
      from,
      to,
      count,
    )
  }

  @Get('/trades')
  async getTrades(
    @Query('exchange') exchange: ExchangeEnum,
    @Query('symbol') symbol: ExchangeIntervals,
    @Query('fromId') fromId: number = null,
    @Query('startTime') startTime: number = null,
    @Query('endTime') endTime: number = null,
  ) {
    return this.exchangeService.getTrades(
      exchange,
      symbol,
      fromId,
      startTime,
      endTime,
    )
  }

  @Get('/prices')
  async getAllPrices(@Query('exchange') exchange: ExchangeEnum) {
    return this.exchangeService.getAllPrices(exchange)
  }
}
