import {randomBytes, randomInt, randomUUID} from 'node:crypto';
import {securityId} from '@loopback/security';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {RelayApplication} from '../../../application';
import type {Session, User} from '../../../models';
import type {SessionRepository, UserRepository} from '../../../repositories';
import {
  SESSION_REPOSITORY_BINDING_KEY,
  USER_REPOSITORY_BINDING_KEY,
} from '../../../repositories';
import {setupApplication} from '../../acceptance/test-helper';

describe('SessionRepository (integration)', () => {
  let app: RelayApplication;
  let repository: SessionRepository;
  let users: UserRepository;
  let user: User;
  let githubId: number;

  async function createSession(overrides: Partial<Session> = {}) {
    const createdAt = new Date();
    return repository.create({
      userId: user.id,
      tokenHash: randomBytes(32).toString('hex'),
      userProfile: {
        [securityId]: user.id,
        id: user.id,
        name: user.username,
        roles: ['adventurer'],
        home: 'Tree Fort',
        kingdom: 'Land of Ooo',
      },
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 30 * 60_000),
      absoluteExpiresAt: new Date(createdAt.getTime() + 12 * 60 * 60_000),
      ...overrides,
    });
  }

  beforeAll(async () => {
    ({app} = await setupApplication());
    repository = await app.get<SessionRepository>(
      SESSION_REPOSITORY_BINDING_KEY,
    );
    users = await app.get<UserRepository>(USER_REPOSITORY_BINDING_KEY);
  });

  beforeEach(async () => {
    githubId = randomInt(1_000_000_000, 1_000_000_000_000);
    user = await users.create({
      githubId,
      username: `jake-the-dog-${randomUUID()}`,
    });
  });

  afterEach(async () => {
    // The migration cascades deletion to this user's sessions only.
    await users.deleteAll({githubId});
  });

  afterAll(async () => {
    await app?.stop();
  });

  it('creates and reads a session with JSON profile and timestamp fields', async () => {
    const session = await createSession();
    const stored = await repository.findById(session.id);
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored).toMatchObject({
      userId: user.id,
      tokenHash: session.tokenHash,
      userProfile: session.userProfile,
    });
    expect(stored.createdAt).toEqual(session.createdAt);
    expect(stored.expiresAt).toEqual(session.expiresAt);
    expect(stored.absoluteExpiresAt).toEqual(session.absoluteExpiresAt);
    expect(stored.revokedAt).toBeNull();
  });

  it('applies the creation timestamp default', async () => {
    const before = Date.now();
    const session = await createSession({createdAt: undefined});
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(session.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('finds by token hash and filters sessions by user', async () => {
    const session = await createSession();
    await createSession();
    expect(
      await repository.findOne({where: {tokenHash: session.tokenHash}}),
    ).toMatchObject({id: session.id});
    expect(await repository.find({where: {userId: user.id}})).toHaveLength(2);
    expect(await repository.count({userId: user.id})).toEqual({count: 2});
  });

  it('updates sliding expiry and persists revocation', async () => {
    const session = await createSession();
    const expiresAt = new Date(session.createdAt.getTime() + 60 * 60_000);
    const revokedAt = new Date();
    await repository.updateById(session.id, {expiresAt, revokedAt});
    expect(await repository.findById(session.id)).toMatchObject({
      expiresAt,
      revokedAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    });
  });

  it('deletes a session without deleting its user', async () => {
    const session = await createSession();
    await repository.deleteById(session.id);
    expect(await repository.exists(session.id)).toBe(false);
    expect(await users.exists(user.id)).toBe(true);
    await expect(repository.findById(session.id)).rejects.toMatchObject({
      code: 'ENTITY_NOT_FOUND',
    });
  });

  it('resolves the owning user through the belongsTo accessor', async () => {
    const session = await createSession();
    const owner = await repository.user(session.id);
    expect(owner.id).toBe(user.id);
    expect(owner.username).toBe(user.username);
    expect(String(owner.githubId)).toBe(String(user.githubId));
  });

  it('rejects duplicate token hashes', async () => {
    const session = await createSession();
    await expect(
      createSession({tokenHash: session.tokenHash}),
    ).rejects.toMatchObject({code: '23505'});
    expect(await repository.count({userId: user.id})).toEqual({count: 1});
  });

  it('rejects a session for a nonexistent user', async () => {
    await expect(createSession({userId: randomUUID()})).rejects.toMatchObject({
      code: '23503',
    });
    expect(await repository.count({userId: user.id})).toEqual({count: 0});
  });

  it('rejects an idle expiry beyond the absolute expiry', async () => {
    const absoluteExpiresAt = new Date(Date.now() + 60_000);
    await expect(
      createSession({
        absoluteExpiresAt,
        expiresAt: new Date(absoluteExpiresAt.getTime() + 1),
      }),
    ).rejects.toMatchObject({code: '23514'});
  });

  it('rejects expiry at or before creation', async () => {
    const createdAt = new Date();
    await expect(
      createSession({createdAt, expiresAt: createdAt}),
    ).rejects.toMatchObject({code: '23514'});
  });

  it('removes the user’s sessions when the user is deleted', async () => {
    await createSession();
    await createSession();
    await users.deleteById(user.id);
    expect(await repository.count({userId: user.id})).toEqual({count: 0});
  });
});
