import {createHash, randomInt, randomUUID} from 'node:crypto';
import {securityId} from '@loopback/security';
import type Redis from 'ioredis';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RelayApplication} from '../../../application';
import type {User} from '../../../models';
import type {UserRepository} from '../../../repositories';
import {USER_REPOSITORY_BINDING_KEY} from '../../../repositories';
import type {RedisService, SessionService} from '../../../services';
import {
  REDIS_SERVICE_BINDING_KEY,
  SESSION_SERVICE_BINDING_KEY,
} from '../../../services';
import {setupApplication} from '../../acceptance/test-helper';

describe('SessionService (integration)', () => {
  let app: RelayApplication;
  let service: SessionService;
  let users: UserRepository;
  let redis: Redis;
  let user: User;
  let cacheKey: string | undefined;

  beforeAll(async () => {
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '30');
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '12');
    ({app} = await setupApplication());
    service = await app.get<SessionService>(SESSION_SERVICE_BINDING_KEY);
    users = await app.get<UserRepository>(USER_REPOSITORY_BINDING_KEY);
    redis = (
      await app.get<RedisService>(REDIS_SERVICE_BINDING_KEY)
    ).getClient();
    await redis.ping();
    user = await users.create({
      githubId: randomInt(1_000_000_000, 1_000_000_000_000),
      username: `finn-the-human-${randomUUID()}`,
    });
  });

  afterAll(async () => {
    try {
      if (cacheKey) await redis.del(cacheKey);
      if (user) await users.deleteById(user.id);
    } finally {
      await app?.stop();
      vi.unstubAllEnvs();
    }
  });

  it('creates a session, resolves Finn’s profile, and invalidates it on logout', async () => {
    const {token, session} = await service.create(user);
    cacheKey = `relay:session:${session.tokenHash}`;

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(session.tokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(session.tokenHash).not.toBe(token);
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(
      30 * 60 * 1000,
    );
    expect(
      session.absoluteExpiresAt.getTime() - session.createdAt.getTime(),
    ).toBe(12 * 60 * 60 * 1000);

    const active = await service.get(token);
    expect(active?.id).toBe(session.id);
    expect(active?.absoluteExpiresAt).toEqual(session.absoluteExpiresAt);
    expect(active!.expiresAt.getTime()).toBeGreaterThanOrEqual(
      session.expiresAt.getTime(),
    );
    expect(await service.getUserProfile(token)).toMatchObject({
      [securityId]: user.id,
      name: user.username,
    });
    expect(await service.get('ice-king-invalid-token')).toBeNull();

    await service.invalidate(token);
    expect(await service.get(token)).toBeNull();
    expect(await service.getUserProfile(token)).toBeNull();
    expect(await redis.exists(cacheKey)).toBe(0);
  });
});
