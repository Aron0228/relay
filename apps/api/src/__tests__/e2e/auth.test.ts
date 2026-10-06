import {Client} from '@loopback/testlab';
import {createHash, randomInt, randomUUID} from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {RelayApplication} from '../../application';
import type {OAuthClientType} from '../../models';
import type {
  OAuthTransactionRepository,
  SessionRepository,
  UserRepository,
} from '../../repositories';
import {SESSION_COOKIE_NAME} from '../../services';
import type {
  LoginRateLimitService,
  RedisService,
  SessionStoreService,
} from '../../services';
import {setupApplication} from '../acceptance/test-helper';

describe('Authentication flow (e2e)', () => {
  let app: RelayApplication;
  let client: Client;
  let transactions: OAuthTransactionRepository;
  let sessions: SessionRepository;
  let users: UserRepository;
  let store: SessionStoreService;
  let redis: ReturnType<RedisService['getClient']>;
  const states: string[] = [];
  const exchangeHashes: string[] = [];
  const tokenHashes: string[] = [];
  const githubId = randomInt(1_000_000_000, 2_000_000_000);
  const testAddress = `bmo-${randomUUID()}`;
  const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const fetchMock = vi.fn<typeof fetch>();

  beforeAll(async () => {
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'bmo');
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'enchiridion');
    vi.stubEnv(
      'GITHUB_OAUTH_CALLBACK_URI',
      'https://relay.ooo.example/api/sessions/callback',
    );
    vi.stubEnv(
      'OAUTH_WEB_REDIRECT_URI',
      'https://candy-kingdom.example/auth/callback',
    );
    vi.stubEnv('OAUTH_MOBILE_REDIRECT_URI', 'relay://auth/callback');
    vi.stubEnv('LOGIN_MAX_ATTEMPTS', '100');
    vi.stubGlobal('fetch', fetchMock);
    ({app, client} = await setupApplication());
    transactions = await app.get('repositories.OAuthTransactionRepository');
    sessions = await app.get('repositories.SessionRepository');
    users = await app.get('repositories.UserRepository');
    store = await app.get('services.SessionStoreService');
    redis = (await app.get<RedisService>('services.RedisService')).getClient();
    await redis.ping();
    // Keep this suite's localhost requests separate from other suites' counters.
    const limiter = await app.get<LoginRateLimitService>(
      'services.LoginRateLimitService',
    );
    const consume = limiter.consume.bind(limiter);
    vi.spyOn(limiter, 'consume').mockImplementation(() => consume(testAddress));
  });

  beforeEach(() => fetchMock.mockReset());

  afterAll(async () => {
    try {
      for (const state of states) await store.deleteTransaction(state);
      for (const codeHash of exchangeHashes)
        await store.deleteExchangeCode(codeHash);
      for (const tokenHash of tokenHashes) await store.delete(tokenHash);
      await users.deleteAll({githubId});
      await redis.del(`relay:login-rate-limit:${hash(testAddress)}`);
    } finally {
      await app?.stop();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  async function startLogin(type: OAuthClientType = 'web') {
    const response = await client
      .get(`/api/sessions/login?client=${type}`)
      .expect(302);
    const url = new URL(response.headers.location);
    expect(url.origin).toBe('https://github.com');
    const state = url.searchParams.get('state')!;
    states.push(state);
    return state;
  }

  async function signIn(type: OAuthClientType = 'web') {
    const state = await startLogin(type);
    // Only GitHub is simulated; the HTTP API, PostgreSQL, and Redis are real.
    fetchMock.mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/naming-convention
      Response.json({access_token: 'bmo-github-token'}),
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({id: githubId, login: 'BMO'}),
    );
    const callback = await client
      .get('/api/sessions/callback')
      .query({state, code: 'bmo-authorization-code'})
      .expect(302);
    const redirect = new URL(callback.headers.location);
    const exchangeCode = redirect.searchParams.get('exchange_code')!;
    redirect.searchParams.delete('exchange_code');
    expect(redirect.toString()).toBe(
      type === 'web'
        ? 'https://candy-kingdom.example/auth/callback'
        : 'relay://auth/callback',
    );
    exchangeHashes.push(hash(exchangeCode));
    const exchanged = await client
      .post('/api/sessions/exchange')
      .send({exchangeCode})
      .expect(200);
    const cookie =
      type === 'web'
        ? (exchanged.headers['set-cookie'] as unknown as string[])[0].split(
            ';',
          )[0]
        : undefined;
    const token = cookie
      ? cookie.slice(`${SESSION_COOKIE_NAME}=`.length)
      : (exchanged.body.token as string);
    tokenHashes.push(hash(token));
    return {
      state,
      exchangeCode,
      token,
      header: type === 'web' ? 'Cookie' : 'Authorization',
      value: cookie ?? `Bearer ${token}`,
      exchanged,
    };
  }

  it.each(['web', 'mobile'] as const)(
    'logs BMO in, authenticates, and logs out the %s client',
    async type => {
      const login = await signIn(type);
      if (type === 'web') {
        expect(login.exchanged.body).toEqual({});
        const cookie = (
          login.exchanged.headers['set-cookie'] as unknown as string[]
        )[0];
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Lax');
      } else {
        expect(login.exchanged.headers['set-cookie']).toBeUndefined();
      }
      const me = await client
        .get('/api/sessions/me')
        .set(login.header, login.value)
        .expect(200);
      expect(me.body).toMatchObject({name: 'BMO'});
      expect(me.body.tokenHash).toBeUndefined();
      await client
        .post('/api/sessions/exchange')
        .send({exchangeCode: login.exchangeCode})
        .expect(401);
      const logout = await client
        .post('/api/sessions/logout')
        .set(login.header, login.value)
        .expect(204);
      expect(logout.headers['set-cookie']).toBeDefined();
      expect(await redis.exists(`relay:session:${hash(login.token)}`)).toBe(0);
      await client
        .get('/api/sessions/me')
        .set(login.header, login.value)
        .expect(401);
      await client
        .post('/api/sessions/logout')
        .set(login.header, login.value)
        .expect(204);
    },
  );

  it('rejects Ice King’s incorrect state before contacting GitHub', async () => {
    const state = await startLogin();
    await client
      .get('/api/sessions/callback')
      .query({state: `${state}-tampered`, code: 'ice-king'})
      .expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await transactions.exists(state)).toBe(true);
  });

  it('rejects expired OAuth state even when Redis still caches it', async () => {
    const state = await startLogin();
    expect(await redis.exists(`relay:oauth-transaction:${state}`)).toBe(1);
    await transactions.updateById(state, {
      createdAt: new Date(Date.now() - 120000),
      expiresAt: new Date(Date.now() - 60000),
    });
    await client
      .get('/api/sessions/callback')
      .query({state, code: 'too-late'})
      .expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 400],
    [{error: 'access_denied'}, 401],
  ])(
    'rejects an invalid callback %j and prevents replay',
    async (query, status) => {
      const state = await startLogin();
      await client
        .get('/api/sessions/callback')
        .query({state, ...query})
        .expect(status);
      await client
        .get('/api/sessions/callback')
        .query({state, code: 'retry'})
        .expect(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects a callback with an invalid GitHub authorization code', async () => {
    const state = await startLogin();
    fetchMock.mockResolvedValueOnce(
      Response.json({error: 'bad_verification_code'}),
    );
    const response = await client
      .get('/api/sessions/callback')
      .query({state, code: 'ice-king-forgery'})
      .expect(401);
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await transactions.exists(state)).toBe(false);
  });

  it.each(['web', 'mobile'] as const)(
    'rejects an expired %s session',
    async type => {
      const login = await signIn(type);
      const session = await sessions.findOne({
        where: {tokenHash: hash(login.token)},
      });
      await sessions.updateById(session!.id, {
        createdAt: new Date(Date.now() - 120000),
        expiresAt: new Date(Date.now() - 60000),
      });
      // Simulate the cache entry having expired through its Redis TTL.
      await redis.del(`relay:session:${hash(login.token)}`);
      await client
        .get('/api/sessions/me')
        .set(login.header, login.value)
        .expect(401);
      expect(await redis.exists(`relay:session:${hash(login.token)}`)).toBe(0);
    },
  );

  it.each(['web', 'mobile'] as const)(
    'rejects a manipulated %s cookie or token',
    async type => {
      const login = await signIn(type);
      const tampered = `${login.token[0] === '0' ? '1' : '0'}${login.token.slice(1)}`;
      await client
        .get('/api/sessions/me')
        .set(
          login.header,
          type === 'web'
            ? `${SESSION_COOKIE_NAME}=${tampered}`
            : `Bearer ${tampered}`,
        )
        .expect(401);

      await client
        .get('/api/sessions/me')
        .set(login.header, login.value)
        .expect(200);
    },
  );
});
