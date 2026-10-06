import {Client} from '@loopback/testlab';
import {createHash, randomInt, randomUUID} from 'node:crypto';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RelayApplication} from '../../application';
import {OAUTH_CLIENT_TYPE, OAuthClientType} from '../../models';
import {
  ExchangeCodeRepository,
  OAuthTransactionRepository,
  UserRepository,
} from '../../repositories';
import {
  LoginRateLimitService,
  RedisService,
  SessionStoreService,
} from '../../services';
import {setupApplication} from './test-helper';

describe('OAuth callback (acceptance)', () => {
  let app: RelayApplication;
  let client: Client;
  let store: SessionStoreService;
  let transactions: OAuthTransactionRepository;
  let exchanges: ExchangeCodeRepository;
  let users: UserRepository;
  let redis: ReturnType<RedisService['getClient']>;
  const states: string[] = [];
  const hashes: string[] = [];
  const sessionHashes: string[] = [];
  const githubId = randomInt(100000000, 2000000000);
  const testAddress = `finn-${randomUUID()}`;
  const rateLimitKey = `relay:login-rate-limit:${createHash('sha256').update(testAddress).digest('hex')}`;
  const fetchMock = vi.fn<typeof fetch>();
  const hash = (code: string) =>
    createHash('sha256').update(code).digest('hex');

  beforeAll(async () => {
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'finn-the-human');
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'enchiridion-secret');
    vi.stubEnv(
      'GITHUB_OAUTH_CALLBACK_URI',
      'https://relay.ooo.example/api/sessions/callback',
    );
    vi.stubEnv(
      'OAUTH_WEB_REDIRECT_URI',
      'https://candy-kingdom.example/auth?land=ooo',
    );
    vi.stubEnv('OAUTH_MOBILE_REDIRECT_URI', 'ooo://tree-fort/auth');
    vi.stubEnv('OAUTH_EXCHANGE_TTL_SECONDS', '60');
    vi.stubEnv('LOGIN_MAX_ATTEMPTS', '100');
    vi.stubGlobal('fetch', fetchMock);

    ({app, client} = await setupApplication());

    const limiter = await app.get<LoginRateLimitService>(
      'services.LoginRateLimitService',
    );
    const consume = limiter.consume.bind(limiter);

    vi.spyOn(limiter, 'consume').mockImplementation(() => consume(testAddress));

    transactions = await app.get('repositories.OAuthTransactionRepository');
    exchanges = await app.get('repositories.ExchangeCodeRepository');
    users = await app.get('repositories.UserRepository');
    store = await app.get('services.SessionStoreService');
    redis = (await app.get<RedisService>('services.RedisService')).getClient();

    await redis.ping();
  });

  afterEach(() => fetchMock.mockReset());

  afterAll(async () => {
    try {
      for (const state of states) await store.deleteTransaction(state);
      for (const codeHash of hashes) await store.deleteExchangeCode(codeHash);
      for (const tokenHash of sessionHashes) await store.delete(tokenHash);

      await users.deleteAll({githubId});
      await redis.del(rateLimitKey);
    } finally {
      await app?.stop();

      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  async function login(clientType: OAuthClientType = OAUTH_CLIENT_TYPE.Web) {
    const response = await client
      .get(`/api/sessions/login?client=${clientType}`)
      .expect(302);

    const state = new URL(response.headers.location).searchParams.get('state')!;
    states.push(state);

    return transactions.findById(state);
  }

  function githubSuccess(username = 'Finn-the-human') {
    fetchMock.mockResolvedValueOnce(
      // eslint-disable-next-line @typescript-eslint/naming-convention
      Response.json({access_token: 'github-ooo-token'}),
    );

    fetchMock.mockResolvedValueOnce(
      Response.json({id: githubId, login: username}),
    );
  }

  it.each([OAUTH_CLIENT_TYPE.Web, OAUTH_CLIENT_TYPE.Mobile])(
    'completes a %s callback and stores a hashed, single-use exchange code',
    async clientType => {
      const transaction = await login(clientType);

      githubSuccess();

      const response = await client
        .get('/api/sessions/callback')
        .query({state: transaction.state, code: 'finn-github-code'})
        .expect(302);

      const url = new URL(response.headers.location);
      const code = url.searchParams.get('exchange_code')!;
      const codeHash = hash(code);

      hashes.push(codeHash);

      const exchange = await exchanges.findById(codeHash);
      const user = await users.findById(exchange.userId);

      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(exchange.clientType).toBe(clientType);
      expect(exchange.expiresAt.getTime() - exchange.createdAt.getTime()).toBe(
        60000,
      );
      expect(String(user.githubId)).toBe(String(githubId));
      expect(user.username).toBe('Finn-the-human');

      const expected = new URL(transaction.redirectUri);
      expected.searchParams.set('exchange_code', code);

      expect(url.toString()).toBe(expected.toString());
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(await transactions.exists(transaction.state)).toBe(false);
      expect(
        await redis.exists(`relay:oauth-transaction:${transaction.state}`),
      ).toBe(0);

      const cached = await redis.get(`relay:exchange-code:${codeHash}`);

      expect(cached).not.toContain(code);
      expect(await redis.pexpiretime(`relay:exchange-code:${codeHash}`)).toBe(
        exchange.expiresAt.getTime(),
      );

      const [tokenUrl, options] = fetchMock.mock.calls[0];

      expect(tokenUrl).toBe('https://github.com/login/oauth/access_token');

      const body = options!.body as URLSearchParams;

      expect(body.get('code_verifier')).toBe(transaction.codeVerifier);
      expect(body.get('code')).toBe('finn-github-code');
      expect(body.get('client_secret')).toBe('enchiridion-secret');
      expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({
        Authorization: 'Bearer github-ooo-token',
      });

      await client
        .get('/api/sessions/callback')
        .query({state: transaction.state, code: 'replay'})
        .expect(400);

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const consumed = await Promise.all([
        store.consumeExchangeCode(codeHash),
        store.consumeExchangeCode(codeHash),
      ]);

      expect(consumed.filter(Boolean)).toHaveLength(1);
      expect(await redis.exists(`relay:exchange-code:${codeHash}`)).toBe(0);
    },
  );

  it('reuses the same local user and refreshes their GitHub username', async () => {
    const existing = await users.resolveGithubUser(githubId, 'Finn');
    const transaction = await login();

    githubSuccess('Finn-the-human');

    const response = await client
      .get('/api/sessions/callback')
      .query({state: transaction.state, code: 'rename'})
      .expect(302);

    const codeHash = hash(
      new URL(response.headers.location).searchParams.get('exchange_code')!,
    );

    hashes.push(codeHash);

    expect((await exchanges.findById(codeHash)).userId).toBe(existing.id);
    expect((await users.findById(existing.id)).username).toBe('Finn-the-human');
    expect((await users.count({githubId})).count).toBe(1);
  });

  it('completes Finn’s mobile login from authorization through session exchange', async () => {
    const transaction = await login(OAUTH_CLIENT_TYPE.Mobile);

    githubSuccess();

    const callback = await client
      .get('/api/sessions/callback')
      .query({state: transaction.state, code: 'finn-full-login'})
      .expect(302);

    const exchangeCode = new URL(callback.headers.location).searchParams.get(
      'exchange_code',
    )!;

    hashes.push(hash(exchangeCode));

    const response = await client
      .post('/api/sessions/exchange')
      .send({exchangeCode})
      .expect(200);

    sessionHashes.push(hash(response.body.token));

    const session = await store.get(hash(response.body.token));

    expect(session?.userProfile.name).toBe('Finn-the-human');
    expect(session?.tokenHash).not.toBe(response.body.token);
    expect(response.headers['set-cookie']).toBeUndefined();

    await client
      .post('/api/sessions/exchange')
      .send({exchangeCode})
      .expect(401);
  });

  it('rejects missing, unknown and expired state before contacting GitHub', async () => {
    await client.get('/api/sessions/callback?code=ice-king').expect(400);
    await client
      .get('/api/sessions/callback?state=ice-king&code=bad')
      .expect(400);

    const transaction = await login();

    await transactions.updateById(transaction.state, {
      createdAt: new Date(Date.now() - 120000),
      expiresAt: new Date(Date.now() - 60000),
    });

    await client
      .get('/api/sessions/callback')
      .query({state: transaction.state, code: 'expired'})
      .expect(400);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{error: 'access_denied'}, 401],
    [{}, 400],
  ])(
    'consumes state when GitHub denies authorization or omits the code',
    async (query, status) => {
      const transaction = await login();

      await client
        .get('/api/sessions/callback')
        .query({state: transaction.state, ...query})
        .expect(status);

      expect(await transactions.exists(transaction.state)).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects a failed GitHub code exchange without issuing an exchange code', async () => {
    const transaction = await login();

    fetchMock.mockResolvedValueOnce(
      Response.json({error: 'bad_verification_code'}),
    );

    await client
      .get('/api/sessions/callback')
      .query({state: transaction.state, code: 'bad'})
      .expect(401);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await transactions.exists(transaction.state)).toBe(false);
  });

  it('returns 502 for a GitHub outage and prevents retrying the consumed state', async () => {
    const transaction = await login();

    fetchMock.mockRejectedValueOnce(new Error('Ice King froze GitHub'));

    await client
      .get('/api/sessions/callback')
      .query({state: transaction.state, code: 'bad'})
      .expect(502);
    await client
      .get('/api/sessions/callback')
      .query({state: transaction.state, code: 'retry'})
      .expect(400);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not consume an expired exchange code', async () => {
    const user = await users.resolveGithubUser(githubId, 'Finn');
    const codeHash = hash('expired-ooo-code');

    hashes.push(codeHash);

    await store.createExchangeCode({
      codeHash,
      userId: user.id,
      clientType: OAUTH_CLIENT_TYPE.Web,
      createdAt: new Date(Date.now() - 120000),
      expiresAt: new Date(Date.now() - 60000),
    });

    expect(await store.consumeExchangeCode(codeHash)).toBeNull();
  });

  it.each(['invalid-user', 'invalid-json', 'user-outage'])(
    'does not issue an exchange code when GitHub returns %s',
    async failure => {
      const transaction = await login();
      const user = await users.resolveGithubUser(githubId, 'Finn-the-human');

      const before = await exchanges.count({userId: user.id});

      fetchMock.mockResolvedValueOnce(
        // eslint-disable-next-line @typescript-eslint/naming-convention
        Response.json({access_token: 'github-ooo-token'}),
      );
      fetchMock.mockResolvedValueOnce(
        failure === 'invalid-user'
          ? Response.json({id: -1, login: 'Ice-King'})
          : failure === 'invalid-json'
            ? new Response('{frozen-json')
            : new Response('', {status: 503}),
      );

      await client
        .get('/api/sessions/callback')
        .query({state: transaction.state, code: 'bad-user'})
        .expect(502);

      expect(await exchanges.count({userId: user.id})).toEqual(before);
      expect(await transactions.exists(transaction.state)).toBe(false);
    },
  );
});
