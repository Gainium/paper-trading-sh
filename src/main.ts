import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // Which interface to accept connections on.
  //
  // Default is 0.0.0.0 (all interfaces) and MUST stay that way: under Docker
  // this service is its own container and the api/connector containers reach it
  // by hostname over the compose network, so binding it to loopback would make
  // it unreachable to every one of them — including the compose healthcheck
  // other services gate their startup on.
  //
  // A deployment where every client genuinely shares the host can set
  // APP_HOST=127.0.0.1 to take the service off the network entirely. This
  // service authenticates callers by an API key/secret pair only and has no
  // rate limiting, so where loopback is possible it is worth doing.
  const port = process.env.APP_PORT || 80
  const host = process.env.APP_HOST
  // NOTE the two-call shape: `listen(port)` binds dual-stack (`::`, accepting
  // IPv4 as ::ffff: mapped), whereas `listen(port, '0.0.0.0')` is IPv4-only.
  // Passing a default host would therefore be a silent behaviour change, so
  // when APP_HOST is unset we make the exact call this service always made.
  await (host ? app.listen(port, host) : app.listen(port))
}

bootstrap()
