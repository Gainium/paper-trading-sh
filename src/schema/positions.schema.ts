import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import mongoose, { HydratedDocument, now } from 'mongoose'
import { ExchangeEnum } from '../exchange/types'

export type PositionDocument = HydratedDocument<Position>

export enum PositionSide {
  both = 'BOTH',
  long = 'LONG',
  short = 'SHORT',
}

export enum PositionStatus {
  new = 'NEW',
  closed = 'CLOSED',
}

export type PositionInfo = {
  symbol: string
  initialMargin: string
  maintMargin: string
  unrealizedProfit: string
  positionInitialMargin: string
  openOrderInitialMargin: string
  leverage: string
  isolated: boolean
  entryPrice: string
  maxNotional: string
  positionSide: PositionSide
  positionAmt: string
  notional: string
  isolatedWallet: string
  updateTime: number
  bidNotional: string
  askNotional: string
}

@Schema({ timestamps: true, collection: 'paperFutures' })
export class Position {
  @Prop({ required: true })
  symbol: string

  @Prop({ required: true })
  margin: number

  @Prop({ required: true })
  entryPrice: number

  @Prop({ required: true })
  closePrice: number

  @Prop({ required: true })
  liquidationPrice: number

  @Prop({ required: true })
  positionSide: PositionSide

  @Prop({ required: true })
  positionAmt: number

  @Prop({ required: true })
  status: PositionStatus

  @Prop({ required: true, type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  user: mongoose.Schema.Types.ObjectId

  @Prop({ required: true, enum: ExchangeEnum })
  exchange: ExchangeEnum

  @Prop({ default: now })
  createdAt: Date

  @Prop({ default: now })
  updatedAt: Date

  @Prop({ required: true })
  uuid: string

  @Prop({ required: true, default: 0 })
  profit: number

  @Prop({ required: true, default: 0 })
  fee: number

  @Prop({ required: true, default: 1 })
  leverage: number
}

export type PositionDataType = {
  _id: mongoose.Types.ObjectId
  symbol: string
  margin: number
  entryPrice: number
  closePrice: number
  liquidationPrice: number
  positionSide: PositionSide
  positionAmt: number
  user: mongoose.Schema.Types.ObjectId
  exchange: ExchangeEnum
  createdAt: Date
  updatedAt: Date
  id: string
  status: PositionStatus
  profit: number
  fee: number
  leverage: number
  uuid: string
}

export const PositionSchema = SchemaFactory.createForClass(Position)
PositionSchema.index({ uuid: 1 }, { unique: true })
PositionSchema.index({ user: 1 })

export type LocalPosition = Omit<PositionDataType, 'user'> & {
  user: string
}

export type CurrentPositions = Map<string, Map<string, LocalPosition>>
