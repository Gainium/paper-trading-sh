import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common'
import { Request } from 'express'
import { FixedWindowLimiter } from './fixedWindowLimiter'

const num = (raw: string | undefined, fallback: number) => {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Bounds how often one caller may ask "are these credentials valid?".
 *
 * `GET /user/verify` is a clean boolean oracle — 200 `{verified:true}` vs a 400
 * — with no lockout or backoff anywhere, and the secrets it checks are stored
 * in plaintext. Unlimited guesses against a low-entropy pair is the whole
 * finding (GHSA-5xf3-v5jf-jwrc).
 *
 * Generous on purpose. The legitimate caller is main-app verifying a user's
 * paper connection — a handful of calls, occasionally. The limit only needs to
 * sit far below a brute-force rate, not close to real usage. Tune with
 * VERIFY_RATE_LIMIT / VERIFY_RATE_WINDOW_MS.
 */
@Injectable()
export class CredentialProbeThrottleGuard implements CanActivate {
  private readonly logger = new Logger(CredentialProbeThrottleGuard.name)
  private readonly limiter = new FixedWindowLimiter(
    num(process.env.VERIFY_RATE_LIMIT, 30),
    num(process.env.VERIFY_RATE_WINDOW_MS, 60_000),
  )

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    // Keyed on the source only. Keying on the probed credential would let an
    // attacker sidestep the limit simply by varying the key they guess, which
    // is exactly the traffic pattern being bounded.
    const key =
      (req.headers['x-forwarded-for'] as string) ||
      req.socket?.remoteAddress ||
      req.ip ||
      'unknown'
    if (this.limiter.check(key)) return true

    const retryAfter = this.limiter.retryAfterSeconds(key)
    this.logger.warn(
      `Credential-verify rate limit hit from ${key}; retry in ${retryAfter}s`,
    )
    throw new HttpException(
      { statusCode: 429, message: 'Too many requests' },
      429,
    )
  }
}
