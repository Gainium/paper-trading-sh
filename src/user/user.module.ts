import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { User, UserSchema } from '../schema/user.schema'
import { UserController } from './user.controller'
import { UserService } from './user.service'
import { Wallet, WalletSchema } from '../schema/wallet.schema'
import { Leverage, LeverageSchema } from '../schema/leverage.schema'
import { Position, PositionSchema } from '../schema/positions.schema'
import { Hedge, HedgeSchema } from '../schema/hedge.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Wallet.name, schema: WalletSchema },
      { name: Leverage.name, schema: LeverageSchema },
      { name: Position.name, schema: PositionSchema },
      { name: Hedge.name, schema: HedgeSchema },
    ]),
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
