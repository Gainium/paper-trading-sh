import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { SymbolSchema } from '../schema/symbol.schema'
import { ExchangeController } from './exchange.controller'
import { ExchangeService } from './exchange.service'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Symbol.name, schema: SymbolSchema }]),
  ],
  controllers: [ExchangeController],
  exports: [ExchangeService],
  providers: [ExchangeService],
})
export class ExchangeModule {}
