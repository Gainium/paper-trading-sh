import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { OrderController } from './order.controller'
import { OrderService } from './order.service'
import { Order, OrderSchema } from '../schema/order.schema'
import { UserModule } from '../user/user.module'
import { ExchangeModule } from '../exchange/exchange.module'
import { UserGatewayModule } from '../ws/user.gateway.module'
import { Position, PositionSchema } from '../schema/positions.schema'
import { Leverage, LeverageSchema } from '../schema/leverage.schema'
import { Hedge, HedgeSchema } from '../schema/hedge.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Position.name, schema: PositionSchema },
      { name: Leverage.name, schema: LeverageSchema },
      { name: Hedge.name, schema: HedgeSchema },
    ]),
    UserModule,
    ExchangeModule,
    UserGatewayModule,
  ],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
