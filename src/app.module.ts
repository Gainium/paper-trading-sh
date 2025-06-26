import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ConfigService } from './config/config.service'
import { ConfigModule } from './config/config.module'
import { UserModule } from './user/user.module'
import { UserGatewayModule } from './ws/user.gateway.module'
import { OrderModule } from './order/order.module'
import { ExchangeModule } from './exchange/exchange.module'
import { ScheduleModule } from '@nestjs/schedule'
import { HealthModule } from './health/health.module'

@Module({
  imports: [
    HealthModule,
    ScheduleModule.forRoot(),
    MongooseModule.forRootAsync({
      useFactory: async (configService: ConfigService) => {
        const config = configService.getMongoConfig()
        return {
          uri: `mongodb://${config.username}:${config.password}@${config.host}:${config.port}/${config.name}`,
        }
      },
      inject: [ConfigService],
      imports: [ConfigModule],
    }),
    UserModule,
    UserGatewayModule,
    OrderModule,
    ExchangeModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
