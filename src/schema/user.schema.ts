import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type UserDocument = HydratedDocument<User>

@Schema({ timestamps: true, collection: 'paperUsers' })
export class User {
  @Prop({ required: true, unique: true })
  key: string

  @Prop({ required: true, unique: true })
  secret: string

  @Prop({ required: true })
  username: string

  @Prop({ required: true })
  takerFee: number

  @Prop({ required: true })
  makerFee: number
}

export const UserSchema = SchemaFactory.createForClass(User)
UserSchema.index({ key: 1, secret: 1 })
