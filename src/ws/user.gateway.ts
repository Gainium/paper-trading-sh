import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'
import { Inject, Logger } from '@nestjs/common'
import { UserService } from '../user/user.service'
import { OrderDataType } from '../schema/order.schema'

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket'],
  pingInterval: 1000 * 60,
  pingTimeout: 1000 * 60 * 2,
  allowUpgrades: false,
})
export class UserGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server: Server
  private balanceClientUsersMap: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >()
  private orderClientUsersMap: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >()

  constructor(@Inject(UserService) private userService: UserService) {}

  async handleConnection(@ConnectedSocket() client: Socket) {
    Logger.log(`${client.id} connected`)
  }

  async handleDisconnect(@ConnectedSocket() client: Socket) {
    Logger.log(`${client.id} disconnected`)
    // Drop this socket from both subscriber maps. Without this the maps leak
    // stale client ids forever: sendOrderToClient/sendBalanceToClient keep
    // emitting to dead sockets, and the maps grow unbounded across the
    // websocket-connector's reconnect churn. (user-stream staleness hygiene.)
    this.removeClientFromMaps(client.id)
  }

  private removeClientFromMaps(clientId: string) {
    for (const map of [this.orderClientUsersMap, this.balanceClientUsersMap]) {
      for (const [userId, clientIds] of map) {
        if (clientIds.delete(clientId) && clientIds.size === 0) {
          map.delete(userId)
        }
      }
    }
  }

  async sendBalanceToClient(userId: string, data: Record<string, unknown>) {
    const clientIds = this.balanceClientUsersMap.get(userId)
    if (!clientIds || clientIds.size === 0) {
      return
    }
    this.server
      .to(Array.from(clientIds))
      .emit('outboundAccountInfo', { type: 'update', data })
  }

  async sendOrderToClient(userId: string, data: OrderDataType) {
    const clientIds = this.orderClientUsersMap.get(userId)
    if (!clientIds || clientIds.size === 0) {
      return
    }
    this.server
      .to(Array.from(clientIds))
      .emit('order', { type: 'update', data })
  }

  @SubscribeMessage('subscribeOutboundAccountInfo')
  private async onAccountInfo(
    @MessageBody() data: { key: string; secret: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const user = await this.userService.getUserByKeyAndSecretOrThrow(
        data.key,
        data.secret,
      )

      this.balanceClientUsersMap.set(
        user.id,
        (this.balanceClientUsersMap.get(user.id) ?? new Set()).add(client.id),
      )
      client.emit('outboundAccountInfo', { type: 'info', info: `subscribed` })
    } catch (e) {
      client.emit('outboundAccountInfo', {
        type: 'error',
        error: e?.message || e,
      })
    }
  }

  @SubscribeMessage('subscribeOrder')
  private async onOrder(
    @MessageBody() data: { key: string; secret: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const user = await this.userService.getUserByKeyAndSecretOrThrow(
        data.key,
        data.secret,
      )
      this.orderClientUsersMap.set(
        user.id,
        (this.orderClientUsersMap.get(user.id) ?? new Set()).add(client.id),
      )
      client.emit('order', { type: 'info', info: `subscribed` })
    } catch (e) {
      client.emit('order', { type: 'error', error: e?.message || e })
    }
  }
}
