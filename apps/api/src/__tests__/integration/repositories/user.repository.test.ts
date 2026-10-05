import {randomInt, randomUUID} from 'node:crypto';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import type {RelayApplication} from '../../../application';
import type {UserRepository} from '../../../repositories';
import {USER_REPOSITORY_BINDING_KEY} from '../../../repositories';
import {setupApplication} from '../../acceptance/test-helper';

describe('UserRepository (integration)', () => {
  let app: RelayApplication;
  let repository: UserRepository;
  const githubIds: number[] = [];

  async function createUser() {
    const githubId = randomInt(1_000_000_000, 1_000_000_000_000);
    githubIds.push(githubId);
    return repository.create({
      githubId,
      username: `finn-the-human-${randomUUID()}`,
    });
  }

  beforeAll(async () => {
    ({app} = await setupApplication());
    repository = await app.get<UserRepository>(USER_REPOSITORY_BINDING_KEY);
  });

  afterEach(async () => {
    if (githubIds.length) {
      await repository.deleteAll({githubId: {inq: githubIds}});
      githubIds.length = 0;
    }
  });

  afterAll(async () => {
    await app?.stop();
  });

  it('creates a user with a database-generated UUID and reads its fields', async () => {
    const user = await createUser();
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await repository.findById(user.id);
    expect(stored).toMatchObject({id: user.id, username: user.username});
    // PostgreSQL returns bigint columns as strings, even with number metadata.
    expect(String(stored.githubId)).toBe(String(user.githubId));
  });

  it('finds a user by GitHub identity and counts matching users', async () => {
    const user = await createUser();
    await createUser();
    expect(
      await repository.find({where: {githubId: user.githubId}}),
    ).toHaveLength(1);
    expect(
      await repository.findOne({where: {githubId: user.githubId}}),
    ).toMatchObject({id: user.id});
    expect(await repository.count({githubId: user.githubId})).toEqual({
      count: 1,
    });
  });

  it('updates a username without changing the identity', async () => {
    const user = await createUser();
    await repository.updateById(user.id, {username: 'finn-the-hero-of-ooo'});
    const stored = await repository.findById(user.id);
    expect(stored.username).toBe('finn-the-hero-of-ooo');
    expect(String(stored.githubId)).toBe(String(user.githubId));
  });

  it('deletes a user and reports it as missing', async () => {
    const user = await createUser();
    await repository.deleteById(user.id);
    expect(await repository.exists(user.id)).toBe(false);
    await expect(repository.findById(user.id)).rejects.toMatchObject({
      code: 'ENTITY_NOT_FOUND',
    });
  });

  it('rejects duplicate GitHub identities', async () => {
    const user = await createUser();
    await expect(
      repository.create({githubId: user.githubId, username: 'fern-the-human'}),
    ).rejects.toMatchObject({code: '23505'});
    expect(await repository.count({githubId: user.githubId})).toEqual({
      count: 1,
    });
  });

  it('rejects a user without the required username', async () => {
    const githubId = randomInt(1_000_000_000, 1_000_000_000_000);
    githubIds.push(githubId);
    await expect(repository.create({githubId})).rejects.toMatchObject({
      name: 'ValidationError',
    });
    expect(await repository.count({githubId})).toEqual({count: 0});
  });
});
