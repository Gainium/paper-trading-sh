import { createClient, RedisClientType } from 'redis'
import { Logger } from '@nestjs/common'
import { isMainThread, threadId } from 'worker_threads'
import { IdMute, IdMutex } from '../utils/mutex'
import { v4 } from 'uuid'

const mutex = new IdMutex()

const prefix = `${isMainThread ? 'Main thread' : `Worker ${threadId}`} |`

const reconnectStrategy = (retries: number, cause: Error) => {
  const wait = 3000
  Logger.error(
    `${prefix} Reconnecting to Redis, ${cause}. Attempt ${retries}. Waiting ${wait}ms to try again.`,
  )
  if (retries > 1000) {
    Logger.error(
      `${prefix} Too many attempts to reconnect. Redis connection was terminated`,
    )
    return new Error('Too many retries.')
  }
  return wait
}

const getClient = async (count = 0): Promise<RedisClientType> => {
  try {
    //@ts-ignore
    const client: RedisClientType = await createClient({
      password: process.env.REDIS_PASSWORD,
      socket: {
        port: +(process.env.REDIS_PORT ?? 6379),
        host: process.env.REDIS_HOST ?? 'localhost',
        reconnectStrategy,
      },
    })
      .on('error', (err) => {
        Logger.error(`${prefix} Redis Client Error: ${err}`)
      })
      .on('connect', () => {
        Logger.log(`${prefix} Redis Client Connected`)
      })
      .on('reconnecting', () =>
        Logger.log(`${prefix} Redis Client reconnecting`),
      )
      .connect()
      .catch((e) => {
        Logger.error(
          `${prefix} Redis Client Connect Error: ${e}, count: ${count}, sleep 5s`,
        )
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(getClient(count + 1))
          }, 5000)
        })
      })
    //@ts-ignore
    return client
  } catch (e) {
    Logger.error(
      `${prefix} Redis Get Client Error: ${e}, count: ${count}, sleep 5s`,
    )
    return getClient(count + 1)
  }
}

export class RedisWrapper {
  private instance: RedisClientType | null = null
  private subscribeMap: Map<
    string,
    Set<(msg: string, channel: string) => void>
  > = new Map()
  private checkTimer: NodeJS.Timeout | null = null
  private retries = 0
  private timers: Map<string, NodeJS.Timeout> = new Map()
  constructor() {
    this.subscribeAll = this.subscribeAll.bind(this)
  }
  private async subscribeAll() {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer)
    }
    if (this.instance && this.instance.isReady) {
      this.retries = 0
      for (const [key, cbs] of this.subscribeMap.entries()) {
        Logger.log(`${prefix} Redis subscribe to ${key} after reconnect`)
        for (const cb of cbs) {
          this.subscribe(key, cb)
        }
      }
    } else {
      this.retries++
      if (this.retries > 15) {
        Logger.error(`${prefix} Redis is not ready yet, quit and retry`)
        try {
          this.instance?.quit()
        } catch (e) {
          Logger.error(`${prefix} Redis quit Error: ${e}`)
        }
        await this.getInstance()
      }
      Logger.log(
        `${prefix} Redis is not ready yet, retry subscribe all in 5s, Retry: ${this.retries}`,
      )
      this.checkTimer = setTimeout(this.subscribeAll, 5000)
    }
  }
  public async getInstance() {
    this.instance = await getClient()
    this.instance.on('connect', this.subscribeAll)
    return this
  }
  get isReady() {
    return this.instance?.isReady
  }
  public async set(key: string, value: string) {
    if (this.instance && this.instance.isReady) {
      return await this.instance.set(key, value).catch((e) => {
        Logger.error(`${prefix} Redis set Error: ${e}`)
      })
    }
  }
  public async del(key: string) {
    if (this.instance && this.instance.isReady) {
      return await this.instance.del(key).catch((e) => {
        Logger.error(`${prefix} Redis del Error: ${e}`)
      })
    }
  }
  public async get(key: string) {
    if (this.instance && this.instance.isReady) {
      return await this.instance.get(key).catch((e) => {
        Logger.error(`${prefix} Redis get Error: ${e}`)
      })
    }
  }
  public async hSet(key: string, field: string, value: string) {
    if (this.instance && this.instance.isReady) {
      return await this.instance.hSet(key, field, value).catch((e) => {
        Logger.error(`${prefix} Redis hSet Error: ${e}`)
      })
    }
  }
  public async hExpire(key: string, field: string, value: number) {
    if (this.instance && this.instance.isReady) {
      return await this.instance.hExpire(key, field, value).catch((e) => {
        Logger.error(`${prefix} Redis hExpire Error: ${e}`)
      })
    }
  }
  public async hDel(key: string, field: string) {
    if (this.instance && this.instance.isReady) {
      return await this.instance.hDel(key, field).catch((e) => {
        Logger.error(`${prefix} Redis hDel Error: ${e}`)
      })
    }
  }
  public async hGet(key: string, field: string) {
    if (this.instance && this.instance.isReady) {
      return await this.instance.hGet(key, field).catch((e) => {
        Logger.error(`${prefix} Redis hGet Error: ${e}`)
      })
    }
  }
  public async subscribe(
    key: string,
    cb: (msg: string, channel: string) => void,
    timerId?: string,
  ) {
    if (timerId) {
      const get = this.timers.get(timerId)
      if (get) {
        clearTimeout(get)
        this.timers.delete(timerId)
      }
    }
    if (this.instance && this.instance.isReady) {
      const get = this.subscribeMap.get(key) ?? new Set()
      get.add(cb)
      this.subscribeMap.set(key, get)
      return await this.instance.subscribe(key, cb).catch((e) => {
        Logger.error(`${prefix} Redis subscribe Error: ${e}`)
      })
    }
    if (this.instance && !this.instance.isReady) {
      Logger.error(`${prefix} Redis is not ready yet, retry subscribe in 5s`)
      const id = v4()
      this.timers.set(
        id,
        setTimeout(() => {
          this.subscribe(key, cb, id)
        }, 5000),
      )
    }
  }
  public async pSubscribe(
    key: string,
    cb: (msg: string, channel: string) => void,
  ) {
    if (this.instance && this.instance.isReady) {
      return await this.instance.pSubscribe(key, cb).catch((e) => {
        Logger.error(`${prefix} Redis pSubscribe Error: ${e}`)
      })
    }
  }
  public async publish(channel: string, msg: string) {
    if (this.instance && this.instance.isReady) {
      return await this.instance.publish(channel, msg).catch((e) => {
        Logger.error(`${prefix} Redis publish Error: ${e}`)
      })
    }
  }
  public async unsubscribe(
    key: string,
    cb?: (msg: string, channel: string) => void,
  ) {
    if (this.instance && this.instance.isReady) {
      if (cb) {
        const get = this.subscribeMap.get(key) ?? new Set()
        get.delete(cb)
        if (get.size === 0) {
          this.subscribeMap.delete(key)
        } else {
          this.subscribeMap.set(key, get)
        }
      } else {
        this.subscribeMap.delete(key)
      }
      return await this.instance.unsubscribe(key, cb).catch((e) => {
        Logger.error(`${prefix} Redis unsubscribe Error: ${e}`)
      })
    }
  }
  public async quit() {
    if (this.instance && this.instance.isReady) {
      return await this.instance.quit().catch((e) => {
        Logger.error(`${prefix} Redis quit Error: ${e}`)
      })
    }
  }
}

class RedisClient {
  static instance: RedisWrapper

  static instanceSub: Map<string, RedisWrapper> = new Map()
  @IdMute(mutex, () => 'RedisClient')
  static async getInstance(sub = false, id = '') {
    if (sub) {
      let get = RedisClient.instanceSub.get(id)
      if (!get) {
        get = await new RedisWrapper().getInstance()
        RedisClient.instanceSub.set(id, get)
      }
      return get
    }
    if (!RedisClient.instance) {
      RedisClient.instance = await new RedisWrapper().getInstance()
    }
    return RedisClient.instance
  }
  static closeSubInstance(id: string) {
    const get = RedisClient.instanceSub.get(id)
    if (get) {
      get.quit()
    }
    RedisClient.instanceSub.delete(id)
  }
}

export default RedisClient
