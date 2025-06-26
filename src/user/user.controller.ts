import { CreateUserDto, UserService } from './user.service'
import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common'
import { ExchangeEnum } from '../exchange/types'
import { PositionSide } from '../schema/positions.schema'

@Controller('/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  async createUser(@Body() userDto: CreateUserDto) {
    return this.userService.create(userDto)
  }

  @Get('/balance')
  async getUserBalance(
    @Query('key') key: string,
    @Query('secret') secret: string,
  ) {
    return this.userService.getUserBalanceByKeyAndSecret(key, secret)
  }

  @Get('/fees')
  async getUserFees(
    @Query('key') key: string,
    @Query('secret') secret: string,
  ) {
    return this.userService.getUserFeesByKeyAndSecret(key, secret)
  }

  @Get('/verify')
  async verifyUser(@Query('key') key: string, @Query('secret') secret: string) {
    const user = await this.userService.getUserFeesByKeyAndSecret(key, secret)
    if (user) {
      return { verified: true }
    }
    return { verified: false }
  }

  @Post('/margin')
  async changeMargin() {
    return {}
  }

  @Post('/leverage')
  async changeLeverage(
    @Body()
    body: {
      symbol: string
      leverage: number
      key: string
      secret: string
      side: PositionSide
    },
  ) {
    return this.userService.changeLeverage(
      body.key,
      body.secret,
      body.symbol,
      body.leverage,
      body.side,
    )
  }

  @Post('/hedge')
  async changeHedge(
    @Body()
    body: {
      hedge: boolean
      key: string
      secret: string
    },
  ) {
    return this.userService.changeHedge(body.key, body.secret, body.hedge)
  }

  @Get('/hedge')
  async getHedge(
    @Body()
    body: {
      key: string
      secret: string
    },
  ) {
    return this.userService.getHedge(body.key, body.secret)
  }

  @Get('/positions')
  async getPositions(
    @Body()
    body: {
      key: string
      secret: string
    },
  ) {
    return this.userService.getPositions(body.key, body.secret)
  }

  @Put('/topup')
  async topUpUserBalance(
    @Body()
    body: {
      key: string
      secret: string
      stablecoinBalance: number
      exchange: ExchangeEnum
      coinToTopUp: string
    },
  ) {
    return this.userService.topUpUserBalance(
      body.key,
      body.secret,
      body.stablecoinBalance,
      body.exchange,
      body.coinToTopUp,
    )
  }
}
