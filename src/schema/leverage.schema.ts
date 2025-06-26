import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import mongoose, { HydratedDocument, now } from 'mongoose'
import { PositionSide } from './positions.schema'

export type LeverageDocument = HydratedDocument<Leverage>

@Schema({ timestamps: true, collection: 'paperLeverages' })
export class Leverage {
  @Prop({ required: true })
  symbol: string

  @Prop({ required: true, type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  user: mongoose.Schema.Types.ObjectId

  @Prop({ required: true })
  leverage: number

  @Prop({ required: true })
  locked: boolean

  @Prop({ enum: PositionSide })
  side: string

  @Prop({ default: now })
  createdAt: Date

  @Prop({ default: now })
  updatedAt: Date
}

export type LeverageDataType = {
  _id: mongoose.Types.ObjectId
  symbol: string
  leverage: number
  locked: boolean
  user: mongoose.Schema.Types.ObjectId
  createdAt: Date
  updatedAt: Date
  id: string
}

export const LeverageSchema = SchemaFactory.createForClass(Leverage)

LeverageSchema.index({ user: 1 })
