import { HttpException, Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { IsNotEmpty, IsNumber, IsString, validateSync } from 'class-validator'
import { plainToClass } from 'class-transformer'

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  MONGO_DB_USERNAME: string

  @IsString()
  @IsNotEmpty()
  MONGO_DB_PASSWORD: string

  @IsString()
  @IsNotEmpty()
  MONGO_DB_NAME: string

  @IsNumber()
  MONGO_DB_PORT: number

  @IsString()
  @IsNotEmpty()
  MONGO_DB_HOST: string
}

@Injectable()
export class ConfigService implements OnModuleInit {
  constructor(@Inject('ENV') private env: EnvironmentVariables) {}

  async onModuleInit() {
    this.env = this.validateConfig()
  }

  getMongoConfig() {
    return {
      port: this.env.MONGO_DB_PORT,
      name: this.env.MONGO_DB_NAME,
      password: this.env.MONGO_DB_PASSWORD,
      username: this.env.MONGO_DB_USERNAME,
      host: this.env.MONGO_DB_HOST,
    }
  }

  private validateConfig() {
    const validatedConfig = plainToClass(EnvironmentVariables, this.env, {
      enableImplicitConversion: true,
    })
    const errors = validateSync(validatedConfig, {
      skipMissingProperties: false,
    })

    if (errors.length > 0) {
      throw new HttpException(errors.toString(), 400)
    }
    return validatedConfig
  }
}
