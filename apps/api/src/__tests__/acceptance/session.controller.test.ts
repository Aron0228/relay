import {Client} from '@loopback/testlab';
import {createHash} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RelayApplication} from '../../application';
import {OAUTH_CLIENT_TYPE} from '../../models';
import {
  OAUTH_TRANSACTION_REPOSITORY_BINDING_KEY,
  OAuthTransactionRepository,
} from '../../repositories';
import {
  SESSION_STORE_SERVICE_BINDING_KEY,
  SessionStoreService,
} from '../../services';
import {setupApplication} from './test-helper';

describe('SessionController (acceptance)', () => {
  let app: RelayApplication;
  let client: Client;
  let repository: OAuthTransactionRepository;
  let store: SessionStoreService;
  const states: string[] = [];
  const webRedirect = 'https://candy-kingdom.example/auth/callback';
  const mobileRedirect = 'ooo://tree-fort/auth/callback';
  const callback = 'https://relay.ooo.example/api/sessions/callback';

  beforeAll(async () => {
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'princess-bubblegum');
    vi.stubEnv('GITHUB_OAUTH_CALLBACK_URI', callback);
    vi.stubEnv('OAUTH_WEB_REDIRECT_URI', webRedirect);
    vi.stubEnv('OAUTH_MOBILE_REDIRECT_URI', mobileRedirect);
    vi.stubEnv('OAUTH_TRANSACTION_TTL_MINUTES', '2');
    ({app, client} = await setupApplication());
    repository = await app.get<OAuthTransactionRepository>(
      OAUTH_TRANSACTION_REPOSITORY_BINDING_KEY,
    );
    app.getBinding(OAUTH_TRANSACTION_REPOSITORY_BINDING_KEY).to(repository);
    store = await app.get<SessionStoreService>(
      SESSION_STORE_SERVICE_BINDING_KEY,
    );
  });

  afterAll(async () => {
    try {
      for (const state of states) await store.deleteTransaction(state);
    } finally {
      await app?.stop();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ['', OAUTH_CLIENT_TYPE.Web, webRedirect],
    ['?client=web', OAUTH_CLIENT_TYPE.Web, webRedirect],
    ['?client=mobile', OAUTH_CLIENT_TYPE.Mobile, mobileRedirect],
  ])(
    'redirects %s to GitHub with a persisted PKCE transaction',
    async (query, clientType, redirectUri) => {
      const response = await client
        .get(`/api/sessions/login${query}`)
        .expect(302);
      const url = new URL(response.headers.location);
      const state = url.searchParams.get('state')!;
      states.push(state);
      const transaction = await repository.findById(state);
      expect(url.origin + url.pathname).toBe(
        'https://github.com/login/oauth/authorize',
      );
      expect(url.searchParams.get('client_id')).toBe('princess-bubblegum');
      expect(url.searchParams.get('redirect_uri')).toBe(callback);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBe(
        createHash('sha256')
          .update(transaction.codeVerifier)
          .digest('base64url'),
      );
      expect(response.headers.location).not.toContain(transaction.codeVerifier);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(transaction.clientType).toBe(clientType);
      expect(transaction.redirectUri).toBe(redirectUri);
      expect(
        transaction.expiresAt.getTime() - transaction.createdAt.getTime(),
      ).toBe(2 * 60 * 1000);
      expect((await store.getTransaction(state))?.state).toBe(state);
      expect(new Set(states).size).toBe(states.length);
    },
  );

  it('rejects an unsupported client before creating a transaction', async () => {
    const create = vi.spyOn(repository, 'create');
    try {
      await client.get('/api/sessions/login?client=ice-king').expect(400);
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });
});
