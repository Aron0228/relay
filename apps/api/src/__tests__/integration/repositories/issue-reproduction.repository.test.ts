import {randomInt, randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {RelayApplication} from '../../../application';
import {
  Run,
  RUN_STAGE,
  Task,
  TASK_FEEDBACK_STATUS,
  TASK_OUTCOME,
  TASK_STATUS,
} from '../../../models';
import {
  EnvironmentRepository,
  ENVIRONMENT_REPOSITORY_BINDING_KEY,
  GithubInstallationRepository,
  GITHUB_INSTALLATION_REPOSITORY_BINDING_KEY,
  GithubIssueRepository,
  GITHUB_ISSUE_REPOSITORY_BINDING_KEY,
  GithubRepositoryRepository,
  GITHUB_REPOSITORY_REPOSITORY_BINDING_KEY,
  RunEventRepository,
  RUN_EVENT_REPOSITORY_BINDING_KEY,
  RunRepository,
  RUN_REPOSITORY_BINDING_KEY,
  TaskRepository,
  TASK_REPOSITORY_BINDING_KEY,
  UserRepository,
  USER_REPOSITORY_BINDING_KEY,
  WorkspaceRepository,
  WORKSPACE_REPOSITORY_BINDING_KEY,
} from '../../../repositories';
import {setupApplication} from '../../acceptance/test-helper';

describe('Issue reproduction repositories (integration)', () => {
  let app: RelayApplication;
  let users: UserRepository;
  let workspaces: WorkspaceRepository;
  let environments: EnvironmentRepository;
  let installations: GithubInstallationRepository;
  let repositories: GithubRepositoryRepository;
  let issues: GithubIssueRepository;
  let tasks: TaskRepository;
  let runs: RunRepository;
  let events: RunEventRepository;
  let finnId: string;
  let candy: Awaited<ReturnType<typeof createWorld>>;
  let ice: Awaited<ReturnType<typeof createWorld>>;
  const runIds: string[] = [];
  const githubId = () => randomInt(1_000_000_000, 1_000_000_000_000);

  async function createWorld(name: string) {
    const workspace = await workspaces.create({name, createdBy: finnId});
    const environment = await environments.create({
      workspaceId: workspace.id,
      name: 'Ooo',
      baseUrl: 'https://example.com',
    });
    const installation = await installations.create({
      githubId: githubId(),
      workspaceId: workspace.id,
      accountLogin: 'princess-bubblegum',
    });
    const repository = await repositories.create({
      githubId: githubId(),
      installationId: installation.id,
      workspaceId: workspace.id,
      defaultEnvironmentId: environment.id,
      fullName: `ooo/${name}`,
    });
    const issue = await issues.create({
      githubId: githubId(),
      repositoryId: repository.id,
      number: 173,
      url: `https://github.com/ooo/${name}/issues/173`,
    });

    return {workspace, environment, installation, repository, issue};
  }

  function createTask(overrides: Partial<Task> = {}) {
    const commentId = githubId();

    return tasks.create({
      workspaceId: candy.workspace.id,
      environmentId: candy.environment.id,
      repositoryId: candy.repository.id,
      issueId: candy.issue.id,
      issueTitle: 'The candy gate does not open',
      issueBody: 'Finn clicks the gate and nothing happens.',
      sourceCommentId: commentId,
      sourceCommentUrl: `${candy.issue.url}#issuecomment-${commentId}`,
      requestedBy: finnId,
      ...overrides,
    });
  }

  async function createRun(task: Task, overrides: Partial<Run> = {}) {
    const run = await runs.create({
      id: randomUUID(),
      taskId: task.id,
      workspaceId: task.workspaceId,
      environmentId: task.environmentId,
      stage: RUN_STAGE.Reproduction,
      attempt: 1,
      scriptName: 'agent',
      viewTokenHash: 'a'.repeat(64),
      ...overrides,
    });
    runIds.push(run.id);

    return run;
  }

  beforeAll(async () => {
    ({app} = await setupApplication());
    users = await app.get(USER_REPOSITORY_BINDING_KEY);
    workspaces = await app.get(WORKSPACE_REPOSITORY_BINDING_KEY);
    environments = await app.get(ENVIRONMENT_REPOSITORY_BINDING_KEY);
    installations = await app.get(GITHUB_INSTALLATION_REPOSITORY_BINDING_KEY);
    repositories = await app.get(GITHUB_REPOSITORY_REPOSITORY_BINDING_KEY);
    issues = await app.get(GITHUB_ISSUE_REPOSITORY_BINDING_KEY);
    tasks = await app.get(TASK_REPOSITORY_BINDING_KEY);
    runs = await app.get(RUN_REPOSITORY_BINDING_KEY);
    events = await app.get(RUN_EVENT_REPOSITORY_BINDING_KEY);
    const finn = await users.create({
      githubId: githubId(),
      username: 'Finn-the-human',
    });
    finnId = finn.id;
    candy = await createWorld('candy-kingdom');
    ice = await createWorld('ice-kingdom');
  });

  afterAll(async () => {
    if (!app) return;

    try {
      const worlds = [candy, ice].filter(Boolean);
      const workspaceIds = worlds.map(world => world.workspace.id);
      await runs.deleteAll({id: {inq: runIds}});
      await tasks.deleteAll({workspaceId: {inq: workspaceIds}});
      await issues.deleteAll({
        repositoryId: {inq: worlds.map(world => world.repository.id)},
      });
      await repositories.deleteAll({workspaceId: {inq: workspaceIds}});
      await installations.deleteAll({workspaceId: {inq: workspaceIds}});
      await environments.deleteAll({workspaceId: {inq: workspaceIds}});
      await workspaces.deleteAll({id: {inq: workspaceIds}});
      if (finnId) await users.deleteById(finnId);
    } finally {
      await app.stop();
    }
  });

  it('persists the GitHub source and resolves its workspace and environment relations', async () => {
    expect(await installations.workspace(candy.installation.id)).toMatchObject({
      id: candy.workspace.id,
    });
    expect(await repositories.installation(candy.repository.id)).toMatchObject({
      id: candy.installation.id,
    });
    expect(
      await repositories.defaultEnvironment(candy.repository.id),
    ).toMatchObject({id: candy.environment.id});
    expect(await issues.repository(candy.issue.id)).toMatchObject({
      id: candy.repository.id,
    });
    const stored = await issues.findById(candy.issue.id);
    expect(String(stored.githubId)).toBe(String(candy.issue.githubId));
    expect(stored).toMatchObject({number: 173, url: candy.issue.url});
  });

  it('keeps a repository in one workspace and rejects foreign installation or environment bindings', async () => {
    await expect(
      installations.create({
        githubId: candy.installation.githubId,
        workspaceId: ice.workspace.id,
        accountLogin: 'ice-king',
      }),
    ).rejects.toMatchObject({code: '23505'});
    await expect(
      repositories.create({
        ...candy.repository.toJSON(),
        id: undefined,
        workspaceId: ice.workspace.id,
        installationId: ice.installation.id,
        defaultEnvironmentId: ice.environment.id,
      }),
    ).rejects.toMatchObject({code: '23505'});
    await expect(
      repositories.updateById(candy.repository.id, {
        installationId: ice.installation.id,
      }),
    ).rejects.toMatchObject({code: '23503'});
    await expect(
      repositories.updateById(candy.repository.id, {
        defaultEnvironmentId: ice.environment.id,
      }),
    ).rejects.toMatchObject({code: '23503'});
  });

  it('deduplicates concurrent requests for the same source comment, while accepting a new comment', async () => {
    const sourceCommentId = githubId();
    const results = await Promise.allSettled([
      createTask({sourceCommentId}),
      createTask({sourceCommentId}),
    ]);
    expect(
      results.filter(result => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: {code: '23505'},
    });
    const another = await createTask();
    expect(another.id).toBeTruthy();
    expect(await tasks.count({sourceCommentId})).toEqual({count: 1});
  });

  it('stores snapshots per task and tracks the result independently of GitHub feedback', async () => {
    const original = await createTask();
    const revised = await createTask({
      issueTitle: 'The candy gate opens too slowly',
      issueBody: '',
    });
    expect(await tasks.requester(original.id)).toMatchObject({id: finnId});
    expect(await tasks.issue(original.id)).toMatchObject({id: candy.issue.id});
    expect(await tasks.findById(original.id)).toMatchObject({
      issueTitle: original.issueTitle,
      issueBody: original.issueBody,
      status: TASK_STATUS.Pending,
      feedbackStatus: TASK_FEEDBACK_STATUS.Pending,
    });
    expect((await tasks.findById(revised.id)).issueBody).toBe('');

    await tasks.updateById(original.id, {
      status: TASK_STATUS.Completed,
      outcome: TASK_OUTCOME.Reproduced,
      result: {summary: 'The candy gate is stuck.'},
      feedbackStatus: TASK_FEEDBACK_STATUS.Failed,
      feedbackError: 'GitHub is unavailable',
    });
    expect(await tasks.findById(original.id)).toMatchObject({
      status: TASK_STATUS.Completed,
      outcome: TASK_OUTCOME.Reproduced,
      result: {summary: 'The candy gate is stuck.'},
      feedbackStatus: TASK_FEEDBACK_STATUS.Failed,
    });
    await tasks.updateById(original.id, {
      feedbackStatus: TASK_FEEDBACK_STATUS.Sent,
      feedbackCommentId: githubId(),
      feedbackSentAt: new Date(),
      feedbackError: null,
    });
    expect(await tasks.findById(original.id)).toMatchObject({
      status: TASK_STATUS.Completed,
      outcome: TASK_OUTCOME.Reproduced,
      feedbackStatus: TASK_FEEDBACK_STATUS.Sent,
    });
  });

  it('rejects a task with a foreign environment, repository or issue', async () => {
    await expect(
      createTask({environmentId: ice.environment.id}),
    ).rejects.toMatchObject({code: '23503'});
    await expect(
      createTask({repositoryId: ice.repository.id}),
    ).rejects.toMatchObject({code: '23503'});
    await expect(createTask({issueId: ice.issue.id})).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('links independent attempts and stages with their own video and event history', async () => {
    const task = await createTask();
    const first = await createRun(task, {videoFile: 'finn/first.webm'});
    const retry = await createRun(task, {
      attempt: 2,
      videoFile: 'finn/retry.webm',
    });
    const critic = await createRun(task, {stage: RUN_STAGE.Critic});
    await events.create({
      runId: first.id,
      type: 'agent.tool_failed',
      payload: {tool: 'browserClick'},
    });
    await events.create({
      runId: retry.id,
      type: 'agent.completed',
      payload: {summary: 'Gate reproduced'},
    });
    expect(await runs.task(first.id)).toMatchObject({id: task.id});
    expect(await runs.count({taskId: task.id})).toEqual({count: 3});
    expect((await runs.findById(retry.id)).videoFile).toBe('finn/retry.webm');
    expect(await events.find({where: {runId: first.id}})).toHaveLength(1);
    expect(await events.find({where: {runId: critic.id}})).toHaveLength(0);
    await expect(createRun(task)).rejects.toMatchObject({code: '23505'});
  });

  it('enforces complete run context and preserves standalone runs', async () => {
    const task = await createTask();
    await expect(
      createRun(task, {
        workspaceId: ice.workspace.id,
        environmentId: ice.environment.id,
      }),
    ).rejects.toMatchObject({code: '23503'});
    await expect(createRun(task, {stage: null})).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      createRun(task, {workspaceId: null, environmentId: null}),
    ).rejects.toMatchObject({code: '23514'});
    await expect(createRun(task, {attempt: 0})).rejects.toMatchObject({
      code: '23514',
    });
    const standalone = await createRun(task, {
      taskId: undefined,
      workspaceId: null,
      environmentId: null,
      stage: null,
      attempt: null,
    });
    expect((await runs.findById(standalone.id)).taskId).toBeNull();
  });
});
