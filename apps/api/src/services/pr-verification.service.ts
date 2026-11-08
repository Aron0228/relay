/* eslint-disable @typescript-eslint/naming-convention -- GitHub webhook payloads use snake_case. */
import {BindingScope, inject, lifeCycleObserver, service} from '@loopback/core';
import {IsolationLevel, repository} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {z} from 'zod';
import {approvedUrl, allowedOrigins, positiveInteger} from '../ai/config';
import {environmentTarget} from '../ai/environment-target';
import {
  collectPrContext,
  PrSource,
  PR_CONTEXT_PROMPT_VERSION,
} from '../ai/pr-context';
import {OpenAiCompatibleProvider} from '../ai/openai-compatible.provider';
import {
  EnvironmentRepository,
  GithubInstallationRepository,
  GithubRepositoryRepository,
  GithubPullRequestRepository,
  GithubIssueRepository,
  TaskRepository,
  UserRepository,
  PrContextRepository,
  RunRepository,
  RunEventRepository,
} from '../repositories';
import {Task, TASK_STATUS, RUN_STAGE} from '../models';
import {GithubAppService} from './github-app.service';
import {GithubConnectionService} from './github-connection.service';
import {WorkspaceService} from './workspace.service';
import {
  WorkerService,
  WORKER_SERVICE_OPTIONS_BINDING_KEY,
  WorkerServiceOptions,
} from './worker.service';

export const PR_VERIFICATION_SERVICE_BINDING_KEY =
  'services.PrVerificationService';
const githubId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const actor = z.object({id: githubId, type: z.literal('User')});
export const prCommandSchema = z.object({
  action: z.literal('created'),
  installation: z.object({id: githubId}),
  repository: z.object({id: githubId}),
  issue: z.object({
    id: githubId,
    number: z.number().int().positive().max(2147483647),
    pull_request: z.object({}),
  }),
  comment: z.object({
    id: githubId,
    body: z
      .string()
      .refine(value => /^relay verify(?:\s|$)/.test(value.trim())),
    user: actor,
  }),
  sender: actor,
});
type PrCommand = z.infer<typeof prCommandSchema>;

@lifeCycleObserver('pr-verification', {scope: BindingScope.SINGLETON})
export class PrVerificationService {
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private stopped = false;
  private collection?: AbortController;

  constructor(
    @repository(EnvironmentRepository)
    private environments: EnvironmentRepository,
    @repository(GithubInstallationRepository)
    private installations: GithubInstallationRepository,
    @repository(GithubRepositoryRepository)
    private repositories: GithubRepositoryRepository,
    @repository(GithubPullRequestRepository)
    private pullRequests: GithubPullRequestRepository,
    @repository(GithubIssueRepository) private issues: GithubIssueRepository,
    @repository(TaskRepository) private tasks: TaskRepository,
    @repository(UserRepository) private users: UserRepository,
    @repository(PrContextRepository) private contexts: PrContextRepository,
    @repository(RunRepository) private runs: RunRepository,
    @repository(RunEventRepository) private events: RunEventRepository,
    @service(GithubAppService) private github: GithubAppService,
    @service(GithubConnectionService)
    private connections: GithubConnectionService,
    @service(WorkspaceService) private workspaces: WorkspaceService,
    @service(WorkerService) private workers: WorkerService,
    @inject(WORKER_SERVICE_OPTIONS_BINDING_KEY, {optional: true})
    private options: WorkerServiceOptions = {},
  ) {}

  start(): void {
    if (
      this.options.enabled === false ||
      (process.env.PR_VERIFICATION_ENABLED ??
        (process.env.NODE_ENV === 'test' ? 'false' : 'true')) === 'false'
    )
      return;

    const tick = () => {
      this.pending ??= this.recover()
        .catch(error =>
          console.info('[PR verification] Workflow recovery will retry', {
            error: (error as Error).message,
          }),
        )
        .finally(() => {
          this.pending = undefined;
        });
    };
    this.timer = setInterval(tick, 3000);
    this.timer.unref();
    tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.collection?.abort();
    await this.pending;
  }

  async prepare(payload: PrCommand): Promise<Task> {
    if (!/^relay verify https?:\/\/[^\s]+$/.test(payload.comment.body.trim()))
      throw new HttpErrors.BadRequest(
        'Use relay verify <environment URL>, for example relay verify https://preview.example.com/',
      );

    const existing = await this.tasks.findOne({
      where: {sourceCommentId: payload.comment.id},
    });

    if (existing) {
      console.info('[PR verification] Reusing task for duplicate comment', {
        taskId: existing.id,
        commentId: payload.comment.id,
      });

      return existing;
    }

    const user = await this.users.findOne({
      where: {githubId: payload.sender.id},
    });

    if (!user)
      throw new HttpErrors.Forbidden('The comment author must sign in first');
    const installation = await this.installations.findOne({
      where: {
        githubId: payload.installation.id,
        disconnectedAt: {eq: null as unknown as Date},
      },
    });

    if (!installation)
      throw new HttpErrors.NotFound('GitHub installation is not connected');
    await this.workspaces.requireMember(installation.workspaceId, user.id);
    const repo = await this.repositories.findOne({
      where: {
        githubId: payload.repository.id,
        installationId: installation.id,
        workspaceId: installation.workspaceId,
        disconnectedAt: {eq: null as unknown as Date},
      },
    });

    if (!repo)
      throw new HttpErrors.NotFound('GitHub repository is not connected');

    let targetUrl: string;
    try {
      targetUrl = approvedUrl(
        payload.comment.body.trim().split(/\s+/)[2],
        allowedOrigins(),
      );
    } catch {
      throw new HttpErrors.UnprocessableEntity(
        'The command must contain an approved environment URL',
      );
    }
    const environments = await this.environments.find({
      where: {
        workspaceId: installation.workspaceId,
        deletedAt: {eq: null as unknown as Date},
      },
    });
    const owned = environments.filter(
      item =>
        item.repositoryId === repo.id ||
        (!item.repositoryId && item.id === repo.defaultEnvironmentId),
    );
    const exact = owned.filter(
      item => item.baseUrl && new URL(item.baseUrl).toString() === targetUrl,
    );
    const matches = exact.length
      ? exact
      : owned.filter(item => {
          try {
            return environmentTarget(item, targetUrl) === targetUrl;
          } catch {
            return false;
          }
        });

    if (matches.length !== 1) {
      console.info('[PR verification] Environment resolution failed', {
        repositoryId: repo.id,
        targetUrl,
        matchingEnvironmentIds: matches.map(item => item.id),
      });
      throw new HttpErrors.UnprocessableEntity(
        matches.length
          ? 'Multiple repository environments allow this URL. Make their URL rules unambiguous.'
          : 'The URL must match a base URL or allowed origin of an environment assigned to this repository.',
      );
    }
    const environment = matches[0];
    await this.connections.resolveTarget(
      repo.id,
      installation.workspaceId,
      environment.id,
      targetUrl,
    );
    const source = await this.github.getPullRequest(
      Number(installation.githubId),
      Number(repo.githubId),
      payload.issue.number,
    );

    const transaction = await this.tasks.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );
    const options = {transaction};

    try {
      await this.tasks.execute(
        'SELECT id FROM auth.workspace WHERE id = $1 FOR UPDATE',
        [installation.workspaceId],
        options,
      );
      await this.workspaces.requireMember(
        installation.workspaceId,
        user.id,
        false,
        transaction,
      );
      const active = await this.repositories.findOne(
        {where: {id: repo.id, disconnectedAt: {eq: null as unknown as Date}}},
        options,
      );
      const activeInstallation = await this.installations.findOne(
        {
          where: {
            id: installation.id,
            disconnectedAt: {eq: null as unknown as Date},
          },
        },
        options,
      );
      const activeEnvironment = await this.environments.findOne(
        {
          where: {
            id: environment.id,
            workspaceId: installation.workspaceId,
            deletedAt: {eq: null as unknown as Date},
          },
        },
        options,
      );

      if (
        !active ||
        !activeInstallation ||
        !activeEnvironment ||
        (activeEnvironment.repositoryId !== repo.id &&
          !(
            activeEnvironment.repositoryId == null &&
            active.defaultEnvironmentId === activeEnvironment.id
          ))
      ) {
        throw new HttpErrors.Conflict(
          'GitHub connection or environment changed',
        );
      }
      environmentTarget(activeEnvironment, targetUrl);
      const pr = await this.pullRequests.snapshotSource(
        source.githubId,
        repo.id,
        source.number,
        source.url,
        transaction,
      );

      if (!pr)
        throw new HttpErrors.Conflict(
          'Pull request belongs to another repository',
        );
      const task = await this.tasks.create(
        {
          kind: 'pr_verification',
          workspaceId: installation.workspaceId,
          repositoryId: repo.id,
          pullRequestId: pr.id,
          environmentId: environment.id,
          targetUrl,
          baseSha: source.baseSha,
          headSha: source.headSha,
          issueTitle: source.title,
          issueBody: source.body,
          requestedBy: user.id,
          sourceCommentId: payload.comment.id,
          sourceCommentUrl: `${source.url}#issuecomment-${payload.comment.id}`,
        },
        options,
      );
      await this.contexts.create(
        {
          taskId: task.id,
          headSha: source.headSha,
          sources: [
            {
              id: 'pr',
              kind: 'pull_request',
              url: source.url,
              content: JSON.stringify({
                title: source.title,
                body: source.body.slice(0, 16000),
                baseSha: source.baseSha,
                headSha: source.headSha,
              }),
              truncated: source.body.length > 16000,
            },
          ],
        },
        options,
      );
      await transaction.commit();
      console.info('[PR verification] Task prepared', {
        taskId: task.id,
        pullRequestId: task.pullRequestId,
        environmentId: task.environmentId,
        targetUrl: task.targetUrl,
        headSha: task.headSha,
      });

      return task;
    } catch (error) {
      await transaction.rollback();

      if ((error as {code?: string}).code === '23505') {
        const duplicate = await this.tasks.findOne({
          where: {sourceCommentId: payload.comment.id},
        });

        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  private async recover(): Promise<void> {
    await this.dispatchQueued();

    const pending = (await this.contexts
      .execute(`SELECT c.id FROM execution.pr_context c
      JOIN execution.task t ON t.id = c.task_id WHERE t.status = 'pending' AND NOT t.cancel_requested
      AND (c.status = 'pending' OR (c.status = 'collecting' AND c.lease_expires_at <= now()))
      ORDER BY c.created_at LIMIT 20`)) as {id: string}[];

    for (const item of pending) {
      if (this.stopped) return;
      try {
        await this.collect(item.id);
        await this.dispatchQueued();
      } catch (error) {
        console.info('[PR verification] Context recovery will retry', {
          contextId: item.id,
          error: (error as Error).message,
        });
      }
    }
  }

  private async dispatchQueued(): Promise<void> {
    const queued = await this.tasks.find({
      where: {kind: 'pr_verification', status: TASK_STATUS.Queued},
      limit: 50,
    });
    for (const task of queued) {
      if (this.stopped) return;
      const run = await this.runs.findOne({
        where: {
          taskId: task.id,
          stage: RUN_STAGE.FixVerification,
          status: 'queued',
        },
      });

      if (run) await this.workers.enqueueRecordedRun(run.id);
    }
  }

  private async collect(id: string): Promise<void> {
    const token = randomUUID();
    const claimed = (await this.contexts.execute(
      `WITH claimed AS (UPDATE execution.pr_context SET status = 'collecting',
      lease_token = $2, lease_expires_at = now() + ($3::int * interval '1 second'), attempts = attempts + 1
      WHERE id = $1 AND (status = 'pending' OR (status = 'collecting' AND lease_expires_at <= now()))
      RETURNING id) SELECT id FROM claimed`,
      [id, token, positiveInteger('AI_PR_CONTEXT_TIMEOUT_SECONDS', 120) + 180],
    )) as {id: string}[];

    if (!claimed.length) return;

    const context = await this.contexts.findById(id);
    const task = await this.tasks.findById(context.taskId);
    console.info('[PR verification] Context collection started', {
      taskId: task.id,
      contextId: id,
      attempt: context.attempts,
      headSha: context.headSha,
    });

    const cancellation = new AbortController();
    this.collection = cancellation;
    const monitor = setInterval(() => {
      this.tasks
        .findById(task.id)
        .then(current => {
          if (current.cancelRequested || current.endedAt) cancellation.abort();
        })
        .catch(() => cancellation.abort());
    }, 2000);
    monitor.unref();

    try {
      if (context.attempts > 3)
        throw new Error('PR context recovery limit reached');
      const target = await this.connections.targetForTask(
        task.id,
        task.workspaceId,
        task.environmentId,
      );
      const sources = [...context.sources];

      if (sources.length === 1) {
        const files = await this.github.getPullRequestFiles(
          Number(target.installation.githubId),
          Number(target.repository.githubId),
          task.baseSha!,
          task.headSha!,
        );
        sources.push({
          id: 'diff',
          kind: 'diff',
          url: `https://github.com/${target.repository.fullName}/compare/${task.baseSha}...${task.headSha}`,
          content: JSON.stringify(files),
          truncated:
            files.truncated || files.files.some(file => file.truncated),
        });
        await this.addIssues(
          task,
          target.installation.githubId,
          target.repository.githubId,
          sources,
        );
        await this.contexts.updateAll({sources}, {id, leaseToken: token});
      }
      console.info('[PR verification] Captured sources ready', {
        taskId: task.id,
        contextId: id,
        sources: sources.map(source => ({
          id: source.id,
          kind: source.kind,
          characters: source.content.length,
          truncated: source.truncated,
        })),
      });

      const timeout =
        positiveInteger('AI_PR_CONTEXT_TIMEOUT_SECONDS', 120) * 1000;
      const collected = await collectPrContext(
        new OpenAiCompatibleProvider(),
        sources,
        AbortSignal.any([cancellation.signal, AbortSignal.timeout(timeout)]),
        task.id,
      );
      await this.persist(task, id, token, collected.data, collected.metrics);
    } catch (error) {
      console.info('[PR verification] Context collection interrupted', {
        taskId: task.id,
        contextId: id,
        stopping: this.stopped,
        error: (error as Error).message,
      });

      if (this.stopped) {
        await this.contexts.updateAll(
          {status: 'pending', leaseToken: null, leaseExpiresAt: null},
          {id, leaseToken: token},
        );
        return;
      }

      await this.persist(
        task,
        id,
        token,
        undefined,
        undefined,
        (error as Error).message,
      );
    } finally {
      clearInterval(monitor);
      this.collection = undefined;
    }
  }

  private async addIssues(
    task: Task,
    installationId: number,
    repositoryId: number,
    sources: PrSource[],
  ) {
    const linkedRepository = await this.repositories.findById(
      task.repositoryId,
    );
    const repositoryPath = linkedRepository.fullName.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
    const linkedUrls = [
      ...task.issueBody.matchAll(
        new RegExp(
          `https://github\\.com/${repositoryPath}/issues/(\\d+)\\b`,
          'g',
        ),
      ),
    ];
    const numbers = [
      ...new Set(
        [...task.issueBody.matchAll(/(?:^|\s|\()#(\d+)\b/g), ...linkedUrls].map(
          match => Number(match[1]),
        ),
      ),
    ].slice(0, 5);
    for (const number of numbers) {
      try {
        const issue = await this.github.getIssue(
          Number(installationId),
          Number(repositoryId),
          number,
        );
        sources.push({
          id: `issue-${number}`,
          kind: 'issue',
          url: issue.url,
          content: JSON.stringify({
            title: issue.title,
            body: issue.body.slice(0, 6000),
          }),
          truncated: issue.body.length > 6000,
        });
        const local = await this.issues.findOne({
          where: {repositoryId: task.repositoryId, number},
        });

        if (!local) continue;
        const previous = await this.tasks.findOne({
          where: {
            issueId: local.id,
            outcome: 'reproduced',
            status: 'completed',
          },
          order: ['createdAt DESC'],
          limit: 1,
        });

        if (previous?.result)
          sources.push({
            id: `reproduction-${number}`,
            kind: 'reproduction',
            url: issue.url,
            content: JSON.stringify(previous.result).slice(0, 10000),
            truncated: JSON.stringify(previous.result).length > 10000,
          });
      } catch (error) {
        if (
          ![400, 403, 404].includes(
            (error as {statusCode?: number}).statusCode ?? 0,
          )
        )
          throw error;
        sources.push({
          id: `issue-${number}`,
          kind: 'issue',
          url: task.sourceCommentUrl,
          content:
            'Linked issue could not be read. Treat its requirements as unknown.',
          truncated: true,
        });
      }
    }
  }

  private async persist(
    task: Task,
    id: string,
    token: string,
    data?: import('../ai/pr-context').PrContextData,
    metrics?: import('../ai/types').TokenUsage,
    error?: string,
  ) {
    const transaction = await this.tasks.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );
    const options = {transaction};

    try {
      await this.tasks.execute(
        'SELECT id FROM execution.task WHERE id = $1 FOR UPDATE',
        [task.id],
        options,
      );
      const current = await this.tasks.findById(task.id, undefined, options);
      const context = await this.contexts.findById(id, undefined, options);

      if (
        current.status !== 'pending' ||
        current.cancelRequested ||
        context.leaseToken !== token ||
        !context.leaseExpiresAt ||
        new Date(context.leaseExpiresAt).getTime() <= Date.now()
      ) {
        console.info(
          '[PR verification] Context result discarded because task or lease changed',
          {
            taskId: task.id,
            contextId: id,
            taskStatus: current.status,
            cancelRequested: current.cancelRequested,
          },
        );
        await transaction.commit();
        return;
      }
      await this.contexts.updateById(
        id,
        {
          data,
          metrics,
          error,
          status: data ? 'completed' : 'failed',
          model: process.env.AI_MODEL ?? 'qwen3:8b',
          promptVersion: PR_CONTEXT_PROMPT_VERSION,
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
        },
        options,
      );

      if (!data?.steps.length) {
        await this.tasks.updateById(
          task.id,
          {
            status: data ? 'completed' : 'failed',
            outcome: 'inconclusive',
            endedAt: new Date(),
            result: {
              summary: data
                ? 'The captured sources do not establish a browser scenario that can verify this fix.'
                : `PR context collection failed: ${error}`,
              verdict: 'inconclusive',
            },
          },
          options,
        );
      } else {
        const run = await this.runs.create(
          {
            id: randomUUID(),
            taskId: task.id,
            workspaceId: task.workspaceId,
            environmentId: task.environmentId,
            userId: task.requestedBy,
            stage: RUN_STAGE.FixVerification,
            attempt: 1,
            scriptName: 'agent',
            agentInput: {
              prompt:
                'Verify the proposed fix against the captured requirements.',
              targetUrl: task.targetUrl!,
              fixVerification: {
                title: task.issueTitle,
                contextId: id,
                headSha: task.headSha!,
                ...data,
              },
            },
            viewTokenHash: createHash('sha256')
              .update(randomBytes(32))
              .digest('hex'),
          },
          options,
        );
        console.info('[PR verification] Preparing browser run', {
          taskId: task.id,
          contextId: id,
          runId: run.id,
        });

        await this.events.create(
          {
            runId: run.id,
            type: 'run.queued',
            payload: {taskId: task.id, stage: run.stage},
          },
          options,
        );
        await this.tasks.updateById(
          task.id,
          {status: 'queued', queuedAt: new Date()},
          options,
        );
      }
      await transaction.commit();
      console.info('[PR verification] Context result persisted', {
        taskId: task.id,
        contextId: id,
        contextStatus: data ? 'completed' : 'failed',
        browserRunPrepared: Boolean(data?.steps.length),
        error,
      });
    } catch (failure) {
      await transaction.rollback();
      throw failure;
    }
  }
}
