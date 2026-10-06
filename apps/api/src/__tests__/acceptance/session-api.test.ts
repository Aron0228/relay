import {Client} from '@loopback/testlab';
import {randomInt} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RelayApplication} from '../../application';
import type {User} from '../../models';
import type {SessionRepository, UserRepository} from '../../repositories';
import {SESSION_COOKIE_NAME} from '../../services';
import type {
  RedisService,
  SessionService,
  SessionStoreService,
} from '../../services';
import {setupApplication} from './test-helper';

describe('Session API (acceptance)', () => {
  let app: RelayApplication;
  let client: Client;
  let users: UserRepository;
  let repository: SessionRepository;
  let sessions: SessionService;
  let store: SessionStoreService;
  let redis: ReturnType<RedisService['getClient']>;
  let user: User;
  const hashes: string[] = [];

  beforeAll(async () => {
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);

    ({app, client} = await setupApplication());

    users = await app.get('repositories.UserRepository');
    repository = await app.get('repositories.SessionRepository');
    sessions = await app.get('services.SessionService');
    store = await app.get('services.SessionStoreService');
    redis = (await app.get<RedisService>('services.RedisService')).getClient();

    await redis.ping();

    user = await users.create({
      githubId: randomInt(100000000, 2000000000),
      username: 'BMO',
    });
  });

  afterAll(async () => {
    try {
      for (const hash of hashes) await store.delete(hash);

      if (user) await users.deleteById(user.id);
    } finally {
      await app?.stop();
      vi.unstubAllEnvs();
    }
  });

  async function create() {
    const created = await sessions.create(user);

    hashes.push(created.session.tokenHash);

    return created;
  }

  it.each(['web', 'mobile'])(
    'returns BMO’s profile and logs out the %s session',
    async type => {
      const {token, session} = await create();
      const header = type === 'web' ? 'Cookie' : 'Authorization';
      const value =
        type === 'web' ? `${SESSION_COOKIE_NAME}=${token}` : `Bearer ${token}`;

      const me = await client
        .get('/api/sessions/me')
        .set(header, value)
        .expect(200);

      expect(me.body).toMatchObject({id: user.id, name: 'BMO'});
      expect(me.body.token).toBeUndefined();
      expect(me.body.tokenHash).toBeUndefined();
      expect(me.headers['cache-control']).toBe('no-store');

      const logout = await client
        .post('/api/sessions/logout')
        .set(header, value)
        .expect(204);

      expect(logout.headers.location).toBeUndefined();
      expect(logout.headers['cache-control']).toBe('no-store');

      const cookie = (logout.headers['set-cookie'] as unknown as string[])[0];

      expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect((await repository.findById(session.id)).revokedAt).toBeInstanceOf(
        Date,
      );
      expect(await redis.exists(`relay:session:${session.tokenHash}`)).toBe(0);

      await client.get('/api/sessions/me').set(header, value).expect(401);

      await client.post('/api/sessions/logout').set(header, value).expect(204);
    },
  );

  it('rejects anonymous bootstrap but allows logout to clear a leftover cookie', async () => {
    await client.get('/api/sessions/me').expect(401);

    const logout = await client.post('/api/sessions/logout').expect(204);

    expect(logout.headers['set-cookie']).toBeDefined();
    expect(logout.headers.location).toBeUndefined();
  });

  it('clears an expired session cookie and revokes its stored session', async () => {
    const {token, session} = await create();

    await repository.updateById(session.id, {
      createdAt: new Date(Date.now() - 120000),
      expiresAt: new Date(Date.now() - 60000),
    });

    await redis.del(`relay:session:${session.tokenHash}`);

    await client
      .get('/api/sessions/me')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)
      .expect(401);

    const logout = await client
      .post('/api/sessions/logout')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)
      .expect(204);

    expect(logout.headers['set-cookie']).toBeDefined();
    expect((await repository.findById(session.id)).revokedAt).toBeInstanceOf(
      Date,
    );
  });

  it('logs out only the current session, leaving BMO’s other device signed in', async () => {
    const first = await create();
    const second = await create();

    await client
      .post('/api/sessions/logout')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(204);

    await client
      .get('/api/sessions/me')
      .set('Authorization', `Bearer ${first.token}`)
      .expect(401);

    await client
      .get('/api/sessions/me')
      .set('Authorization', `Bearer ${second.token}`)
      .expect(200);
  });
});
