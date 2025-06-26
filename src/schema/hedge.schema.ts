import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import mongoose, { HydratedDocument, now } from 'mongoose'

export type HedgeDocument = HydratedDocument<Hedge>

@Schema({ timestamps: true, collection: 'paperHedge' })
export class Hedge {
  @Prop({ required: true, type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  user: mongoose.Schema.Types.ObjectId

  @Prop({ required: true })
  hedge: boolean

  @Prop({ default: now })
  createdAt: Date

  @Prop({ default: now })
  updatedAt: Date
}

export type LeverageDataType = {
  _id: mongoose.Types.ObjectId
  hedge: boolean
  user: mongoose.Schema.Types.ObjectId
  createdAt: Date
  updatedAt: Date
  id: string
}

export const HedgeSchema = SchemaFactory.createForClass(Hedge)
HedgeSchema.index({ user: 1 })
