import {randomBytes} from 'node:crypto';
import type Redis from 'ioredis';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RelayApplication} from '../../../application';
import {OAUTH_CLIENT_TYPE} from '../../../models';
import type {OAuthClientType} from '../../../models';
import {OAUTH_TRANSACTION_REPOSITORY_BINDING_KEY} from '../../../repositories';
import type {OAuthTransactionRepository} from '../../../repositories';
import {
  REDIS_SERVICE_BINDING_KEY,
  SESSION_SERVICE_BINDING_KEY,
  SESSION_STORE_SERVICE_BINDING_KEY,
  SessionService,
} from '../../../services';
import type {
  RedisService,
  SessionStoreService,
} from '../../../services';
import {setupApplication} from '../../acceptance/test-helper';

describe('OAuth transaction (integration)', () => {
  let app: RelayApplication;
  let service: SessionService;
  let store: SessionStoreService;
  let repository: OAuthTransactionRepository;
  let redisService: RedisService;
  let redis: Redis;
  const states: string[] = [];
  const webRedirect = 'https://candy-kingdom.example/auth/callback';
  const mobileRedirect = 'ooo://tree-fort/auth/callback';

  const key = (state: string) => `relay:oauth-transaction:${state}`;

  async function create(clientType: OAuthClientType = OAUTH_CLIENT_TYPE.Web) {
    const transaction = await service.createOAuthTransaction(clientType);
    states.push(transaction.state);
    return transaction;
  }

  beforeAll(async () => {
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);
    vi.stubEnv('OAUTH_WEB_REDIRECT_URI', webRedirect);
    vi.stubEnv('OAUTH_MOBILE_REDIRECT_URI', mobileRedirect);
    vi.stubEnv('OAUTH_TRANSACTION_TTL_MINUTES', '2');
    ({app} = await setupApplication());
    repository = await app.get<OAuthTransactionRepository>(
      OAUTH_TRANSACTION_REPOSITORY_BINDING_KEY,
    );
    app.getBinding(OAUTH_TRANSACTION_REPOSITORY_BINDING_KEY).to(repository);
    service = await app.get<SessionService>(SESSION_SERVICE_BINDING_KEY);
    store = await app.get<SessionStoreService>(
      SESSION_STORE_SERVICE_BINDING_KEY,
    );
    redisService = await app.get<RedisService>(REDIS_SERVICE_BINDING_KEY);
    redis = redisService.getClient();
    await redis.ping();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    redis = redisService.getClient();
    try {
      await redis.ping();
      if (states.length) await redis.del(...states.map(key));
    } finally {
      if (states.length) await repository.deleteAll({state: {inq: states}});
      states.length = 0;
    }
  });

  afterAll(async () => {
    try {
      await app?.stop();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([OAUTH_CLIENT_TYPE.Web, OAUTH_CLIENT_TYPE.Mobile])(
    'creates a %s transaction with its approved redirect and configured TTL',
    async clientType => {
      const transaction = await create(clientType);
      expect(transaction.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(transaction.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(transaction.state).not.toBe(transaction.codeVerifier);
      expect(transaction.redirectUri).toBe(
        clientType === OAUTH_CLIENT_TYPE.Web ? webRedirect : mobileRedirect,
      );
      expect(
        transaction.expiresAt.getTime() - transaction.createdAt.getTime(),
      ).toBe(2 * 60 * 1000);
      expect((await repository.findById(transaction.state)).clientType).toBe(
        clientType,
      );
      expect(await redis.pexpiretime(key(transaction.state))).toBe(
        transaction.expiresAt.getTime(),
      );
    },
  );

  it('restores dates on a cache hit without querying PostgreSQL', async () => {
    const transaction = await create();
    const lookup = vi.spyOn(repository, 'findOne');
    const cached = await store.getTransaction(transaction.state);
    expect(cached?.codeVerifier).toBe(transaction.codeVerifier);
    expect(cached?.createdAt).toEqual(transaction.createdAt);
    expect(cached?.expiresAt).toEqual(transaction.expiresAt);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects creation when the client has no approved redirect configured', async () => {
    vi.stubEnv('OAUTH_WEB_REDIRECT_URI', undefined);
    try {
      const unconfigured = new SessionService(store);
      const createRow = vi.spyOn(repository, 'create');
      await expect(
        unconfigured.createOAuthTransaction(OAUTH_CLIENT_TYPE.Web),
      ).rejects.toThrow('An approved OAuth redirect URI must be configured');
      expect(createRow).not.toHaveBeenCalled();
    } finally {
      vi.stubEnv('OAUTH_WEB_REDIRECT_URI', webRedirect);
    }
  });

  it('recovers from a cache miss and malformed JSON', async () => {
    const transaction = await create();
    await redis.del(key(transaction.state));
    expect((await store.getTransaction(transaction.state))?.codeVerifier).toBe(
      transaction.codeVerifier,
    );
    await redis.set(key(transaction.state), '{broken ice kingdom');
    expect((await store.getTransaction(transaction.state))?.codeVerifier).toBe(
      transaction.codeVerifier,
    );
    expect(await redis.pexpiretime(key(transaction.state))).toBe(
      transaction.expiresAt.getTime(),
    );
  });

  it('allows only one concurrent consumer and rejects a stale Redis replay', async () => {
    const transaction = await create();
    const cached = await redis.get(key(transaction.state));
    const results = await Promise.all([
      service.consumeOAuthTransaction(transaction.state),
      service.consumeOAuthTransaction(transaction.state),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(result => result === null)).toHaveLength(1);
    expect(results.find(Boolean)?.codeVerifier).toBe(transaction.codeVerifier);
    expect(await repository.exists(transaction.state)).toBe(false);
    expect(await redis.exists(key(transaction.state))).toBe(0);
    await redis.set(key(transaction.state), cached!);
    expect(await service.consumeOAuthTransaction(transaction.state)).toBeNull();
    expect(await redis.exists(key(transaction.state))).toBe(0);
  });

  it('rejects expired transactions in PostgreSQL even if Redis is stale', async () => {
    const transaction = await create();
    await repository.updateById(transaction.state, {
      createdAt: new Date(Date.now() - 2 * 60 * 1000),
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    expect(await service.consumeOAuthTransaction(transaction.state)).toBeNull();
    expect(await store.getTransaction(transaction.state)).toBeNull();
    expect(await redis.exists(key(transaction.state))).toBe(0);
  });

  it('deletes transactions from both stores and tolerates missing states', async () => {
    const transaction = await create();
    await store.deleteTransaction(transaction.state);
    await store.deleteTransaction(transaction.state);
    expect(await repository.exists(transaction.state)).toBe(false);
    expect(await store.getTransaction(transaction.state)).toBeNull();
    expect(
      await service.consumeOAuthTransaction(
        randomBytes(32).toString('base64url'),
      ),
    ).toBeNull();
  });

  it('creates and consumes once while Redis is disconnected', async () => {
    redis.disconnect();
    await vi.waitFor(() => expect(redis.status).toBe('end'));
    vi.spyOn(redisService, 'getClient').mockReturnValue(redis);
    const transaction = await create();
    expect((await store.getTransaction(transaction.state))?.state).toBe(
      transaction.state,
    );
    expect(
      (await service.consumeOAuthTransaction(transaction.state))?.codeVerifier,
    ).toBe(transaction.codeVerifier);
    expect(await service.consumeOAuthTransaction(transaction.state)).toBeNull();
  });
});
