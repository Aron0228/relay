import {randomInt, randomUUID} from 'node:crypto';
import {Queue} from 'bullmq';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {createRequire} from 'node:module';
import type {WorkerCapacityService} from '../../../services';
import type {
  EnvironmentRepository,
  RunRepository,
  UserRepository,
  WorkspaceRepository,
} from '../../../repositories';
import {setupApplication} from '../../acceptance/test-helper';

const compiled = createRequire(__filename)(
  '../../../../dist/services/worker-capacity.service',
);

describe('Distributed worker capacity (integration)', () => {
  let app: Awaited<ReturnType<typeof setupApplication>>['app'];
  let runs: RunRepository;
  let users: UserRepository;
  let workspaces: WorkspaceRepository;
  let environments: EnvironmentRepository;
  const environmentIds = new Map<string, string>();
  let capacity: WorkerCapacityService;
  let other: WorkerCapacityService;
  let finn: string;
  let candy: string;
  let ice: string;
  const queue = `bmo-capacity-${randomUUID()}`;
  const ids: string[] = [];

  beforeAll(async () => {
    vi.stubEnv('WORKER_QUEUE_NAME', queue);
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('WORKER_GLOBAL_LIMIT', '2');
    vi.stubEnv('WORKER_WORKSPACE_LIMIT', '1');
    vi.stubEnv('WORKER_WORKSPACE_LIMITS', '{}');
    ({app} = await setupApplication());
    runs = await app.get('repositories.RunRepository');
    environments = await app.get('repositories.EnvironmentRepository');
    users = await app.get('repositories.UserRepository');
    workspaces = await app.get('repositories.WorkspaceRepository');
    finn = (
      await users.create({
        githubId: randomInt(10000000, 2000000000),
        username: 'Finn',
      })
    ).id;
    candy = (await workspaces.create({name: 'Candy Kingdom', createdBy: finn}))
      .id;
    ice = (await workspaces.create({name: 'Ice Kingdom', createdBy: finn})).id;
    for (const workspaceId of [candy, ice]) {
      const environment = await environments.create({
        workspaceId,
        name: 'Ooo',
        baseUrl: 'https://example.com',
      });
      environmentIds.set(workspaceId, environment.id);
    }

    capacity = new compiled.WorkerCapacityService(runs);
    other = new compiled.WorkerCapacityService(runs);
  });

  beforeEach(async () => {
    if (ids.length) await runs.deleteAll({id: {inq: ids.splice(0)}});
  });

  afterAll(async () => {
    if (ids.length) await runs.deleteAll({id: {inq: ids}});
    await environments.deleteAll({workspaceId: {inq: [candy, ice]}});
    await workspaces.deleteAll({id: {inq: [candy, ice]}});
    await users.deleteById(finn);
    await app.stop();
    vi.unstubAllEnvs();
  });

  async function enqueue(workspaceId?: string) {
    const run = await runs.create({
      id: randomUUID(),
      workspaceId,
      environmentId: workspaceId ? environmentIds.get(workspaceId) : undefined,
      scriptName: 'example-todo',
      viewTokenHash: 'a'.repeat(64),
    });
    ids.push(run.id);
    await capacity.register(queue, run.id);

    return run.id;
  }

  it('skips a full workspace while preserving its FIFO order', async () => {
    const first = await enqueue(candy);
    const second = await enqueue(candy);
    const third = await enqueue(candy);
    const iceRun = await enqueue(ice);
    const token = (await capacity.claim(queue, first))!;

    expect(token).toBeTruthy();
    expect(await other.claim(queue, second)).toBeUndefined();
    expect(await other.claim(queue, iceRun)).toBeTruthy();
    expect(await other.claim(queue, third)).toBeUndefined();
    await capacity.release(first, token);
    expect(await other.claim(queue, third)).toBeUndefined();
    expect(await other.claim(queue, second)).toBeTruthy();
    const waiting = await runs.findById(third);
    expect(waiting.status).toBe('queued');
    expect(waiting.startedAt).toBeNull();
    expect(waiting.queuedAt).toBeInstanceOf(Date);
  });

  it('enforces the global limit under concurrent claims from separate instances', async () => {
    const pending = await Promise.all(Array.from({length: 8}, () => enqueue()));
    const claims = await Promise.all(
      pending.map((id, index) =>
        (index % 2 ? capacity : other).claim(queue, id),
      ),
    );

    for (let index = 0; index < pending.length; index++) {
      claims[index] ??= await other.claim(queue, pending[index]);
    }

    expect(claims.filter(Boolean)).toHaveLength(2);
    expect(await runs.count({id: {inq: pending}, status: 'running'})).toEqual({
      count: 2,
    });
  });

  it('supports workspace-specific limit overrides', async () => {
    vi.stubEnv('WORKER_WORKSPACE_LIMITS', JSON.stringify({[candy]: 2}));
    const configured: WorkerCapacityService =
      new compiled.WorkerCapacityService(runs);
    const first = await enqueue(candy);
    const second = await enqueue(candy);

    expect(await configured.claim(queue, first)).toBeTruthy();
    expect(await configured.claim(queue, second)).toBeTruthy();
    vi.stubEnv('WORKER_WORKSPACE_LIMITS', '{}');
  });

  it('skips cancelled entries and fences renewal and release by token', async () => {
    const cancelled = await enqueue(candy);
    const next = await enqueue(candy);
    await runs.updateById(cancelled, {
      status: 'cancelled',
      cancelRequested: true,
    });
    const token = (await capacity.claim(queue, next))!;

    expect(token).toBeTruthy();
    expect(await capacity.renew(next, randomUUID())).toBe(false);
    await other.release(next, randomUUID());
    expect(await capacity.renew(next, token)).toBe(true);
    await capacity.discardFinished(queue);
    expect(await capacity.claim(queue, cancelled)).toBeUndefined();
  });

  it('does not revive expired leases and exposes them for crash recovery', async () => {
    const id = await enqueue(candy);
    const token = (await capacity.claim(queue, id))!;
    await runs.execute(
      "UPDATE execution.worker_slot SET expires_at = clock_timestamp() - interval '1 second' WHERE run_id = $1",
      [id],
    );

    expect(await other.renew(id, token)).toBe(false);
    expect(await other.expired(queue)).toEqual([{id, token}]);
    await other.release(id, token);
    expect(await capacity.expired(queue)).toEqual([]);
  });
  it('a new API instance finalizes an orphaned run and frees its capacity', async () => {
    const id = await enqueue(candy);
    await capacity.claim(queue, id);
    await runs.execute(
      "UPDATE execution.worker_slot SET expires_at = clock_timestamp() - interval '1 second' WHERE run_id = $1",
      [id],
    );
    const recovering = await setupApplication({workers: true});

    try {
      const run = await runs.findById(id);
      expect(run.status).toBe('failed');
      expect(run.error).toBe('Worker capacity lease expired');
      expect(run.endedAt).toBeInstanceOf(Date);
      expect(await capacity.expired(queue)).toEqual([]);
      const next = await enqueue(candy);
      expect(await capacity.claim(queue, next)).toBeTruthy();
    } finally {
      await recovering.app.stop();
      const bull = new Queue(queue, {
        connection: {
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT),
        },
      });
      await bull.obliterate({force: true});
      await bull.close();
    }
  });
});
