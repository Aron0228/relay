/* eslint-disable @typescript-eslint/naming-convention -- Chat Completions tool protocol. */
import {randomInt, randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer, Server} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
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
import {reproductionInput} from '../../ai/reproduction-input';
import type {
  EnvironmentRepository,
  GithubInstallationRepository,
  GithubIssueRepository,
  GithubRepositoryRepository,
  RunEventRepository,
  RunRepository,
  StageRequestRepository,
  TaskRepository,
  UserRepository,
  WorkspaceMemberRepository,
  WorkspaceRepository,
} from '../../repositories';
import type {
  GithubConnectionService,
  ReproductionResultService,
  WorkerService,
} from '../../services';
import {setupApplication} from '../acceptance/test-helper';

describe('Issue-context browser reproduction (e2e)', {timeout: 30000}, () => {
  let app: Awaited<ReturnType<typeof setupApplication>>['app'];
  let workers: WorkerService;
  let runs: RunRepository;
  let events: RunEventRepository;
  let requests: StageRequestRepository;
  let tasks: TaskRepository;
  let users: UserRepository;
  let workspaces: WorkspaceRepository;
  let members: WorkspaceMemberRepository;
  let environments: EnvironmentRepository;
  let installations: GithubInstallationRepository;
  let repositories: GithubRepositoryRepository;
  let issues: GithubIssueRepository;
  let finn: string;
  let workspaceId: string;
  let environment: Awaited<ReturnType<EnvironmentRepository['create']>>;
  let installationId: string;
  let repositoryId: string;
  let issue: Awaited<ReturnType<GithubIssueRepository['create']>>;
  let site: Server;
  let provider: Server;
  let directory: string;
  let mode = 'reproduced';
  let calls = 0;
  const queueName = `bmo-reproduction-${randomUUID()}`;
  const githubId = () => randomInt(100000000, 2000000000);

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'bmo-reproduction-'));
    site = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      const observed =
        mode === 'not_reproduced' ? 'The gate opens' : 'The gate stays closed';
      response.end(
        `<button onclick="document.querySelector('p').textContent='${observed}'">Open candy gate</button><p>The gate is closed</p>`,
      );
    });
    provider = createServer((request, response) => {
      let body = '';
      request.on('data', chunk => {
        body += chunk;
      });
      request.on('end', () => {
        calls++;

        if (mode === 'error' && calls > 1) {
          response.writeHead(503).end();

          return;
        }

        const messages = JSON.parse(body).messages as {
          role: string;
          content: string | null;
        }[];
        const observation = [...messages]
          .reverse()
          .find(
            message =>
              message.role === 'tool' &&
              message.content?.includes('sourceEventId'),
          );
        const evidenceId = observation
          ? JSON.parse(observation.content!).sourceEventId
          : undefined;
        const args =
          calls === 1
            ? {role: 'button', name: 'Open candy gate'}
            : {
                verdict: mode,
                summary:
                  mode === 'inconclusive'
                    ? 'The expected gate behavior is not specified clearly enough.'
                    : 'The reported gate scenario was exercised.',
                confidence: 0.8,
                preconditions: ['Finn can access the Candy Kingdom gate'],
                steps: [
                  {
                    action: 'Click Open candy gate',
                    expectedBehavior: 'The gate opens',
                    actualBehavior:
                      mode === 'not_reproduced'
                        ? 'The gate opens'
                        : 'The gate stays closed',
                    sourceEventIds: [evidenceId],
                  },
                ],
                expectedBehavior: 'The gate opens',
                actualBehavior:
                  mode === 'not_reproduced'
                    ? 'The gate opens'
                    : 'The gate stays closed',
                sourceEventIds: [evidenceId],
              };

        expect(messages[0].content).toContain(
          'You investigate one reported GitHub issue',
        );
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: `bmo-${calls}`,
                      type: 'function',
                      function: {
                        name: calls === 1 ? 'browserClick' : 'finish',
                        arguments: JSON.stringify(args),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      });
    });
    await Promise.all([
      new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve)),
      new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve)),
    ]);
    const siteUrl = `http://127.0.0.1:${(site.address() as {port: number}).port}`;
    vi.stubEnv('REDIS_HOST', process.env.REDIS_TEST_HOST ?? '127.0.0.1');
    vi.stubEnv('REDIS_PORT', process.env.REDIS_TEST_PORT ?? '6379');
    vi.stubEnv('WORKER_QUEUE_NAME', queueName);
    vi.stubEnv('WORKER_ACTION_DELAY_MS', '0');
    vi.stubEnv('WORKER_VIDEO_DIR', directory);
    vi.stubEnv(
      'AI_BASE_URL',
      `http://127.0.0.1:${(provider.address() as {port: number}).port}/v1`,
    );
    vi.stubEnv('AI_MODEL', 'bmo-reproduction');
    vi.stubEnv('AI_REQUEST_MAX_ATTEMPTS', '3');
    vi.stubEnv('AI_ALLOWED_ORIGINS', siteUrl);
    vi.stubEnv('AI_MAX_TURNS', '4');
    vi.stubEnv('AI_RUN_TIMEOUT_SECONDS', '30');
    ({app} = await setupApplication());
    workers = await app.get('services.WorkerService');
    runs = await app.get('repositories.RunRepository');
    events = await app.get('repositories.RunEventRepository');
    requests = await app.get('repositories.StageRequestRepository');
    tasks = await app.get('repositories.TaskRepository');
    users = await app.get('repositories.UserRepository');
    workspaces = await app.get('repositories.WorkspaceRepository');
    members = await app.get('repositories.WorkspaceMemberRepository');
    environments = await app.get('repositories.EnvironmentRepository');
    installations = await app.get('repositories.GithubInstallationRepository');
    repositories = await app.get('repositories.GithubRepositoryRepository');
    issues = await app.get('repositories.GithubIssueRepository');
    finn = (await users.create({githubId: githubId(), username: 'Finn'})).id;
    workspaceId = (
      await workspaces.create({name: 'Candy Kingdom', createdBy: finn})
    ).id;
    await members.create({workspaceId, userId: finn, role: 'admin'});
    environment = await environments.create({
      workspaceId,
      name: 'Candy gate',
      baseUrl: siteUrl,
    });
    installationId = (
      await installations.create({
        githubId: githubId(),
        workspaceId,
        accountLogin: 'ooo',
        connectedBy: finn,
      })
    ).id;
    repositoryId = (
      await repositories.create({
        githubId: githubId(),
        installationId,
        workspaceId,
        defaultEnvironmentId: environment.id,
        fullName: 'ooo/candy',
      })
    ).id;
    issue = await issues.create({
      githubId: githubId(),
      repositoryId,
      number: 173,
      url: 'https://github.com/ooo/candy/issues/173',
    });
    const connections = await app.get<GithubConnectionService>(
      'services.GithubConnectionService',
    );
    vi.spyOn(connections, 'targetForTask').mockResolvedValue({
      environment: {
        ...environment.toJSON(),
        id: environment.id,
        name: environment.name,
        baseUrl: siteUrl,
      },
      targetUrl: siteUrl,
      repository: await repositories.findById(repositoryId),
      installation: await installations.findById(installationId),
      fullName: 'ooo/candy',
    });
  });

  beforeEach(() => {
    calls = 0;
    mode = 'reproduced';
  });

  afterAll(async () => {
    try {
      await workers?.stop();
      const queue = new Queue(queueName, {
        connection: {
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT),
        },
      });
      await queue.obliterate({force: true});
      await queue.close();
      await runs.deleteAll({workspaceId});
      await tasks.deleteAll({workspaceId});
      await issues.deleteById(issue.id);
      await repositories.deleteById(repositoryId);
      await installations.deleteById(installationId);
      await environments.deleteById(environment.id);
      await members.deleteAll({workspaceId});
      await workspaces.deleteById(workspaceId);
      await users.deleteById(finn);
    } finally {
      await app?.stop();
      await Promise.all([
        new Promise<void>(resolve => site.close(() => resolve())),
        new Promise<void>(resolve => provider.close(() => resolve())),
      ]);
      await rm(directory, {recursive: true, force: true});
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  async function prepare() {
    const task = await tasks.create({
      workspaceId,
      environmentId: environment.id,
      repositoryId,
      issueId: issue.id,
      issueTitle: 'The candy gate is stuck',
      issueBody:
        '### Expected behavior\nThe gate opens.\n### Actual behavior\nThe gate stays closed.',
      sourceCommentId: githubId(),
      sourceCommentUrl: `${issue.url}#issuecomment-${githubId()}`,
      requestedBy: finn,
      status: 'queued',
    });
    const run = await runs.create({
      id: randomUUID(),
      taskId: task.id,
      workspaceId,
      environmentId: environment.id,
      userId: finn,
      scriptName: 'agent',
      stage: 'reproduction',
      attempt: 1,
      viewTokenHash: 'a'.repeat(64),
      agentInput: reproductionInput(task, issue, environment),
    });
    return {run, task};
  }

  async function execute() {
    const {run, task} = await prepare();
    await workers.enqueueRecordedRun(run.id);
    await expect
      .poll(async () => (await runs.findById(run.id)).status, {
        timeout: 20000,
        interval: 100,
      })
      .not.toMatch(/^(queued|running)$/);

    return {
      run: await runs.findById(run.id),
      task: await tasks.findById(task.id),
      result: (await workers.getResult(run.id))!,
      next: await requests.find({where: {sourceRunId: run.id}}),
    };
  }

  it.each([
    ['reproduced', 'step_verification'],
    ['not_reproduced', 'critic'],
  ])(
    'persists %s and requests %s without claiming a final task outcome',
    async (verdict, nextStage) => {
      mode = verdict;
      const {run, task, result, next} = await execute();
      const ids = result.result.reproduction!.sourceEventIds;

      expect(run.status, run.error ?? '').toBe('completed');
      expect(run.videoFile).toBe(`${run.id}/session.webm`);
      expect(result).toMatchObject({
        type: 'issue-reproduction',
        status: verdict,
        result: {
          verdict,
          promptVersion: 'issue-reproduction-v1',
          reproduction: {steps: [{number: 1, action: 'Click Open candy gate'}]},
        },
      });
      expect(
        await events.count({
          runId: run.id,
          type: 'agent.evidence',
          id: {inq: ids},
        }),
      ).toEqual({count: ids.length});
      expect(task).toMatchObject({
        status: 'queued',
        outcome: null,
        endedAt: null,
        result: {provisionalVerdict: verdict, verification: 'pending'},
      });
      expect(next).toHaveLength(1);
      expect(next[0]).toMatchObject({
        taskId: task.id,
        stage: nextStage,
        consumedAt: null,
      });
      await workers.enqueueRecordedRun(run.id);
      expect(await requests.count({sourceRunId: run.id})).toEqual({count: 1});
    },
  );

  it('keeps an explicitly inconclusive investigation inconclusive without scheduling confirmation', async () => {
    mode = 'inconclusive';
    const {run, task, result, next} = await execute();

    expect(run.status, run.error ?? '').toBe('completed');
    expect(result).toMatchObject({
      type: 'issue-reproduction',
      status: 'inconclusive',
      confidence: 0,
    });
    expect(task).toMatchObject({status: 'completed', outcome: 'inconclusive'});
    expect(next).toEqual([]);
  });

  it('never turns provider failure after a browser action into a reproduced issue', async () => {
    mode = 'error';
    const {run, task, result, next} = await execute();

    expect(run.status).toBe('failed');
    expect(result.result).toMatchObject({
      verdict: 'inconclusive',
      stopReason: 'provider_error',
      confidence: 0,
    });
    expect(task).toMatchObject({status: 'failed', outcome: 'inconclusive'});
    expect(next).toEqual([]);
    expect(
      await events.count({runId: run.id, type: 'action.completed'}),
    ).toEqual({count: 2});
  });
  it('rejects another run’s evidence at the persistence boundary', async () => {
    const source = await execute();
    const pending = await prepare();
    const completion = await app.get<ReproductionResultService>(
      'services.ReproductionResultService',
    );
    const transaction = await runs.beginTransaction();

    try {
      const normalized = await completion.complete(
        pending.run,
        {status: 'completed'},
        structuredClone(source.result.result),
        transaction,
      );
      expect(normalized.verdict).toBe('inconclusive');
      expect(normalized.confidence).toBe(0);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    expect(await requests.count({sourceRunId: pending.run.id})).toEqual({
      count: 0,
    });
    expect((await tasks.findById(pending.task.id)).outcome).toBe(
      'inconclusive',
    );
  });
  it('does not promote a claimed reproduction when browser cleanup fails', async () => {
    const source = await execute();
    const pending = await prepare();
    const id = randomUUID();
    await events.create({
      id,
      runId: pending.run.id,
      type: 'agent.evidence',
      payload: {sourceEventId: id, observation: 'The gate stays closed'},
    });
    const claimed = structuredClone(source.result.result);
    claimed.reproduction!.sourceEventIds = [id];
    claimed.reproduction!.steps.forEach(step => {
      step.sourceEventIds = [id];
    });
    const completion = await app.get<ReproductionResultService>(
      'services.ReproductionResultService',
    );
    const transaction = await runs.beginTransaction();

    try {
      const normalized = await completion.complete(
        pending.run,
        {status: 'failed', error: 'Browser cleanup failed'},
        claimed,
        transaction,
      );
      expect(normalized).toMatchObject({
        verdict: 'inconclusive',
        confidence: 0,
        summary: 'Browser cleanup failed',
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    expect(await requests.count({sourceRunId: pending.run.id})).toEqual({
      count: 0,
    });
    expect((await tasks.findById(pending.task.id)).outcome).toBe(
      'inconclusive',
    );
  });
});
