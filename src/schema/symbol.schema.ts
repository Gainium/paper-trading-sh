import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'
import { ExchangeEnum } from '../exchange/types'

export type SymbolDocument = HydratedDocument<Symbol>

@Schema({ collection: 'pairs' })
export class Symbol {
  @Prop()
  code?: string
  @Prop({ required: true })
  pair: string

  @Prop({ required: true, enum: ExchangeEnum })
  exchange: ExchangeEnum

  @Prop({ required: true, type: Object })
  baseAsset: {
    minAmount: number
    maxAmount: number
    step: number
    name: string
    maxMarketAmount: number
  }

  @Prop({ required: true, type: Object })
  quoteAsset: {
    minAmount: number
    name: string
  }

  @Prop({ required: true })
  maxOrders: number

  @Prop({ required: true })
  priceAssetPrecision: number

  @Prop()
  created: Date

  @Prop()
  updated: Date

  @Prop({ type: Object })
  priceMultiplier: {
    up: number
    down: number
    decimals: number
  }
}

export const SymbolSchema = SchemaFactory.createForClass(Symbol)
