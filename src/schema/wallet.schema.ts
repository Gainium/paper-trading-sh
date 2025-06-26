import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import mongoose, { HydratedDocument } from 'mongoose'
import { ExchangeEnum } from '../exchange/types'

export type WalletDocument = HydratedDocument<Wallet>

@Schema({ timestamps: true, collection: 'paperWallets' })
export class Wallet {
  @Prop({ required: true, type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  user: mongoose.Schema.Types.ObjectId

  @Prop({ required: false, enum: ExchangeEnum })
  exchange: ExchangeEnum

  @Prop({ required: true })
  asset: string

  @Prop({ required: true, min: -Number.EPSILON })
  locked: number

  @Prop({ required: true, min: -Number.EPSILON })
  free: number
}

export const WalletSchema = SchemaFactory.createForClass(Wallet)
WalletSchema.index({ user: 1 })
