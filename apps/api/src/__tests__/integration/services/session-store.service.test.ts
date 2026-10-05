import {randomBytes, randomInt, randomUUID} from 'node:crypto';
import {securityId} from '@loopback/security';
import type Redis from 'ioredis';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {RelayApplication} from '../../../application';
import type {Session, User} from '../../../models';
import type {SessionRepository, UserRepository} from '../../../repositories';
import {
  SESSION_REPOSITORY_BINDING_KEY,
  USER_REPOSITORY_BINDING_KEY,
} from '../../../repositories';
import type {RedisService, SessionStoreService} from '../../../services';
import {
  REDIS_SERVICE_BINDING_KEY,
  SESSION_STORE_SERVICE_BINDING_KEY,
} from '../../../services';
import {setupApplication} from '../../acceptance/test-helper';

describe('SessionStoreService (integration)', () => {
  let app: RelayApplication;
  let store: SessionStoreService;
  let sessions: SessionRepository;
  let users: UserRepository;
  let redisService: RedisService;
  let redis: Redis;
  let user: User;
  let githubId: number;
  const tokenHashes: string[] = [];

  function cacheKey(tokenHash: string) {
    return `relay:session:${tokenHash}`;
  }

  function sessionData(overrides: Partial<Session> = {}) {
    const tokenHash = overrides.tokenHash ?? randomBytes(32).toString('hex');
    tokenHashes.push(tokenHash);
    const createdAt = new Date();
    return {
      userId: user.id,
      tokenHash,
      userProfile: {
        [securityId]: user.id,
        name: 'Finn the Human',
        home: 'Tree Fort',
        companion: 'Jake the Dog',
      },
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 30 * 60_000),
      absoluteExpiresAt: new Date(createdAt.getTime() + 12 * 60 * 60_000),
      ...overrides,
    };
  }

  async function expectCached(session: Session) {
    const cached = await redis.get(cacheKey(session.tokenHash));
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toMatchObject({
      id: session.id,
      userId: user.id,
      tokenHash: session.tokenHash,
      userProfile: {name: session.userProfile.name},
      expiresAt: session.expiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    });
    // PXAT uses the exact persisted deadline, rather than a renewed TTL.
    expect(await redis.pexpiretime(cacheKey(session.tokenHash))).toBe(
      Math.min(
        session.expiresAt.getTime(),
        session.absoluteExpiresAt.getTime(),
      ),
    );
  }

  beforeAll(async () => {
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);
    ({app} = await setupApplication());
    sessions = await app.get<SessionRepository>(SESSION_REPOSITORY_BINDING_KEY);
    // Share the real repository instance so spies observe the service's queries.
    app.getBinding(SESSION_REPOSITORY_BINDING_KEY).to(sessions);
    store = await app.get<SessionStoreService>(
      SESSION_STORE_SERVICE_BINDING_KEY,
    );
    users = await app.get<UserRepository>(USER_REPOSITORY_BINDING_KEY);
    redisService = await app.get<RedisService>(REDIS_SERVICE_BINDING_KEY);
    redis = redisService.getClient();
    await redis.ping();
  });

  beforeEach(async () => {
    redis = redisService.getClient();
    await redis.ping();
    githubId = randomInt(1_000_000_000, 1_000_000_000_000);
    user = await users.create({
      githubId,
      username: `finn-the-human-${randomUUID()}`,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    redis = redisService.getClient();
    try {
      await redis.ping();
      if (tokenHashes.length) await redis.del(...tokenHashes.map(cacheKey));
    } finally {
      tokenHashes.length = 0;
      await users.deleteAll({githubId});
    }
  });

  afterAll(async () => {
    try {
      await app?.stop();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('creates a session in PostgreSQL and caches it with the correct expiry', async () => {
    const session = await store.create(sessionData());
    const persisted = await sessions.findById(session.id);
    expect(persisted.tokenHash).toBe(session.tokenHash);
    expect(persisted.userProfile[securityId]).toBe(user.id);
    expect(persisted.userProfile.name).toBe('Finn the Human');
    await expectCached(session);
  });

  it('reads Redis without a PostgreSQL round trip and restores dates and securityId', async () => {
    const session = await store.create(sessionData());
    const lookup = vi.spyOn(sessions, 'findOne');
    const cached = await store.get(session.tokenHash);
    expect(lookup).not.toHaveBeenCalled();
    expect(cached?.id).toBe(session.id);
    expect(cached?.createdAt).toEqual(session.createdAt);
    expect(cached?.expiresAt).toEqual(session.expiresAt);
    expect(cached?.absoluteExpiresAt).toEqual(session.absoluteExpiresAt);
    expect(cached?.userProfile[securityId]).toBe(user.id);
    expect(cached?.userProfile.companion).toBe('Jake the Dog');
  });

  it('falls back to PostgreSQL on a cache miss and repopulates Redis', async () => {
    const session = await store.create(sessionData());
    await redis.del(cacheKey(session.tokenHash));
    const lookup = vi.spyOn(sessions, 'findOne');
    const restored = await store.get(session.tokenHash);
    expect(lookup).toHaveBeenCalledOnce();
    expect(restored?.id).toBe(session.id);
    expect(restored?.userProfile[securityId]).toBe(user.id);
    await expectCached(session);
  });

  it('repairs malformed cached JSON from PostgreSQL', async () => {
    const session = await store.create(sessionData());
    await redis.set(cacheKey(session.tokenHash), '{broken candy kingdom');
    expect((await store.get(session.tokenHash))?.id).toBe(session.id);
    await expectCached(session);
  });

  it.each(['expiresAt', 'absoluteExpiresAt'] as const)(
    'repairs cached sessions whose %s has passed',
    async field => {
      const session = await store.create(sessionData());
      await redis.set(
        cacheKey(session.tokenHash),
        JSON.stringify({
          ...session.toJSON(),
          [field]: new Date(Date.now() - 60_000).toISOString(),
        }),
      );
      const lookup = vi.spyOn(sessions, 'findOne');
      expect((await store.get(session.tokenHash))?.id).toBe(session.id);
      expect(lookup).toHaveBeenCalledOnce();
      await expectCached(session);
    },
  );

  it('returns null for a missing session and removes an invalid cache entry', async () => {
    const {tokenHash} = sessionData();
    await redis.set(cacheKey(tokenHash), '{broken ice kingdom');
    expect(await store.get(tokenHash)).toBeNull();
    expect(await redis.exists(cacheKey(tokenHash))).toBe(0);
  });

  it('updates PostgreSQL and replaces cached profile and expiry', async () => {
    const session = await store.create(sessionData());
    const expiresAt = new Date(session.createdAt.getTime() + 60 * 60_000);
    const updated = await store.update(session.tokenHash, {
      expiresAt,
      userProfile: {[securityId]: user.id, name: 'Finn the Hero of Ooo'},
    });
    expect(updated?.expiresAt).toEqual(expiresAt);
    expect((await sessions.findById(session.id)).userProfile.name).toBe(
      'Finn the Hero of Ooo',
    );
    await expectCached(updated!);
    expect((await store.get(session.tokenHash))?.userProfile.name).toBe(
      'Finn the Hero of Ooo',
    );
  });

  it('returns null when updating a missing row and evicts its stale cache', async () => {
    const session = await store.create(sessionData());
    await sessions.deleteById(session.id);
    expect(
      await store.update(session.tokenHash, {revokedAt: new Date()}),
    ).toBeNull();
    expect(await redis.exists(cacheKey(session.tokenHash))).toBe(0);
  });

  it('persists revocation and removes the active cache entry', async () => {
    const session = await store.create(sessionData());
    const revokedAt = new Date();
    await store.update(session.tokenHash, {revokedAt});
    expect((await sessions.findById(session.id)).revokedAt).toEqual(revokedAt);
    expect(await redis.exists(cacheKey(session.tokenHash))).toBe(0);
    // The store returns the durable record; SessionService validates lifecycle.
    expect((await store.get(session.tokenHash))?.revokedAt).toEqual(revokedAt);
    expect(await redis.exists(cacheKey(session.tokenHash))).toBe(0);
  });

  it('keeps expired records in PostgreSQL without caching them', async () => {
    const session = await store.create(
      sessionData({
        createdAt: new Date(Date.now() - 2 * 60_000),
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );
    expect(await redis.exists(cacheKey(session.tokenHash))).toBe(0);
    expect((await store.get(session.tokenHash))?.id).toBe(session.id);
    expect(await redis.exists(cacheKey(session.tokenHash))).toBe(0);
  });

  it('deletes from both stores and allows repeated deletion', async () => {
    const session = await store.create(sessionData());
    await store.delete(session.tokenHash);
    await store.delete(session.tokenHash);
    expect(await sessions.exists(session.id)).toBe(false);
    expect(await redis.exists(cacheKey(session.tokenHash))).toBe(0);
    expect(await store.get(session.tokenHash)).toBeNull();
    expect(await users.exists(user.id)).toBe(true);
  });

  it('leaves the existing cache unchanged when PostgreSQL rejects a duplicate', async () => {
    const session = await store.create(sessionData());
    const original = await redis.get(cacheKey(session.tokenHash));
    await expect(
      store.create(
        sessionData({
          tokenHash: session.tokenHash,
          userProfile: {[securityId]: user.id, name: 'Fern the Human'},
        }),
      ),
    ).rejects.toMatchObject({code: '23505'});
    expect(await redis.get(cacheKey(session.tokenHash))).toBe(original);
    expect(await sessions.count({tokenHash: session.tokenHash})).toEqual({
      count: 1,
    });
  });

  it('falls back and repairs Redis after a real Redis command error', async () => {
    const session = await store.create(sessionData());
    await redis.del(cacheKey(session.tokenHash));
    await redis.hset(cacheKey(session.tokenHash), 'villain', 'Ice King');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await store.get(session.tokenHash))?.id).toBe(session.id);
    expect(warning).toHaveBeenCalledOnce();
    await expectCached(session);
  });

  it('supports PostgreSQL CRUD while the Redis client is disconnected', async () => {
    redis.disconnect();
    // Pin the real disconnected client so RedisService does not reopen it.
    vi.spyOn(redisService, 'getClient').mockReturnValue(redis);
    const session = await store.create(sessionData());
    expect((await store.get(session.tokenHash))?.userProfile[securityId]).toBe(
      user.id,
    );
    await store.update(session.tokenHash, {
      userProfile: {[securityId]: user.id, name: 'Finn in the Fire Kingdom'},
    });
    expect((await sessions.findById(session.id)).userProfile.name).toBe(
      'Finn in the Fire Kingdom',
    );
    await store.delete(session.tokenHash);
    expect(await sessions.exists(session.id)).toBe(false);
  });
});
