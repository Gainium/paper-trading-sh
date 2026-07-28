import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import mongoose, { HydratedDocument } from 'mongoose'
import { ExchangeEnum } from '../exchange/types'

export type WalletDocument = HydratedDocument<Wallet>

// Mirrors the server-side $jsonSchema validator installed on the paperWallets
// collection (`{ free|locked: { minimum: -2.220446049250313e-8 } }`). Mongo
// rejects the whole write when a $inc pushes either field below it, so any code
// that decrements a wallet must respect this floor. Keep the two in sync.
export const walletBalanceMin = -2.220446049250313e-8

@Schema({ timestamps: true, collection: 'paperWallets' })
export class Wallet {
  @Prop({ required: true, type: mongoose.Schema.Types.ObjectId, ref: 'User' })
  user: mongoose.Schema.Types.ObjectId

  @Prop({ required: false, enum: ExchangeEnum })
  exchange: ExchangeEnum

  @Prop({ required: true })
  asset: string

  @Prop({ required: true, min: walletBalanceMin })
  locked: number

  @Prop({ required: true, min: walletBalanceMin })
  free: number
}

export const WalletSchema = SchemaFactory.createForClass(Wallet)
WalletSchema.index({ user: 1 })
