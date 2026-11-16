import {
  AuthorizationDecision,
  getAuthorizationMetadata,
} from '@loopback/authorization';
import {
  IAM_ACTION,
  IAM_AUTHORIZER_BINDING_KEY,
  IAM_POLICY_ENGINE_BINDING_KEY,
  IamPolicyEngine,
  IamRequest,
} from '../../authorization';
import {Client} from '@loopback/testlab';
import {randomBytes, randomInt, randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import type {RelayApplication} from '../../application';
import type {
  EnvironmentRepository,
  GithubInstallationRepository,
  GithubIssueRepository,
  GithubPullRequestRepository,
  GithubRepositoryRepository,
  RunRepository,
  TaskRepository,
  UserRepository,
  WorkspaceMemberRepository,
  WorkspaceRepository,
} from '../../repositories';
import type {SessionService, SessionStoreService} from '../../services';
import {setupApplication} from './test-helper';

const authorizationExceptions = new Set([
  'PingController.ping',
  'SessionController.me',
  'SessionController.logout',
  'SessionController.login',
  'SessionController.callback',
  'SessionController.exchange',
  'GithubWebhookController.receive',
  'GithubInstallationCallbackController.callback',
  'RunController.stream',
  'RunController.video',
]);

describe('IAM authorization (acceptance)', () => {
  let app: RelayApplication;
  let client: Client;
  let users: UserRepository;
  let workspaces: WorkspaceRepository;
  let members: WorkspaceMemberRepository;
  let environments: EnvironmentRepository;
  let installations: GithubInstallationRepository;
  let repositories: GithubRepositoryRepository;
  let issues: GithubIssueRepository;
  let tasks: TaskRepository;
  let runs: RunRepository;
  let store: SessionStoreService;
  const hashes: string[] = [];
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const runIds: string[] = [];
  const tokens: string[] = [];
  let environmentId: string;
  let installationId: string;
  let repositoryId: string;
  let issueId: string;
  let pullRequestId: string;
  let pullRequestTaskId: string;
  let pullRequests: GithubPullRequestRepository;
  let taskId: string;
  let jakeMembershipId: string;

  beforeAll(async () => {
    vi.stubEnv('AI_ALLOWED_ORIGINS', 'https://example.com');
    ({app, client} = await setupApplication());
    users = await app.get('repositories.UserRepository');
    workspaces = await app.get('repositories.WorkspaceRepository');
    members = await app.get('repositories.WorkspaceMemberRepository');
    environments = await app.get('repositories.EnvironmentRepository');
    installations = await app.get('repositories.GithubInstallationRepository');
    repositories = await app.get('repositories.GithubRepositoryRepository');
    issues = await app.get('repositories.GithubIssueRepository');
    pullRequests = await app.get('repositories.GithubPullRequestRepository');
    tasks = await app.get('repositories.TaskRepository');
    runs = await app.get('repositories.RunRepository');
    store = await app.get('services.SessionStoreService');
    const sessions = await app.get<SessionService>('services.SessionService');

    for (const username of ['Finn', 'Jake', 'foo', 'bar', 'baz']) {
      const user = await users.create({
        username,
        verifiedEmails: [`${username.toLowerCase()}@example.com`],
        githubId: randomInt(100000000, 2000000000),
      });
      const session = await sessions.create(user);

      userIds.push(user.id);
      tokens.push(session.token);
      hashes.push(session.session.tokenHash);
    }

    for (const name of ['foo', 'bar']) {
      const workspace = await workspaces.create({name, createdBy: userIds[0]});
      workspaceIds.push(workspace.id);
    }

    for (const [index, role] of [
      'admin',
      'member',
      'admin',
      null,
      'member',
    ].entries()) {
      if (!role) continue;

      const member = await members.create({
        workspaceId: workspaceIds[0],
        userId: userIds[index],
        role: role as 'admin' | 'member',
      });
      if (index === 1) jakeMembershipId = member.id;
    }

    const environment = await environments.create({
      workspaceId: workspaceIds[0],
      name: 'baz',
      baseUrl: 'https://example.com/',
    });
    environmentId = environment.id;
    const installation = await installations.create({
      workspaceId: workspaceIds[0],
      githubId: randomInt(100000000, 2000000000),
      accountLogin: 'Finn',
      connectedBy: userIds[0],
    });
    installationId = installation.id;
    const repository = await repositories.create({
      workspaceId: workspaceIds[0],
      installationId,
      githubId: randomInt(100000000, 2000000000),
      fullName: 'foo/bar',
      defaultEnvironmentId: environmentId,
    });
    repositoryId = repository.id;
    const issue = await issues.create({
      repositoryId,
      githubId: randomInt(100000000, 2000000000),
      number: 1,
      url: 'https://github.com/foo/bar/issues/1',
    });
    issueId = issue.id;
    const task = await tasks.create({
      workspaceId: workspaceIds[0],
      environmentId,
      repositoryId,
      issueId,
      issueTitle: 'foo',
      issueBody: '',
      requestedBy: userIds[1],
      sourceCommentId: randomInt(100000000, 2000000000),
      sourceCommentUrl: 'https://github.com/foo/bar/issues/1#issuecomment-1',
      status: 'completed',
      endedAt: new Date(),
    });
    taskId = task.id;

    const pullRequest = await pullRequests.create({
      repositoryId,
      githubId: randomInt(100000000, 2000000000),
      number: 2,
      url: 'https://github.com/foo/bar/pull/2',
    });
    pullRequestId = pullRequest.id;
    const pullRequestTask = await tasks.create({
      kind: 'pr_verification',
      targetUrl: 'https://example.com/',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      workspaceId: workspaceIds[0],
      environmentId,
      repositoryId,
      pullRequestId,
      issueTitle: 'bar',
      issueBody: '',
      requestedBy: userIds[1],
      sourceCommentId: randomInt(100000000, 2000000000),
      sourceCommentUrl: 'https://github.com/foo/bar/pull/2#issuecomment-2',
      status: 'completed',
      endedAt: new Date(),
    });
    pullRequestTaskId = pullRequestTask.id;

    for (const userId of userIds.slice(0, 2)) {
      const run = await runs.create({
        id: randomUUID(),
        workspaceId: workspaceIds[0],
        environmentId,
        userId,
        scriptName: 'example-todo',
        status: 'completed',
        viewTokenHash: randomBytes(32).toString('hex'),
      });
      runIds.push(run.id);
    }

    const taskRun = await runs.create({
      id: randomUUID(),
      taskId,
      workspaceId: workspaceIds[0],
      environmentId,
      userId: userIds[0],
      stage: 'reproduction',
      attempt: 1,
      scriptName: 'agent',
      status: 'completed',
      viewTokenHash: randomBytes(32).toString('hex'),
    });
    runIds.push(taskRun.id);
  });

  afterAll(async () => {
    try {
      if (runIds.length) await runs.deleteAll({id: {inq: runIds}});
      if (taskId) await tasks.deleteById(taskId);
      if (pullRequestTaskId) await tasks.deleteById(pullRequestTaskId);
      if (pullRequestId) await pullRequests.deleteById(pullRequestId);
      if (issueId) await issues.deleteById(issueId);
      if (repositoryId) await repositories.deleteById(repositoryId);
      if (installationId) await installations.deleteById(installationId);
      if (environmentId) await environments.deleteById(environmentId);
      if (workspaceIds.length) {
        await members.deleteAll({workspaceId: {inq: workspaceIds}});
        await workspaces.deleteAll({id: {inq: workspaceIds}});
      }
      for (const hash of hashes) await store.delete(hash);
      if (userIds.length) await users.deleteAll({id: {inq: userIds}});
    } finally {
      await app?.stop();
      vi.unstubAllEnvs();
    }
  });

  it('requires IAM metadata on every business endpoint', async () => {
    const spec = await app.restServer.getApiSpec();
    let checked = 0;

    for (const path of Object.values(spec.paths)) {
      for (const method of ['get', 'post', 'patch', 'delete']) {
        const operation = path[method];
        if (!operation?.['x-controller-name']) continue;

        const name = operation['x-controller-name'];
        const operationName = operation['x-operation-name'];
        if (authorizationExceptions.has(`${name}.${operationName}`)) continue;

        const controller = app.getBinding(
          `controllers.${name}`,
        ).valueConstructor;
        const metadata = getAuthorizationMetadata(
          controller!.prototype,
          operationName,
        );

        expect(
          metadata?.voters,
          `${method} ${operation.operationId}`,
        ).toContain(IAM_AUTHORIZER_BINDING_KEY);
        expect(metadata?.scopes).toHaveLength(1);
        checked++;
      }
    }

    expect(checked).toBeGreaterThan(40);
  });

  it('enforces policy denial before every business endpoint can perform its operation', async () => {
    const invitations = await app.get<
      import('../../repositories').WorkspaceInvitationRepository
    >('repositories.WorkspaceInvitationRepository');
    const invitation = await invitations.create({
      workspaceId: workspaceIds[0],
      email: 'finn@example.com',
      invitedBy: userIds[0],
    });
    const engine = await app.get<IamPolicyEngine>(
      IAM_POLICY_ENGINE_BINDING_KEY,
    );
    const evaluate = vi
      .spyOn(engine, 'evaluate')
      .mockReturnValue(AuthorizationDecision.DENY);
    const spec = await app.restServer.getApiSpec();
    let checked = 0;

    try {
      for (const [path, item] of Object.entries(spec.paths)) {
        for (const method of ['get', 'post', 'patch', 'delete'] as const) {
          const operation = item[method];
          const controller = operation?.['x-controller-name'];
          if (
            !controller ||
            authorizationExceptions.has(
              `${controller}.${operation['x-operation-name']}`,
            )
          )
            continue;

          const id =
            controller === 'RunController'
              ? runIds[0]
              : controller === 'IssueController'
                ? path.startsWith('/api/tasks')
                  ? taskId
                  : issueId
                : controller === 'PullRequestController'
                  ? pullRequestId
                  : path.startsWith('/api/workspace-invitations/')
                    ? invitation.id
                    : workspaceIds[0];
          const values: Record<string, string> = {
            id,
            workspaceId: workspaceIds[0],
            environmentId,
            installationId,
            repositoryId,
            userId: userIds[1],
            invitationId: invitation.id,
            filename: 'foo.webp',
            patchId: randomUUID(),
          };
          const url = path.replace(
            /\{([^}]+)\}/g,
            (_, name: string) => values[name],
          );
          const request = client[method](url).set(
            'Authorization',
            `Bearer ${tokens[0]}`,
          );
          if (path === '/api/issues' || path === '/api/pull-requests')
            request.query({workspaceId: workspaceIds[0]});
          if (method === 'post' || method === 'patch') {
            if (path.endsWith('/avatar'))
              request.set('Content-Type', 'image/png').send(Buffer.from('foo'));
            else if (path === '/api/runs')
              request.send({
                scriptName: 'example-todo',
                workspaceId: workspaceIds[0],
                environmentId,
              });
            else if (path === '/api/runs/agent')
              request.send({
                prompt: 'foo',
                workspaceId: workspaceIds[0],
                environmentId,
              });
            else request.send({});
          }

          const response = await request;
          expect(
            response.status,
            `${method.toUpperCase()} ${path}: ${JSON.stringify(response.body)}`,
          ).toBe(403);
          expect(
            evaluate,
            `${method.toUpperCase()} ${path}`,
          ).toHaveBeenCalled();
          evaluate.mockClear();
          checked++;
        }
      }

      expect(checked).toBeGreaterThan(40);
    } finally {
      evaluate.mockRestore();
      await invitations.deleteAll({id: invitation.id});
    }
  });

  it('allows authenticated users to manage their own collections and denies unauthenticated requests', async () => {
    for (const url of [
      '/api/workspaces',
      '/api/workspace-invitations',
      '/api/runs',
    ]) {
      await client.get(url).expect(401);
      await client
        .get(url)
        .set('Authorization', `Bearer ${tokens[1]}`)
        .expect(200);
    }

    await client.post('/api/workspaces').send({name: 'foo'}).expect(401);
  });

  it('checks workspace membership for issue and pull request lists', async () => {
    for (const path of ['/api/issues', '/api/pull-requests']) {
      await client
        .get(path)
        .query({workspaceId: workspaceIds[0]})
        .set('Authorization', `Bearer ${tokens[3]}`)
        .expect(404);
      const response = await client
        .get(path)
        .query({workspaceId: workspaceIds[0]})
        .set('Authorization', `Bearer ${tokens[1]}`)
        .expect(200);
      expect(response.body.items).toHaveLength(1);
    }
  });

  it('resolves issue and pull request ownership from their stored repository', async () => {
    for (const url of [
      `/api/issues/${issueId}`,
      `/api/pull-requests/${pullRequestId}`,
    ]) {
      await client
        .get(url)
        .set('Authorization', `Bearer ${tokens[3]}`)
        .expect(404);
      await client
        .get(url)
        .set('Authorization', `Bearer ${tokens[1]}`)
        .expect(200);
    }
    await client
      .get(`/api/issues/${issueId}`)
      .query({taskId: pullRequestTaskId})
      .set('Authorization', `Bearer ${tokens[1]}`)
      .expect(404);
  });

  it('allows only the verified invitation recipient to respond, without requiring membership', async () => {
    const invitations = await app.get<
      import('../../repositories').WorkspaceInvitationRepository
    >('repositories.WorkspaceInvitationRepository');
    const invitation = await invitations.create({
      workspaceId: workspaceIds[0],
      email: 'bar@example.com',
      invitedBy: userIds[0],
    });
    const url = `/api/workspace-invitations/${invitation.id}/response`;

    try {
      await client
        .post(url)
        .set('Authorization', `Bearer ${tokens[1]}`)
        .send({accept: true})
        .expect(404);
      expect(await invitations.exists(invitation.id)).toBe(true);
      await client
        .post(url)
        .set('Authorization', `Bearer ${tokens[3]}`)
        .send({accept: true})
        .expect(204);
      expect(
        await members.findOne({
          where: {workspaceId: workspaceIds[0], userId: userIds[3]},
        }),
      ).toBeTruthy();
      await client
        .post(url)
        .set('Authorization', `Bearer ${tokens[3]}`)
        .send({accept: true})
        .expect(404);
    } finally {
      await invitations.deleteAll({id: invitation.id});
      await members.deleteAll({
        workspaceId: workspaceIds[0],
        userId: userIds[3],
      });
    }
  });

  it('authorizes both run creation routes before queueing and resolves the workspace from the body', async () => {
    const workers = await app.get<import('../../services').WorkerService>(
      'services.WorkerService',
    );
    const create = vi.spyOn(workers, 'create').mockImplementation(async () => ({
      run: await runs.findById(runIds[1]),
      viewToken: 'foo',
    }));

    try {
      for (const [url, body] of [
        ['/api/runs', {scriptName: 'example-todo'}],
        ['/api/runs/agent', {prompt: 'foo'}],
      ] as const) {
        const data = {...body, workspaceId: workspaceIds[0], environmentId};
        await client
          .post(url)
          .set('Authorization', `Bearer ${tokens[3]}`)
          .send(data)
          .expect(404);
        expect(create).not.toHaveBeenCalled();
        await client
          .post(url)
          .set('Authorization', `Bearer ${tokens[1]}`)
          .send(data)
          .expect(202);
        expect(create).toHaveBeenCalledOnce();
        create.mockClear();
        await client
          .post(url)
          .set('Authorization', `Bearer ${tokens[1]}`)
          .send({...data, workspaceId: workspaceIds[1]})
          .expect(404);
        expect(create).not.toHaveBeenCalled();
      }
    } finally {
      create.mockRestore();
    }
  });

  it('enforces run-read permission on details, results, events, activity and media', async () => {
    const engine = await app.get<IamPolicyEngine>(
      IAM_POLICY_ENGINE_BINDING_KEY,
    );
    const original = engine.evaluate.bind(engine);
    const evaluate = vi.spyOn(engine, 'evaluate');
    evaluate.mockImplementation((request: IamRequest) =>
      request.action === IAM_ACTION.RunRead
        ? AuthorizationDecision.DENY
        : original(request),
    );

    try {
      for (const suffix of [
        '',
        '/result',
        '/events',
        '/activity',
        '/media/stream',
        '/media/video',
      ]) {
        await client
          .get(`/api/runs/${runIds[0]}${suffix}`)
          .set('Authorization', `Bearer ${tokens[1]}`)
          .expect(403);
      }
    } finally {
      evaluate.mockRestore();
    }
  });

  it('honors policy denial for collections, creation and investigation queries', async () => {
    const engine = await app.get<IamPolicyEngine>(
      IAM_POLICY_ENGINE_BINDING_KEY,
    );
    const original = engine.evaluate.bind(engine);
    const evaluate = vi.spyOn(engine, 'evaluate');
    const cases = [
      {method: 'get', url: '/api/workspaces', action: IAM_ACTION.WorkspaceList},
      {
        method: 'post',
        url: '/api/workspaces',
        action: IAM_ACTION.WorkspaceCreate,
        body: {name: 'foo'},
      },
      {
        method: 'get',
        url: '/api/workspace-invitations',
        action: IAM_ACTION.InvitationList,
      },
      {method: 'get', url: '/api/runs', action: IAM_ACTION.RunList},
      {
        method: 'post',
        url: '/api/runs',
        action: IAM_ACTION.RunCreate,
        body: {
          scriptName: 'example-todo',
          workspaceId: workspaceIds[0],
          environmentId,
        },
      },
      {
        method: 'post',
        url: '/api/runs/agent',
        action: IAM_ACTION.RunCreate,
        body: {prompt: 'foo', workspaceId: workspaceIds[0], environmentId},
      },
      {
        method: 'get',
        url: `/api/issues?workspaceId=${workspaceIds[0]}`,
        action: IAM_ACTION.IssuesList,
      },
      {
        method: 'get',
        url: `/api/pull-requests?workspaceId=${workspaceIds[0]}`,
        action: IAM_ACTION.PullRequestsList,
      },
      {
        method: 'get',
        url: `/api/issues/${issueId}`,
        action: IAM_ACTION.IssueRead,
      },
      {
        method: 'get',
        url: `/api/pull-requests/${pullRequestId}`,
        action: IAM_ACTION.PullRequestRead,
      },
    ] as const;

    try {
      for (const item of cases) {
        evaluate.mockImplementation(request =>
          request.action === item.action
            ? AuthorizationDecision.DENY
            : original(request),
        );
        const request = client[item.method](item.url).set(
          'Authorization',
          `Bearer ${tokens[1]}`,
        );
        if ('body' in item) request.send(item.body);

        await request.expect(403);
        expect(evaluate).toHaveBeenCalledWith(
          expect.objectContaining({action: item.action}),
        );
        evaluate.mockClear();
      }
    } finally {
      evaluate.mockRestore();
    }
  });

  it('authenticates before evaluating workspace access', async () => {
    await client.get(`/api/workspaces/${workspaceIds[0]}`).expect(401);
  });

  it('lets a member read but only administrators update the workspace', async () => {
    await client
      .get(`/api/workspaces/${workspaceIds[0]}`)
      .set('Authorization', `Bearer ${tokens[1]}`)
      .expect(200);
    await client
      .patch(`/api/workspaces/${workspaceIds[0]}`)
      .set('Authorization', `Bearer ${tokens[1]}`)
      .send({name: 'bar'})
      .expect(403);
    await client
      .patch(`/api/workspaces/${workspaceIds[0]}`)
      .set('Authorization', `Bearer ${tokens[2]}`)
      .send({name: 'foo'})
      .expect(200);
  });

  it('hides foreign workspaces and requires current membership even for the creator', async () => {
    await client
      .get(`/api/workspaces/${workspaceIds[1]}`)
      .set('Authorization', `Bearer ${tokens[0]}`)
      .expect(404);
    await client
      .get(`/api/workspaces/${workspaceIds[0]}`)
      .set('Authorization', `Bearer ${tokens[3]}`)
      .expect(404);
  });

  it('allows members to cancel only their own standalone runs', async () => {
    await client
      .post(`/api/runs/${runIds[1]}/cancel`)
      .set('Authorization', `Bearer ${tokens[1]}`)
      .expect(204);
    await client
      .post(`/api/runs/${runIds[0]}/cancel`)
      .set('Authorization', `Bearer ${tokens[1]}`)
      .expect(403);
    await client
      .post(`/api/runs/${runIds[0]}/cancel`)
      .set('Authorization', `Bearer ${tokens[2]}`)
      .expect(204);
    await client
      .post(`/api/runs/${runIds[1]}/cancel`)
      .set('Authorization', `Bearer ${tokens[3]}`)
      .expect(404);
  });

  it('allows the task initiator and administrators, and denies another member on both cancellation routes', async () => {
    for (const url of [
      `/api/runs/${runIds[2]}/cancel`,
      `/api/tasks/${taskId}/cancel`,
    ]) {
      await client
        .post(url)
        .set('Authorization', `Bearer ${tokens[4]}`)
        .expect(403);
      await client
        .post(url)
        .set('Authorization', `Bearer ${tokens[1]}`)
        .expect(204);
      await client
        .post(url)
        .set('Authorization', `Bearer ${tokens[2]}`)
        .expect(204);
    }
  });

  it('requires admin membership to manage GitHub connections', async () => {
    const github = await app.get<import('../../services').GithubAppService>(
      'services.GithubAppService',
    );
    const installationUrl = vi
      .spyOn(github, 'installationUrl')
      .mockResolvedValue('https://github.com/apps/foo/installations/new');
    const intents = await app.get<
      import('../../repositories').InstallationIntentRepository
    >('repositories.InstallationIntentRepository');
    const url = `/api/workspaces/${workspaceIds[0]}/github/installation-url`;

    try {
      await client
        .get(url)
        .set('Authorization', `Bearer ${tokens[1]}`)
        .expect(403);
      const response = await client
        .get(url)
        .set('Authorization', `Bearer ${tokens[2]}`)
        .expect(200);
      expect(new URL(response.body.url).searchParams.get('state')).toBeTruthy();
    } finally {
      installationUrl.mockRestore();
      await intents.deleteAll({workspaceId: workspaceIds[0]});
    }
  });

  it('requires admin membership to delete a workspace', async () => {
    const response = await client
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${tokens[2]}`)
      .send({name: 'foo'})
      .expect(200);
    const id = response.body.id;
    workspaceIds.push(id);
    await members.create({workspaceId: id, userId: userIds[1], role: 'member'});

    await client
      .delete(`/api/workspaces/${id}`)
      .set('Authorization', `Bearer ${tokens[1]}`)
      .expect(403);
    expect((await workspaces.findById(id)).deletedAt).toBeNull();
    await client
      .delete(`/api/workspaces/${id}`)
      .set('Authorization', `Bearer ${tokens[2]}`)
      .expect(204);
    expect((await workspaces.findById(id)).deletedAt).toBeTruthy();
  });

  it('requires admin membership to change another member and protects the owner', async () => {
    const url = `/api/workspaces/${workspaceIds[0]}/members/${userIds[1]}`;

    await client
      .patch(url)
      .set('Authorization', `Bearer ${tokens[1]}`)
      .send({role: 'admin'})
      .expect(403);
    expect((await members.findById(jakeMembershipId)).role).toBe('member');
    await client
      .patch(url)
      .set('Authorization', `Bearer ${tokens[2]}`)
      .send({role: 'admin'})
      .expect(204);
    expect((await members.findById(jakeMembershipId)).role).toBe('admin');
    await client
      .patch(url)
      .set('Authorization', `Bearer ${tokens[2]}`)
      .send({role: 'member'})
      .expect(204);
    await client
      .delete(`/api/workspaces/${workspaceIds[0]}/members/${userIds[0]}`)
      .set('Authorization', `Bearer ${tokens[0]}`)
      .expect(409);
  });

  it('requires admin membership to manage invitations', async () => {
    const url = `/api/workspaces/${workspaceIds[0]}/invitations`;
    const invitations = await app.get<
      import('../../repositories').WorkspaceInvitationRepository
    >('repositories.WorkspaceInvitationRepository');

    try {
      await client
        .post(url)
        .set('Authorization', `Bearer ${tokens[1]}`)
        .send({email: 'foo@example.com'})
        .expect(403);
      expect(await invitations.count({workspaceId: workspaceIds[0]})).toEqual({
        count: 0,
      });
      const response = await client
        .post(url)
        .set('Authorization', `Bearer ${tokens[2]}`)
        .send({email: 'foo@example.com'})
        .expect(200);
      expect(response.body.email).toBe('foo@example.com');
    } finally {
      await invitations.deleteAll({workspaceId: workspaceIds[0]});
    }
  });

  it('requires admin membership to manage environments', async () => {
    const url = `/api/workspaces/${workspaceIds[0]}/environments`;
    const body = {name: 'foo', allowedOrigins: ['https://example.com']};

    await client
      .post(url)
      .set('Authorization', `Bearer ${tokens[1]}`)
      .send(body)
      .expect(403);
    const response = await client
      .post(url)
      .set('Authorization', `Bearer ${tokens[2]}`)
      .send(body)
      .expect(200);

    try {
      await client
        .patch(`${url}/${response.body.id}`)
        .set('Authorization', `Bearer ${tokens[1]}`)
        .send({...body, name: 'bar'})
        .expect(403);
      await client
        .patch(`${url}/${response.body.id}`)
        .set('Authorization', `Bearer ${tokens[2]}`)
        .send({...body, name: 'bar'})
        .expect(200);
      await client
        .delete(`${url}/${response.body.id}`)
        .set('Authorization', `Bearer ${tokens[1]}`)
        .expect(403);
      await client
        .delete(`${url}/${response.body.id}`)
        .set('Authorization', `Bearer ${tokens[2]}`)
        .expect(204);
    } finally {
      await environments.deleteById(response.body.id);
    }
  });

  it('allows members to read runs and hides them from nonmembers', async () => {
    const url = `/api/runs/${runIds[0]}`;

    await client
      .get(url)
      .set('Authorization', `Bearer ${tokens[1]}`)
      .expect(200);
    await client
      .get(url)
      .set('Authorization', `Bearer ${tokens[3]}`)
      .expect(404);
  });

  it('reloads roles and membership rather than trusting session snapshots', async () => {
    await members.updateById(jakeMembershipId, {role: 'admin'});
    await client
      .patch(`/api/workspaces/${workspaceIds[0]}`)
      .set('Authorization', `Bearer ${tokens[1]}`)
      .send({name: 'foo'})
      .expect(200);
    await members.updateById(jakeMembershipId, {role: 'member'});
    await client
      .patch(`/api/workspaces/${workspaceIds[0]}`)
      .set('Authorization', `Bearer ${tokens[1]}`)
      .send({name: 'bar'})
      .expect(403);

    expect((await workspaces.findById(workspaceIds[0])).name).toBe('foo');
  });
});
