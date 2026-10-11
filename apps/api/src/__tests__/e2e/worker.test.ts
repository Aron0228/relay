import {Queue} from 'bullmq';
import {randomInt, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer, Server} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {User} from '../../models';
import type {RunRepository, UserRepository} from '../../repositories';
import type {
  SessionService,
  SessionStoreService,
  WorkerService,
} from '../../services';
import {setupApplication} from '../acceptance/test-helper';
import {TODO_SITE} from './helpers/todo-site';

describe('On-demand Playwright workers (e2e)', () => {
  let app: Awaited<ReturnType<typeof setupApplication>>['app'];
  let client: Awaited<ReturnType<typeof setupApplication>>['client'];
  let workers: WorkerService;
  let runs: RunRepository;
  let users: UserRepository;
  let store: SessionStoreService;
  let user: User;
  let token: string;
  let sessionHash: string;
  let directory: string;
  let site: Server;
  let broken = false;
  const queueName = `bmo-workers-${randomUUID()}`;
  const runIds: string[] = [];

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'relay-worker-test-'));
    site = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        broken
          ? TODO_SITE.replace(
              'text: input.value',
              "text: 'Ice King stole the adventure'",
            )
          : TODO_SITE,
      );
    });

    await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));

    const address = site.address() as {port: number};

    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);
    vi.stubEnv('WORKER_QUEUE_NAME', queueName);
    vi.stubEnv('WORKER_VIDEO_DIR', directory);
    vi.stubEnv('WORKER_EXAMPLE_URL', `http://127.0.0.1:${address.port}`);
    vi.stubEnv('WORKER_CONCURRENCY', '1');
    vi.stubEnv('WORKER_TIMEOUT_SECONDS', '30');
    vi.stubEnv('WORKER_ACTION_DELAY_MS', '200');

    ({app, client} = await setupApplication({workers: true}));
    workers = await app.get('services.WorkerService');
    runs = await app.get('repositories.RunRepository');
    users = await app.get('repositories.UserRepository');
    store = await app.get('services.SessionStoreService');
    user = await users.create({
      githubId: randomInt(100000000, 2000000000),
      username: `Finn-${randomUUID()}`,
    });

    const session = await (
      await app.get<SessionService>('services.SessionService')
    ).create(user);

    token = session.token;
    sessionHash = session.session.tokenHash;
  }, 30000);

  afterAll(async () => {
    try {
      await workers?.stop();

      if (runIds.length) {
        await runs.deleteAll({id: {inq: runIds}});
      }

      if (sessionHash) {
        await store.delete(sessionHash);
      }

      if (user) {
        await users.deleteById(user.id);
      }

      const queue = new Queue(queueName, {
        connection: {
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT),
        },
      });

      await queue.obliterate({force: true});
      await queue.close();
    } finally {
      await app?.stop();
      await new Promise<void>(resolve => site?.close(() => resolve()));
      await rm(directory, {recursive: true, force: true});
      vi.unstubAllEnvs();
    }
  }, 30000);

  async function createRun() {
    const response = await client
      .post('/api/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({scriptName: 'example-todo'})
      .expect(202);

    runIds.push(response.body.id);

    return response.body as {id: string; streamUrl: string; videoUrl: string};
  }

  async function waitForFinished(id: string) {
    await vi.waitFor(
      async () => {
        expect((await runs.findById(id)).status).toMatch(
          /^(completed|failed|cancelled)$/,
        );
      },
      {timeout: 20000, interval: 100},
    );

    return runs.findById(id);
  }

  it('requires authentication and only allows registered scripts', async () => {
    await client
      .post('/api/runs')
      .send({scriptName: 'example-todo'})
      .expect(401);
    await client
      .post('/api/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({scriptName: 'ice-king.js'})
      .expect(422);
    await client
      .post('/api/runs')
      .set('Authorization', `Bearer ${token}`)
      .send({scriptName: 'example-todo', url: 'http://localhost/private'})
      .expect(422);
  });

  it('spawns a worker, streams live frames, persists a video and events, then removes the worker', async () => {
    const run = await createRun();
    const abort = new AbortController();
    const live = await fetch(`${app.restServer.url}${run.streamUrl}`, {
      signal: abort.signal,
    });
    const reader = live.body!.getReader();
    let data = Buffer.alloc(0);

    expect(live.status).toBe(200);
    expect(live.headers.get('content-type')).toContain(
      'multipart/x-mixed-replace',
    );

    try {
      while (!data.includes(Buffer.from([0xff, 0xd8]))) {
        const frame = await reader.read();

        if (frame.done) {
          throw new Error('Live stream ended without a JPEG frame');
        }

        data = Buffer.concat([data, Buffer.from(frame.value)]);
      }
    } finally {
      abort.abort();
    }

    const completed = await waitForFinished(run.id);
    const events = await workers.listEvents(run.id);
    const video = await readFile(workers.videoPath(run.id));

    expect(completed.status).toBe('completed');
    expect(completed.videoFile).toBe(`${run.id}/session.webm`);
    expect(video.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    expect(events.map(event => event.type)).toEqual(
      expect.arrayContaining([
        'run.queued',
        'worker.spawned',
        'browser.started',
        'action.completed',
        'assertion.passed',
        'browser.closed',
        'worker.exited',
        'run.completed',
      ]),
    );
    expect(() => process.kill(completed.workerPid!, 0)).toThrow();

    await client.get(run.videoUrl).set('Range', 'bytes=0-3').expect(206);
    await client.get(run.streamUrl).expect(302);

    const status = await client
      .get(`/api/runs/${run.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(status.body.viewTokenHash).toBeUndefined();
    await client
      .get(`/api/runs/${run.id}/events`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }, 30000);

  it('rejects missing or forged viewing tokens and access by another user', async () => {
    const id = runIds[0];
    const other = await users.create({
      githubId: randomInt(100000000, 2000000000),
      username: `Ice-King-${randomUUID()}`,
    });
    const session = await (
      await app.get<SessionService>('services.SessionService')
    ).create(other);

    try {
      await client.get(`/api/runs/${id}/stream`).expect(404);
      await client.get(`/api/runs/${id}/video?token=forged`).expect(404);
      await client
        .get(`/api/runs/${id}`)
        .set('Authorization', `Bearer ${session.token}`)
        .expect(404);
      await client
        .post(`/api/runs/${id}/cancel`)
        .set('Authorization', `Bearer ${session.token}`)
        .expect(404);
    } finally {
      await store.delete(session.session.tokenHash);
      await users.deleteById(other.id);
    }
  });

  it('cancels an active worker, finalizes its video, and releases its process', async () => {
    const run = await createRun();

    await vi.waitFor(
      async () => {
        expect(
          (await workers.listEvents(run.id)).some(
            event => event.type === 'browser.started',
          ),
        ).toBe(true);
      },
      {timeout: 10000},
    );
    await client
      .post(`/api/runs/${run.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const cancelled = await waitForFinished(run.id);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.videoFile).toBe(`${run.id}/session.webm`);
    expect(() => process.kill(cancelled.workerPid!, 0)).toThrow();
    await client.get(run.videoUrl).expect(200);
  }, 20000);

  it('cancels a queued run without launching another worker', async () => {
    const active = await createRun();
    const queued = await createRun();

    await client
      .post(`/api/runs/${queued.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await client
      .post(`/api/runs/${active.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const cancelled = await waitForFinished(queued.id);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.workerPid).toBeNull();
    await waitForFinished(active.id);
  }, 20000);

  it('persists a failed script and recording, then accepts another run', async () => {
    broken = true;

    const run = await createRun();
    const failed = await waitForFinished(run.id);

    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Expected .todo-list');
    expect(failed.videoFile).toBe(`${run.id}/session.webm`);
    expect(() => process.kill(failed.workerPid!, 0)).toThrow();

    broken = false;

    const next = await createRun();

    expect((await waitForFinished(next.id)).status).toBe('completed');
  }, 30000);

  it('times out a worker and preserves its recording before releasing it', async () => {
    const timeoutQueue = `ice-king-timeout-${randomUUID()}`;

    vi.stubEnv('WORKER_QUEUE_NAME', timeoutQueue);
    vi.stubEnv('WORKER_TIMEOUT_SECONDS', '1');

    const timeoutApp = await setupApplication({workers: true});

    try {
      const response = await timeoutApp.client
        .post('/api/runs')
        .set('Authorization', `Bearer ${token}`)
        .send({scriptName: 'example-todo'})
        .expect(202);

      runIds.push(response.body.id);

      const failed = await waitForFinished(response.body.id);

      expect(failed.status).toBe('failed');
      expect(failed.error).toBe('Worker execution timed out');
      expect(failed.videoFile).toBe(`${failed.id}/session.webm`);
      expect(() => process.kill(failed.workerPid!, 0)).toThrow();
    } finally {
      await timeoutApp.app.stop();

      const queue = new Queue(timeoutQueue, {
        connection: {
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT),
        },
      });

      await queue.obliterate({force: true});
      await queue.close();
      vi.stubEnv('WORKER_QUEUE_NAME', queueName);
      vi.stubEnv('WORKER_TIMEOUT_SECONDS', '30');
    }
  }, 20000);

  it('closes an active browser on shutdown and refuses new runs', async () => {
    const run = await createRun();

    await vi.waitFor(
      async () => {
        expect(
          (await workers.listEvents(run.id)).some(
            event => event.type === 'browser.started',
          ),
        ).toBe(true);
      },
      {timeout: 10000},
    );
    await workers.stop();

    const cancelled = await runs.findById(run.id);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.videoFile).toBe(`${run.id}/session.webm`);
    expect(() => process.kill(cancelled.workerPid!, 0)).toThrow();
    await expect(workers.create('example-todo', user.id)).rejects.toMatchObject(
      {statusCode: 503},
    );
  }, 20000);
});
