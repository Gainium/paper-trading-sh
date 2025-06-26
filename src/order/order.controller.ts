import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { OrderSide, OrderType } from '../schema/order.schema'
import { OrderService } from './order.service'
import { ExchangeEnum } from '../exchange/types'
import { PositionSide } from '../schema/positions.schema'

export type CreateOrderDto = {
  key: string
  secret: string
  symbol: string
  amount: number
  type: OrderType
  exchange: ExchangeEnum
  side: OrderSide
  externalId: string
  price: number
  reduceOnly?: boolean
  positionSide?: PositionSide
}

@Controller('order')
export class OrderController {
  constructor(@Inject(OrderService) private orderService: OrderService) {}

  @Post()
  async createOrder(@Body() body: CreateOrderDto) {
    try {
      const result = await this.orderService.createOrder(body)
      return result
    } catch (e) {
      if (e?.message.includes('duplicate key error')) {
        throw new HttpException('Duplicated externalId + symbol', 400)
      }
      throw e
    }
  }

  @Get()
  async getOrder(
    @Query('key') key: string,
    @Query('secret') secret: string,
    @Query('newClientOrderId') externalId: string,
    @Query('symbol') symbol: string,
  ) {
    return this.orderService.getOrderByKeySecretExternalIdAndSymbol(
      key,
      secret,
      externalId,
      symbol,
    )
  }

  @Get('/:orderId')
  async getOrderById(
    @Query('key') key: string,
    @Query('secret') secret: string,
    @Param('orderId') orderId: string,
  ) {
    return this.orderService.getOrderByKeySecretAndOrderId(key, secret, orderId)
  }

  @Get('/all/open')
  async getAllOpenOrders(
    @Query('key') key: string,
    @Query('secret') secret: string,
    @Query('symbol') symbol?: string,
  ) {
    return this.orderService.getAllOpenOrdersByKeySecretAndSymbol(
      key,
      secret,
      symbol,
    )
  }

  @Delete()
  async cancelOrder(
    @Body()
    body: {
      key: string
      secret: string
      externalId: string
    },
  ) {
    return await this.orderService.cancelOrderByKeySecretExternalIdAndSymbol(
      body.key,
      body.secret,
      body.externalId,
    )
  }

  @Delete('/byid')
  async cancelOrderByOrderId(
    @Body()
    body: {
      key: string
      secret: string
      orderId: string
    },
  ) {
    return await this.orderService.cancelOrderByKeySecretIdAndSymbol(
      body.key,
      body.secret,
      body.orderId,
    )
  }
}
