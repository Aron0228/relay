import {Client} from '@loopback/testlab';
import {createHash, randomBytes, randomInt} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RelayApplication} from '../../application';
import {OAUTH_CLIENT_TYPE} from '../../models';
import type {OAuthClientType, User} from '../../models';
import type {
  ExchangeCodeRepository,
  SessionRepository,
  UserRepository,
} from '../../repositories';
import {SESSION_COOKIE_NAME} from '../../services';
import type {
  RedisService,
  SessionService,
  SessionStoreService,
} from '../../services';
import {setupApplication} from './test-helper';

describe('Session exchange (acceptance)', () => {
  let app: RelayApplication;
  let client: Client;
  let user: User;
  let users: UserRepository;
  let sessions: SessionRepository;
  let exchanges: ExchangeCodeRepository;
  let store: SessionStoreService;
  let service: SessionService;
  let redis: ReturnType<RedisService['getClient']>;
  const codeHashes: string[] = [];
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');

  beforeAll(async () => {
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '30');
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '12');

    ({app, client} = await setupApplication());

    users = await app.get('repositories.UserRepository');
    sessions = await app.get('repositories.SessionRepository');
    exchanges = await app.get('repositories.ExchangeCodeRepository');

    app.getBinding('repositories.ExchangeCodeRepository').to(exchanges);

    store = await app.get('services.SessionStoreService');
    service = await app.get('services.SessionService');
    redis = (await app.get<RedisService>('services.RedisService')).getClient();

    await redis.ping();

    user = await users.create({
      githubId: randomInt(100000000, 2000000000),
      username: 'Jake-the-dog',
    });
  });

  afterAll(async () => {
    try {
      for (const codeHash of codeHashes)
        await store.deleteExchangeCode(codeHash);

      if (user) {
        for (const session of await sessions.find({where: {userId: user.id}})) {
          await store.delete(session.tokenHash);
        }

        await users.deleteById(user.id);
      }
    } finally {
      await app?.stop();

      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  async function createCode(
    clientType: OAuthClientType = OAUTH_CLIENT_TYPE.Web,
    expired = false,
  ) {
    const code = randomBytes(32).toString('base64url');
    const codeHash = hash(code);

    codeHashes.push(codeHash);

    const createdAt = new Date(Date.now() - (expired ? 120000 : 0));

    await store.createExchangeCode({
      codeHash,
      userId: user.id,
      clientType,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 60000),
    });

    return code;
  }

  it('gives Jake a secure web cookie without exposing the token in JSON', async () => {
    const exchangeCode = await createCode();

    const response = await client
      .post('/api/sessions/exchange')
      .send({exchangeCode})
      .expect(200);

    expect(response.body).toEqual({});
    expect(response.headers['cache-control']).toBe('no-store');

    const cookies = response.headers['set-cookie'] as unknown as string[];

    expect(cookies).toHaveLength(1);

    const cookie = cookies[0];

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('; HttpOnly');
    expect(cookie).toContain('; Secure');
    expect(cookie).toContain('; SameSite=Lax');
    expect(cookie).toContain('; Path=/');
    expect(cookie).not.toContain('Domain=');

    const token = cookie.split(';')[0].split('=')[1];

    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const session = await sessions.findOne({where: {tokenHash: hash(token)}});

    expect(session?.userId).toBe(user.id);
    expect(session?.userProfile.name).toBe('Jake-the-dog');
    expect(cookie).toContain(
      `Expires=${session!.absoluteExpiresAt.toUTCString()}`,
    );
    expect(await redis.exists(`relay:session:${hash(token)}`)).toBe(1);
    expect(await exchanges.exists(hash(exchangeCode))).toBe(false);
    expect(
      await redis.exists(`relay:exchange-code:${hash(exchangeCode)}`),
    ).toBe(0);
    expect((await service.get(token))?.userId).toBe(user.id);

    await client
      .post('/api/sessions/exchange')
      .send({exchangeCode})
      .expect(401);
  });

  it('returns a mobile token without setting a cookie', async () => {
    const exchangeCode = await createCode(OAUTH_CLIENT_TYPE.Mobile);

    const response = await client
      .post('/api/sessions/exchange')
      .send({exchangeCode})
      .expect(200);

    expect(Object.keys(response.body)).toEqual(['token']);
    expect(response.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');

    const session = await sessions.findOne({
      where: {tokenHash: hash(response.body.token)},
    });

    expect(session?.userId).toBe(user.id);
    expect(session?.tokenHash).not.toBe(response.body.token);
    expect((await service.get(response.body.token))?.userProfile.name).toBe(
      'Jake-the-dog',
    );
  });

  it('allows exactly one simultaneous exchange to create a session', async () => {
    const exchangeCode = await createCode(OAUTH_CLIENT_TYPE.Mobile);
    const before = await sessions.count({userId: user.id});
    const responses = await Promise.all([
      client.post('/api/sessions/exchange').send({exchangeCode}),
      client.post('/api/sessions/exchange').send({exchangeCode}),
    ]);

    expect(responses.map(response => response.status).sort()).toEqual([
      200, 401,
    ]);
    expect((await sessions.count({userId: user.id})).count).toBe(
      before.count + 1,
    );
    expect(
      responses.find(response => response.status === 401)?.headers[
        'set-cookie'
      ],
    ).toBeUndefined();
  });

  it('rejects unknown and expired codes even when Redis has a stale entry', async () => {
    const before = await sessions.count({userId: user.id});

    const exchangeCode = await createCode(OAUTH_CLIENT_TYPE.Mobile, true);

    await redis.set(
      `relay:exchange-code:${hash(exchangeCode)}`,
      JSON.stringify({
        userId: user.id,
        expiresAt: new Date(Date.now() + 60000),
      }),
    );

    for (const code of [randomBytes(32).toString('base64url'), exchangeCode]) {
      const response = await client
        .post('/api/sessions/exchange')
        .send({exchangeCode: code})
        .expect(401);

      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body.token).toBeUndefined();
    }
    expect(await sessions.count({userId: user.id})).toEqual(before);
    expect(
      await redis.exists(`relay:exchange-code:${hash(exchangeCode)}`),
    ).toBe(0);
  });

  it.each([
    {},
    {exchangeCode: ''},
    {exchangeCode: 123},
    {exchangeCode: 'Ice-King'},
    {exchangeCode: null},
  ])('rejects a malformed exchange request: %j', async body => {
    const consume = vi.spyOn(exchanges, 'consume');

    try {
      await client.post('/api/sessions/exchange').send(body).expect(422);

      expect(consume).not.toHaveBeenCalled();
    } finally {
      consume.mockRestore();
    }
  });

  it('does not let the request override the stored client type', async () => {
    const exchangeCode = await createCode();

    await client
      .post('/api/sessions/exchange')
      .send({exchangeCode, clientType: 'mobile'})
      .expect(422);

    expect(await exchanges.exists(hash(exchangeCode))).toBe(true);
  });

  it('creates a session using PostgreSQL when Redis is unavailable', async () => {
    const exchangeCode = await createCode(OAUTH_CLIENT_TYPE.Mobile);
    const redisService = await app.get<RedisService>('services.RedisService');

    redis.disconnect();

    await vi.waitFor(() => expect(redis.status).toBe('end'));

    const getClient = vi
      .spyOn(redisService, 'getClient')
      .mockReturnValue(redis);

    try {
      const response = await client
        .post('/api/sessions/exchange')
        .send({exchangeCode})
        .expect(200);

      expect(
        (
          await sessions.findOne({
            where: {tokenHash: hash(response.body.token)},
          })
        )?.userId,
      ).toBe(user.id);
      await client
        .post('/api/sessions/exchange')
        .send({exchangeCode})
        .expect(401);
    } finally {
      getClient.mockRestore();

      redis = redisService.getClient();

      await redis.ping();
    }
  });
});
