import {createHash, randomInt, randomUUID} from 'node:crypto';
import {securityId} from '@loopback/security';
import type Redis from 'ioredis';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RelayApplication} from '../../../application';
import type {User} from '../../../models';
import type {SessionRepository, UserRepository} from '../../../repositories';
import {
  SESSION_REPOSITORY_BINDING_KEY,
  USER_REPOSITORY_BINDING_KEY,
} from '../../../repositories';
import type {
  RedisService,
  SessionService,
  SessionStoreService,
} from '../../../services';
import {
  REDIS_SERVICE_BINDING_KEY,
  SESSION_SERVICE_BINDING_KEY,
  SESSION_STORE_SERVICE_BINDING_KEY,
} from '../../../services';
import {setupApplication} from '../../acceptance/test-helper';

describe('SessionService (integration)', () => {
  let app: RelayApplication;
  let service: SessionService;
  let users: UserRepository;
  let sessions: SessionRepository;
  let store: SessionStoreService;
  let redis: Redis;
  let user: User;
  const cacheKeys: string[] = [];

  async function createSession() {
    const created = await service.create(user);

    const cacheKey = `relay:session:${created.session.tokenHash}`;

    cacheKeys.push(cacheKey);

    return {...created, cacheKey};
  }

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
    sessions = await app.get<SessionRepository>(SESSION_REPOSITORY_BINDING_KEY);
    store = await app.get<SessionStoreService>(
      SESSION_STORE_SERVICE_BINDING_KEY,
    );

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
      if (cacheKeys.length) await redis.del(...cacheKeys);

      if (user) await users.deleteById(user.id);
    } finally {
      await app?.stop();
      vi.unstubAllEnvs();
    }
  });

  it('creates a session, resolves Finn’s profile, and invalidates it on logout', async () => {
    const {token, session, cacheKey} = await createSession();

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

  it('extends Finn’s idle deadline in PostgreSQL and Redis on activity', async () => {
    const {token, session, cacheKey} = await createSession();
    const oldDeadline = new Date(Date.now() + 60 * 1000);
    await store.update(session.tokenHash, {expiresAt: oldDeadline});

    const before = Date.now();
    const active = await service.get(token);
    const after = Date.now();

    expect(active!.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 30 * 60 * 1000,
    );
    expect(active!.expiresAt.getTime()).toBeLessThanOrEqual(
      after + 30 * 60 * 1000,
    );
    expect(active!.absoluteExpiresAt).toEqual(session.absoluteExpiresAt);
    expect((await sessions.findById(session.id)).expiresAt).toEqual(
      active!.expiresAt,
    );

    const cached = JSON.parse((await redis.get(cacheKey))!) as {
      expiresAt: string;
    };

    expect(cached.expiresAt).toBe(active!.expiresAt.toISOString());
    expect(await redis.pttl(cacheKey)).toBeGreaterThan(29 * 60 * 1000);
  });

  it('never extends Jake’s session beyond its absolute deadline', async () => {
    const {token, session, cacheKey} = await createSession();
    const absoluteExpiresAt = new Date(Date.now() + 60 * 1000);
    await store.update(session.tokenHash, {
      expiresAt: new Date(Date.now() + 30 * 1000),
      absoluteExpiresAt,
    });

    const active = await service.get(token);

    expect(active!.expiresAt).toEqual(absoluteExpiresAt);
    expect(active!.absoluteExpiresAt).toEqual(absoluteExpiresAt);
    expect((await sessions.findById(session.id)).expiresAt).toEqual(
      absoluteExpiresAt,
    );
    expect(await redis.pttl(cacheKey)).toBeGreaterThan(0);
    expect(await redis.pttl(cacheKey)).toBeLessThanOrEqual(60 * 1000);
  });

  it.each(['expiresAt', 'absoluteExpiresAt'] as const)(
    'rejects Ice King’s expired %s without reviving the session',
    async deadline => {
      const {token, session, cacheKey} = await createSession();
      const expiredAt = new Date(Date.now() - 1000);
      await sessions.updateById(session.id, {
        createdAt: new Date(Date.now() - 60 * 1000),
      });
      await store.update(session.tokenHash, {
        expiresAt: expiredAt,
        ...(deadline === 'absoluteExpiresAt'
          ? {absoluteExpiresAt: expiredAt}
          : {}),
      });

      expect(await service.getUserProfile(token)).toBeNull();
      expect((await sessions.findById(session.id))[deadline]).toEqual(
        expiredAt,
      );
      expect(await redis.exists(cacheKey)).toBe(0);
    },
  );

  it('automatically removes BMO’s expired session from Redis through TTL', async () => {
    const {token, session, cacheKey} = await createSession();
    await store.update(session.tokenHash, {
      expiresAt: new Date(Date.now() + 500),
    });
    expect(await redis.pttl(cacheKey)).toBeGreaterThan(0);

    await vi.waitFor(
      async () => {
        expect(await redis.exists(cacheKey)).toBe(0);
      },
      {timeout: 3000, interval: 50},
    );

    expect(await service.get(token)).toBeNull();
    expect(await redis.exists(cacheKey)).toBe(0);
  });
});
