import { Module } from '@nestjs/common'
import { UserGateway } from './user.gateway'
import { UserModule } from '../user/user.module'

@Module({
  imports: [UserModule],
  providers: [UserGateway],
  exports: [UserGateway],
})
export class UserGatewayModule {}
