import {createHash, randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RelayApplication} from '../../../application';
import type {LoginRateLimitService, RedisService} from '../../../services';
import {setupApplication} from '../../acceptance/test-helper';

describe('LoginRateLimitService (integration)', () => {
  let app: RelayApplication;
  let limiter: LoginRateLimitService;
  let redis: ReturnType<RedisService['getClient']>;
  const keys: string[] = [];

  function address(character: string) {
    const ip = `${character}-${randomUUID()}`;
    keys.push(
      `relay:login-rate-limit:${createHash('sha256').update(ip).digest('hex')}`,
    );
    return ip;
  }

  beforeAll(async () => {
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);
    vi.stubEnv('LOGIN_MAX_ATTEMPTS', '3');
    vi.stubEnv('LOGIN_WINDOW_MINUTES', '1');

    ({app} = await setupApplication());

    limiter = await app.get('services.LoginRateLimitService');
    redis = (await app.get<RedisService>('services.RedisService')).getClient();

    await redis.ping();
  });

  afterAll(async () => {
    try {
      if (keys.length) await redis.del(...keys);
    } finally {
      await app?.stop();

      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  it('allows only three concurrent attempts from Ice King, leaving Finn unaffected', async () => {
    const iceKing = address('ice-king');
    const results = await Promise.all(
      Array.from({length: 12}, () => limiter.consume(iceKing)),
    );

    expect(results.filter(result => result === 0)).toHaveLength(3);
    expect(results.filter(result => result > 0)).toHaveLength(9);
    expect(await limiter.consume(address('finn'))).toBe(0);

    const ttl = await redis.pttl(keys[0]);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60 * 1000);
  });

  it('allows BMO to try again after the counter expires', async () => {
    const bmo = address('bmo');

    for (let i = 0; i < 3; i++) expect(await limiter.consume(bmo)).toBe(0);

    expect(await limiter.consume(bmo)).toBeGreaterThan(0);

    await redis.pexpire(keys[keys.length - 1], 100);
    await vi.waitFor(async () => {
      expect(await redis.exists(keys[keys.length - 1])).toBe(0);
    });
    expect(await limiter.consume(bmo)).toBe(0);
  });

  it('rejects login when Redis cannot enforce the limit', async () => {
    const evalCommand = vi
      .spyOn(redis, 'eval')
      .mockRejectedValueOnce(new Error('Redis unavailable'));

    try {
      await expect(limiter.consume(address('lemongrab'))).rejects.toMatchObject(
        {statusCode: 503},
      );
    } finally {
      evalCommand.mockRestore();
    }
  });
});
