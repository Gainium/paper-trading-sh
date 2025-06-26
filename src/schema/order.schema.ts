import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import mongoose, { HydratedDocument, now } from 'mongoose'
import { ExchangeEnum } from '../exchange/types'
import { PositionSide } from './positions.schema'

export type OrderDocument = HydratedDocument<Order>

export type OrderType = 'LIMIT' | 'MARKET'

export type OrderSide = 'BUY' | 'SELL'

export enum OrderStatus {
  CREATED = 'NEW',
  FILLED = 'FILLED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
}

@Schema({ timestamps: true, collection: 'paperPositions' })
export class Order {
  @Prop({ required: true })
  amount: number

  @Prop({ required: true })
  filledAmount: number

  @Prop({ required: true })
  filledQuoteAmount: number

  @Prop({ required: true })
  quoteAmount: number

  @Prop({ required: true })
  price: number

  @Prop({ required: true })
  avgFilledPrice: number

  @Prop({ required: true })
  fee: number

  @Prop()
  feePerc: number

  @Prop({ required: true })
  symbol: string

  @Prop({ required: true, type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  user: mongoose.Schema.Types.ObjectId

  @Prop({ required: true, enum: ExchangeEnum })
  exchange: ExchangeEnum

  @Prop({ required: true, enum: OrderStatus })
  status: OrderStatus

  @Prop({ required: true })
  type: OrderType

  @Prop({ required: true })
  side: OrderSide

  @Prop({ required: true })
  externalId: string

  @Prop({ default: now })
  createdAt: Date

  @Prop({ default: now })
  updatedAt: Date

  @Prop()
  reduceOnly: boolean

  @Prop()
  positionSide: PositionSide
}

export type OrderDataType = {
  _id: mongoose.Types.ObjectId
  amount: number
  filledAmount: number
  filledQuoteAmount: number
  quoteAmount: number
  price: number
  avgFilledPrice: number
  fee: number
  feePerc?: number
  symbol: string
  user: mongoose.Schema.Types.ObjectId
  exchange: ExchangeEnum
  status: OrderStatus
  type: OrderType
  side: OrderSide
  externalId: string
  createdAt: Date
  updatedAt: Date
  id: string
  reduceOnly?: boolean
  positionSide?: PositionSide
}

export const OrderSchema = SchemaFactory.createForClass(Order)
OrderSchema.index({ externalId: 1, symbol: 1 }, { unique: true })
OrderSchema.index({ user: 1 })

export type CurrentOrders = Map<string, Map<string, OrderDataType>>
