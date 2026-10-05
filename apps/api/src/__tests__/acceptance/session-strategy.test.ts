import {authenticate} from '@loopback/authentication';
import {inject} from '@loopback/core';
import {get} from '@loopback/rest';
import {SecurityBindings, securityId, UserProfile} from '@loopback/security';
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

// This protected route exists only in the test application.
class TreeFortController {
  visit(profile: UserProfile) {
    return {id: profile[securityId], name: profile.name};
  }
}

// Apply decorators directly: Vitest does not transform parameter decorators.
const visit = Object.getOwnPropertyDescriptor(
  TreeFortController.prototype,
  'visit',
)!;
get('/test/tree-fort')(TreeFortController.prototype, 'visit', visit);
authenticate('session')(TreeFortController.prototype, 'visit', visit);
inject(SecurityBindings.USER)(TreeFortController.prototype, 'visit', 0);

describe('SessionStrategy (acceptance)', () => {
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
    vi.stubEnv('SESSION_IDLE_TIMEOUT_MINUTES', '30');
    vi.stubEnv('SESSION_ABSOLUTE_TIMEOUT_HOURS', '12');

    ({app, client} = await setupApplication());

    app.controller(TreeFortController);

    repository = await app.get('repositories.SessionRepository');

    app.getBinding('repositories.SessionRepository').to(repository);

    users = await app.get('repositories.UserRepository');

    app.getBinding('repositories.UserRepository').to(users);

    sessions = await app.get('services.SessionService');
    store = await app.get('services.SessionStoreService');
    redis = (await app.get<RedisService>('services.RedisService')).getClient();

    await redis.ping();

    user = await users.create({
      githubId: randomInt(100000000, 2000000000),
      username: 'Marceline-the-vampire-queen',
    });
  });

  afterAll(async () => {
    try {
      for (const hash of hashes) await store.delete(hash);

      if (user) await users.deleteById(user.id);
    } finally {
      await app?.stop();

      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  async function create() {
    const created = await sessions.create(user);

    hashes.push(created.session.tokenHash);

    return created;
  }

  it('authenticates Marceline with the web session cookie and the cached profile', async () => {
    const {token} = await create();

    const lookup = vi.spyOn(users, 'findById');
    const lookupOne = vi.spyOn(users, 'findOne');

    try {
      const response = await client
        .get('/test/tree-fort')
        .set('Cookie', `other=beemo; ${SESSION_COOKIE_NAME}=${token}`)
        .expect(200);

      expect(response.body).toEqual({id: user.id, name: user.username});
      expect(lookup).not.toHaveBeenCalled();
      expect(lookupOne).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
      lookupOne.mockRestore();
    }
  });

  it('authenticates a mobile Bearer token', async () => {
    const {token} = await create();

    const response = await client
      .get('/test/tree-fort')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.id).toBe(user.id);
  });

  it('accepts case-insensitive Bearer scheme and surrounding whitespace', async () => {
    const {token} = await create();

    await client
      .get('/test/tree-fort')
      .set('Authorization', `bearer   ${token} `)
      .expect(200);
  });

  it('uses PostgreSQL when the session cache is missing', async () => {
    const {token, session} = await create();

    await redis.del(`relay:session:${session.tokenHash}`);

    const response = await client
      .get('/test/tree-fort')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.id).toBe(user.id);
    expect(await redis.exists(`relay:session:${session.tokenHash}`)).toBe(1);
  });

  it.each([
    '',
    'Basic finn',
    'Bearer',
    'Bearer ',
    'Bearer finn jake',
    'Bearer unknown-token',
  ])('rejects a missing or invalid credential: %j', async authorization => {
    const request = client.get('/test/tree-fort');

    if (authorization) request.set('Authorization', authorization);

    await request.expect(401);
  });

  it('rejects a manipulated or empty cookie', async () => {
    for (const value of ['ice-king', '', '%E0%A4%A']) {
      await client
        .get('/test/tree-fort')
        .set('Cookie', `${SESSION_COOKIE_NAME}=${value}`)
        .expect(401);
    }
  });

  it('does not fall back to a valid cookie when an explicit Authorization header is invalid', async () => {
    const {token} = await create();

    await client
      .get('/test/tree-fort')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)
      .set('Authorization', 'Basic ice-king')
      .expect(401);
  });

  it('rejects idle-expired, absolutely expired, and revoked sessions', async () => {
    for (const kind of ['idle', 'absolute', 'revoked']) {
      const {token, session} = await create();

      await repository.updateById(
        session.id,
        kind === 'revoked'
          ? {revokedAt: new Date()}
          : {
              createdAt: new Date(Date.now() - 120000),
              expiresAt: new Date(Date.now() - 60000),
              ...(kind === 'absolute'
                ? {absoluteExpiresAt: new Date(Date.now() - 30000)}
                : {}),
            },
      );

      await redis.del(`relay:session:${session.tokenHash}`);

      await client
        .get('/test/tree-fort')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    }
  });

  it('rejects a revoked session after invalidation', async () => {
    const {token} = await create();

    await sessions.invalidate(token);

    await client
      .get('/test/tree-fort')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${token}`)
      .expect(401);
  });

  it('keeps public endpoints accessible without a session', async () => {
    await client.get('/ping').expect(200);
  });
});
