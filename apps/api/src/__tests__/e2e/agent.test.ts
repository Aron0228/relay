/* eslint-disable @typescript-eslint/naming-convention -- Chat Completions protocol fields. */
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
  WorkspaceService,
  SessionService,
  SessionStoreService,
  WorkerService,
} from '../../services';
import {setupApplication} from '../acceptance/test-helper';
import {TODO_SITE} from './helpers/todo-site';

describe('AI browser workers (e2e)', () => {
  let app: Awaited<ReturnType<typeof setupApplication>>['app'];
  let client: Awaited<ReturnType<typeof setupApplication>>['client'];
  let workers: WorkerService;
  let runs: RunRepository;
  let users: UserRepository;
  let store: SessionStoreService;
  let user: User;
  let token: string;
  let workspaceId: string;
  let environmentId: string;
  let sessionHash: string;
  let directory: string;
  let site: Server;
  let provider: Server;
  let mode = 'finish';
  let providerCalls = 0;
  const queueName = `bmo-workers-${randomUUID()}`;
  const runIds: string[] = [];

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'relay-worker-test-'));
    site = createServer((request, response) => {
      if (request.url === '/escape') {
        response
          .writeHead(302, {Location: 'http://127.0.0.1:65534/private'})
          .end();

        return;
      }

      response.setHeader('Content-Type', 'text/html');
      response.end(TODO_SITE);
    });
    provider = createServer((request, response) => {
      request.resume();
      providerCalls++;

      if (mode === 'pending') return;

      if (mode === 'error') {
        response.writeHead(503).end();

        return;
      }

      const name =
        mode === 'limit'
          ? 'browserSnapshot'
          : ['reportProgress', 'browserFill', 'browserPress', 'finish'][
              providerCalls - 1
            ];
      const args =
        name === 'finish'
          ? {
              verdict: 'passed',
              summary: 'Finn inspected the todo list',
              confidence: 0.8,
              steps: ['Open the site', 'Inspect the page'],
              observations: ['Todo input visible'],
            }
          : name === 'browserFill'
            ? {selector: '.new-todo', value: 'Finn explores the Candy Kingdom'}
            : name === 'browserPress'
              ? {selector: '.new-todo', key: 'Enter'}
              : name === 'reportProgress'
                ? {
                    kind: 'message',
                    text: 'Finn is checking the Candy Kingdom shop.',
                  }
                : {};

      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Inspecting the page.',
                tool_calls: [
                  {
                    id: `bmo-${providerCalls}`,
                    type: 'function',
                    function: {name, arguments: JSON.stringify(args)},
                  },
                ],
              },
            },
          ],
        }),
      );
    });

    await new Promise<void>(resolve =>
      provider.listen(0, '127.0.0.1', resolve),
    );
    const providerAddress = provider.address() as {port: number};

    vi.stubEnv('AI_BASE_URL', `http://127.0.0.1:${providerAddress.port}/v1`);
    vi.stubEnv('AI_MODEL', 'bmo-test');
    vi.stubEnv('AI_MAX_TOOL_CALLS', '5');
    await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));

    const address = site.address() as {port: number};

    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('REDIS_USERNAME', process.env.REDIS_TEST_USERNAME);
    vi.stubEnv('REDIS_PASSWORD', process.env.REDIS_TEST_PASSWORD);
    vi.stubEnv('WORKER_QUEUE_NAME', queueName);
    vi.stubEnv('WORKER_VIDEO_DIR', directory);
    vi.stubEnv('AI_ALLOWED_ORIGINS', `http://127.0.0.1:${address.port}`);
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

    const workspaceService = await app.get<WorkspaceService>(
      'services.WorkspaceService',
    );
    const workspace = await workspaceService.create(user.id, 'Candy Kingdom');
    workspaceId = workspace.id as string;
    const environment = await workspaceService.saveEnvironment(
      workspaceId,
      user.id,
      {name: 'Tree Fort', baseUrl: process.env.WORKER_EXAMPLE_URL!},
    );
    environmentId = environment.id;

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

      if (workspaceId) {
        await runs.execute('DELETE FROM auth.workspace WHERE id = $1', [
          workspaceId,
        ]);
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
      provider?.closeAllConnections();
      await new Promise<void>(resolve => provider?.close(() => resolve()));
      await new Promise<void>(resolve => site?.close(() => resolve()));
      await rm(directory, {recursive: true, force: true});
      vi.unstubAllEnvs();
    }
  }, 30000);

  async function createRun() {
    const response = await client
      .post('/api/runs/agent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workspaceId,
        environmentId,
        prompt: 'Help Finn inspect the todo list',
        targetUrl: process.env.WORKER_EXAMPLE_URL,
      })
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

  it('protects agent creation and rejects an unapproved target', async () => {
    await client
      .post('/api/runs/agent')
      .send({prompt: 'Finn checks the shop'})
      .expect(401);
    await client
      .post('/api/runs/agent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workspaceId,
        environmentId,
        prompt: 'Finn checks the shop',
        targetUrl: 'http://localhost/private',
      })
      .expect(400);
  });

  it('blocks redirects to an unapproved origin inside Chromium', async () => {
    const workspaceService = await app.get<WorkspaceService>(
      'services.WorkspaceService',
    );
    const escapeEnvironment = await workspaceService.saveEnvironment(
      workspaceId,
      user.id,
      {
        name: 'Ice King escape',
        baseUrl: `${process.env.WORKER_EXAMPLE_URL}/escape`,
      },
    );
    const response = await client
      .post('/api/runs/agent')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workspaceId,
        environmentId: escapeEnvironment.id,
        prompt: 'Finn inspects the page',
        targetUrl: `${process.env.WORKER_EXAMPLE_URL}/escape`,
      })
      .expect(202);

    runIds.push(response.body.id);
    const failed = await waitForFinished(response.body.id);
    const events = await workers.listEvents(failed.id);

    expect(failed.status).toBe('failed');
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'browser.request_failed',
        payload: expect.objectContaining({
          url: 'http://127.0.0.1:65534/private',
          error: 'net::ERR_BLOCKED_BY_CLIENT',
        }),
      }),
    );
    expect((await workers.getResult(failed.id))?.status).toBe('inconclusive');
  }, 30000);

  it('lists only owned runs, searches goals and uses stable pagination', async () => {
    const createdAt = new Date();

    for (let index = 0; index < 27; index++) {
      const id = randomUUID();
      runIds.push(id);
      await runs.create({
        id,
        userId: user.id,
        workspaceId,
        environmentId,
        scriptName: 'agent',
        agentInput: {
          prompt: `Candy pagination ${index}`,
          targetUrl: 'https://academybugs.com/',
        },
        status: 'queued',
        viewTokenHash: '0'.repeat(64),
        cancelRequested: false,
        createdAt,
      });
    }

    const first = await client
      .get(`/api/runs?workspaceId=${workspaceId}&search=Candy%20pagination`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const second = await client
      .get(
        `/api/runs?workspaceId=${workspaceId}&search=Candy%20pagination&before=${first.body.nextCursor}`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(first.body.items).toHaveLength(25);
    expect(second.body.items).toHaveLength(2);
    expect(
      new Set(
        [...first.body.items, ...second.body.items].map(
          (run: {id: string}) => run.id,
        ),
      ).size,
    ).toBe(27);
    expect(second.body.nextCursor).toBeNull();
    expect(first.body.items[0].viewTokenHash).toBeUndefined();
    await client.get('/api/runs').expect(401);
    await client.get(`/api/runs/${runIds.at(-1)}/media/video`).expect(401);
    await client
      .get('/api/runs?scope=unknown')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    const stranger = await runs.create({
      id: randomUUID(),
      scriptName: 'agent',
      status: 'queued',
      viewTokenHash: '0'.repeat(64),
      cancelRequested: false,
    });
    runIds.push(stranger.id);
    const page = await client
      .get(`/api/runs?search=${stranger.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(page.body.items).toHaveLength(0);
    await client
      .get(`/api/runs/${stranger.id}/media/stream`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await client
      .get(`/api/runs/${stranger.id}/activity`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await client
      .get(`/api/runs?before=${stranger.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('executes tool calls, persists a verdict and video, and replays activity', async () => {
    providerCalls = 0;
    const run = await createRun();
    const completed = await waitForFinished(run.id);
    const result = await workers.getResult(run.id);
    const activity = await fetch(
      `${app.restServer.url}/api/runs/${run.id}/activity`,
      {
        headers: {Authorization: `Bearer ${token}`},
      },
    );
    const text = await activity.text();

    expect(completed.status).toBe('completed');
    expect(result?.result).toMatchObject({
      verdict: 'passed',
      stopReason: 'finished',
      model: 'bmo-test',
      toolCalls: 4,
    });
    expect(text).toContain('event: agent.tool_completed');
    expect(text).toContain('event: agent.activity');
    expect(text).toContain('Finn is checking the Candy Kingdom shop.');
    expect(text).toContain('event: run.completed');
    expect(text).toContain('Finn explores the Candy Kingdom');
    await client
      .get(`/api/runs/${run.id}/result`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((await readFile(workers.videoPath(run.id))).length).toBeGreaterThan(
      0,
    );
    expect(() => process.kill(completed.workerPid!, 0)).toThrow();
    await client.get(`/api/runs/${run.id}/result`).expect(401);
  }, 30000);

  it('persists an inconclusive result when the tool cap is reached', async () => {
    mode = 'limit';
    const run = await createRun();
    await waitForFinished(run.id);

    expect((await workers.getResult(run.id))?.result).toMatchObject({
      verdict: 'inconclusive',
      stopReason: 'tool_limit',
      toolCalls: 5,
    });
  }, 30000);

  it('records provider failures without retrying browser work', async () => {
    mode = 'error';
    const run = await createRun();
    const failed = await waitForFinished(run.id);

    expect(failed.status).toBe('failed');
    expect((await workers.getResult(run.id))?.result).toMatchObject({
      verdict: 'inconclusive',
      stopReason: 'provider_error',
    });
  }, 30000);

  it('cancels a pending provider call and releases the browser process', async () => {
    mode = 'pending';
    providerCalls = 0;
    const run = await createRun();
    await vi.waitFor(() => expect(providerCalls).toBe(1), {timeout: 10000});
    await workers.cancel(run.id);
    const cancelled = await waitForFinished(run.id);

    expect(cancelled.status).toBe('cancelled');
    expect((await workers.getResult(run.id))?.result.stopReason).toBe(
      'cancelled',
    );
    expect(() => process.kill(cancelled.workerPid!, 0)).toThrow();
  }, 30000);
});
