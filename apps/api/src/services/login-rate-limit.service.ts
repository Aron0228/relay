import {BindingScope, injectable, service} from '@loopback/core';
import {HttpErrors} from '@loopback/rest';
import {createHash} from 'node:crypto';
import {RedisService} from './redis.service';

export const LOGIN_RATE_LIMIT_SERVICE_BINDING_KEY =
  'services.LoginRateLimitService';

// Check, increment, and set the expiry atomically across API instances.
const CONSUME_ATTEMPT = `
  local count = tonumber(redis.call('GET', KEYS[1]) or '0')
  if count >= tonumber(ARGV[1]) then
    return math.max(1, redis.call('PTTL', KEYS[1]))
  end
  count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[2])
  end
  return 0
`;

@injectable({scope: BindingScope.SINGLETON})
export class LoginRateLimitService {
  private readonly maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 10);
  private readonly windowMinutes = Number(
    process.env.LOGIN_WINDOW_MINUTES ?? 10,
  );

  constructor(@service(RedisService) private redisService: RedisService) {}

  /** Returns zero when allowed, otherwise seconds until another attempt is allowed. */
  async consume(ip: string): Promise<number> {
    const address = ip.replace(/^::ffff:/, '');
    const hash = createHash('sha256').update(address).digest('hex');
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const retryMs = await Promise.race([
        this.redisService
          .getClient()
          .eval(
            CONSUME_ATTEMPT,
            1,
            `relay:login-rate-limit:${hash}`,
            this.maxAttempts,
            this.windowMinutes * 60 * 1000,
          ) as Promise<number>,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Rate limit timeout')),
            1000,
          );
        }),
      ]);

      return Math.ceil(retryMs / 1000);
    } catch {
      throw new HttpErrors.ServiceUnavailable(
        'Login is temporarily unavailable. Please try again later.',
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
