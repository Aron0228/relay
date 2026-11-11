import {BindingScope, inject, lifeCycleObserver, service} from '@loopback/core';
import {repository} from '@loopback/repository';
import {randomUUID} from 'node:crypto';
import {positiveInteger} from '../ai/config';
import {describeBrowserAction, isBareBrowserAction} from '../ai/browser-action';
import {Task} from '../models';
import {
  GithubIssueRepository,
  GithubPullRequestRepository,
  RunEventRepository,
  RunResultRepository,
  TaskRepository,
} from '../repositories';
import {GithubAppService} from './github-app.service';
import {GithubConnectionService} from './github-connection.service';
import {IssuePipelineState} from './issue-pipeline-state';
import {
  WORKER_SERVICE_OPTIONS_BINDING_KEY,
  WorkerServiceOptions,
} from './worker.service';

export const GITHUB_FEEDBACK_SERVICE_BINDING_KEY =
  'services.GithubFeedbackService';

function feedbackDue(maximum: string): string {
  const retry = `((feedback_status IN ('pending', 'failed') AND feedback_attempts < ${maximum}
    AND (feedback_next_attempt_at IS NULL OR feedback_next_attempt_at <= now()))
    OR (feedback_status = 'sending' AND feedback_lease_expires_at <= now()))`;

  return `((ended_at IS NULL AND feedback_phase = 'progress' AND ${retry})
    OR (ended_at IS NOT NULL AND (
      (feedback_phase = 'progress' AND (feedback_status <> 'sending' OR feedback_lease_expires_at <= now()))
      OR (feedback_phase = 'final' AND ${retry}))))`;
}

@lifeCycleObserver('github-feedback', {scope: BindingScope.SINGLETON})
export class GithubFeedbackService {
  private readonly maxAttempts = positiveInteger(
    'GITHUB_FEEDBACK_MAX_ATTEMPTS',
    5,
  );
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private stopped = false;

  constructor(
    @repository(TaskRepository) private tasks: TaskRepository,
    @repository(RunEventRepository) private events: RunEventRepository,
    @repository(RunResultRepository) private results: RunResultRepository,
    @repository(GithubIssueRepository) private issues: GithubIssueRepository,
    @service(GithubAppService) private github: GithubAppService,
    @service(GithubConnectionService)
    private connections: GithubConnectionService,
    @inject(WORKER_SERVICE_OPTIONS_BINDING_KEY, {optional: true})
    private options: WorkerServiceOptions = {},
    @repository(GithubPullRequestRepository)
    private pullRequests?: GithubPullRequestRepository,
  ) {}

  start(): void {
    const enabled =
      process.env.GITHUB_FEEDBACK_ENABLED ??
      (process.env.NODE_ENV === 'test' ? 'false' : 'true');

    if (this.options.enabled === false || enabled === 'false') return;

    const tick = () => {
      this.pending ??= this.deliver()
        .catch(() => console.error('GitHub feedback recovery will retry'))
        .finally(() => {
          this.pending = undefined;
        });
    };
    this.timer = setInterval(tick, 5000);
    this.timer.unref();
    tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.pending;
  }

  private async deliver(): Promise<void> {
    const due = (await this.tasks.execute(
      `SELECT id FROM execution.task WHERE ${feedbackDue('$1')}
       ORDER BY created_at, id LIMIT 20`,
      [this.maxAttempts],
    )) as {id: string}[];

    for (const item of due) {
      if (this.stopped) break;
      await this.send(item.id);
    }
  }

  private async send(id: string): Promise<void> {
    const token = randomUUID();
    const claimed = (await this.tasks.execute(
      `WITH claimed AS (UPDATE execution.task SET feedback_status = 'sending', feedback_lease_token = $2,
       feedback_lease_expires_at = now() + interval '5 minutes',
       feedback_attempts = CASE WHEN feedback_phase = 'progress' AND ended_at IS NOT NULL THEN 1 ELSE feedback_attempts + 1 END,
       feedback_phase = CASE WHEN ended_at IS NULL THEN 'progress' ELSE 'final' END
       WHERE id = $1 AND ${feedbackDue('$3')} RETURNING id)
       SELECT id FROM claimed`,
      [id, token, this.maxAttempts],
    )) as {id: string}[];
    if (!claimed.length) return;

    const task = await this.tasks.findById(id);
    const marker = `<!-- relay-task:${task.id} -->`;
    let attemptedPost = false;

    try {
      const target = await this.connections.targetForTask(
        task.id,
        task.workspaceId,
        task.environmentId,
      );
      const issue =
        task.kind === 'pr_verification'
          ? await this.pullRequests!.findById(task.pullRequestId!)
          : await this.issues.findById(task.issueId!);
      const installationId = Number(target.installation.githubId);
      const repositoryId = Number(target.repository.githubId);
      let commentId = await this.github.findTaskComment(
        installationId,
        repositoryId,
        issue.number,
        marker,
      );

      if (!commentId || task.feedbackPhase === 'final') {
        if (!commentId && task.feedbackAttempts > this.maxAttempts)
          throw new Error('Feedback delivery attempt limit reached');

        const owned = (await this.tasks.execute(
          `WITH renewed AS (UPDATE execution.task SET feedback_lease_expires_at = now() + interval '5 minutes'
           WHERE id = $1 AND feedback_lease_token = $2 AND feedback_lease_expires_at > now() RETURNING id) SELECT id FROM renewed`,
          [id, token],
        )) as {id: string}[];

        if (!owned.length || this.stopped) return;

        const body =
          task.feedbackPhase === 'progress'
            ? this.progressComment(task, marker)
            : await this.comment(task, marker);

        if (commentId) {
          await this.github.updateComment(
            installationId,
            repositoryId,
            commentId,
            body,
          );
        } else {
          attemptedPost = true;
          commentId = (
            await this.github.createComment(
              installationId,
              repositoryId,
              issue.number,
              body,
            )
          ).githubId;
        }
      }

      if (task.kind === 'pr_verification') {
        console.info('[PR verification] GitHub feedback delivered', {
          taskId: task.id,
          commentId,
          phase: task.feedbackPhase,
        });
      }

      await this.tasks.updateAll(
        {
          feedbackStatus: 'sent',
          feedbackCommentId: commentId,
          feedbackSentAt: new Date(),
          feedbackError: null,
          feedbackLeaseToken: null,
          feedbackLeaseExpiresAt: null,
          feedbackNextAttemptAt: null,
        },
        {id, feedbackLeaseToken: token},
      );
    } catch (error) {
      if (task.kind === 'pr_verification') {
        console.info('[PR verification] GitHub feedback failed', {
          taskId: task.id,
          attempt: task.feedbackAttempts,
          error: (error as Error).message,
        });
      }

      const status = (error as {statusCode?: number}).statusCode;
      const permanent =
        status !== undefined && [400, 401, 403, 404, 409, 422].includes(status);
      const exhausted = permanent || task.feedbackAttempts >= this.maxAttempts;
      const retrySeconds = Math.min(
        86400,
        Math.max(
          15 * 2 ** Math.min(task.feedbackAttempts, 8),
          (error as {retryAfterSeconds?: number}).retryAfterSeconds ?? 0,
        ),
      );
      const reconcileLastPost =
        attemptedPost &&
        !permanent &&
        task.feedbackAttempts === this.maxAttempts;
      await this.tasks.updateAll(
        {
          feedbackStatus: reconcileLastPost ? 'sending' : 'failed',
          feedbackError: (error as Error).message.slice(0, 2000),
          feedbackAttempts: permanent
            ? this.maxAttempts
            : task.feedbackAttempts,
          feedbackNextAttemptAt: exhausted
            ? null
            : new Date(Date.now() + retrySeconds * 1000),
          feedbackLeaseToken: reconcileLastPost ? token : null,
          feedbackLeaseExpiresAt: reconcileLastPost
            ? new Date(Date.now() + retrySeconds * 1000)
            : null,
        },
        {id, feedbackLeaseToken: token},
      );
    }
  }

  private progressComment(task: Task, marker: string): string {
    return [
      marker,
      '## Investigation started',
      'The request has been accepted. This comment will be updated when the investigation finishes.',
      `Requested from [this comment](${task.sourceCommentUrl}).`,
    ].join('\n\n');
  }

  private async comment(task: Task, marker: string): Promise<string> {
    if (task.kind === 'pr_verification') return this.prComment(task, marker);

    const state: IssuePipelineState = task.result ?? {};
    const initial = state.reproductionRunId
      ? await this.results.findOne({where: {runId: state.reproductionRunId}})
      : undefined;
    const reproduction = state.reproduction ?? initial?.result.reproduction;
    const verified =
      state.verification === 'verified' && task.outcome !== 'inconclusive';
    const sourceRunId = verified
      ? state.confirmedRunId
      : state.reproductionRunId;
    const details = verified ? state.confirmed : reproduction;
    let steps =
      details?.steps.map(step => step.action) ??
      state.steps?.map(step => step.action) ??
      [];

    if (sourceRunId && (!steps.length || steps.some(isBareBrowserAction))) {
      const actions = await this.events.find({
        where: {runId: sourceRunId, type: 'action.completed'},
        order: ['sequence ASC'],
        limit: 100,
      });
      const descriptions = actions
        .map(event =>
          describeBrowserAction(String(event.payload.action), event.payload),
        )
        .filter((value): value is string => !!value);
      if (descriptions.length) steps = descriptions;
    }

    const configured =
      process.env.PUBLIC_WEB_URL ??
      new URL(
        process.env.OAUTH_WEB_REDIRECT_URI ??
          'http://localhost:4200/auth/callback',
      ).origin;
    const url = new URL(`/issues/${task.issueId}`, configured);
    if (!['https:', 'http:'].includes(url.protocol))
      throw new Error('PUBLIC_WEB_URL must use HTTP or HTTPS');
    url.searchParams.set('workspaceId', task.workspaceId);
    url.searchParams.set('taskId', task.id);
    const plain = (value: string, maximum = 2000) =>
      value
        .replace(/[\\`*_[\]<>]/g, '\\$&')
        .replace(/@/g, '@\u200b')
        .slice(0, maximum);
    const label =
      task.outcome === 'reproduced'
        ? 'Reproduced and independently confirmed'
        : task.outcome === 'not_reproduced'
          ? 'Not reproduced in either run'
          : 'Could not confirm the issue';
    const conditions = details?.preconditions ?? state.preconditions ?? [];

    return [
      marker,
      `## ${label}`,
      plain(
        state.summary ??
          'The investigation ended without enough evidence to decide.',
        4000,
      ),
      '### What the first run observed',
      plain(
        reproduction?.actualBehavior ??
          state.actualBehavior ??
          'No observation was recorded.',
      ),
      ...(state.verificationObservation
        ? [
            '### What the verification run reported',
            plain(state.verificationObservation),
          ]
        : []),
      verified
        ? '### Confirmed steps'
        : '### Initial reproduction steps (not independently confirmed)',
      ...(steps.length
        ? steps.map(
            (step, index) =>
              `${index + 1}. ${plain(step, 350).replace(/\n/g, ' ')}`,
          )
        : ['No usable step sequence was recorded.']),
      ...(conditions.length
        ? [
            '### Required starting conditions',
            ...conditions.map(
              value => `- ${plain(value, 250).replace(/\n/g, ' ')}`,
            ),
          ]
        : []),
      '### Expected behavior',
      plain(
        reproduction?.expectedBehavior ??
          state.expectedBehavior ??
          'The expected behavior was not established.',
      ),
      `[View both runs, their observations and recordings](${url.toString()})`,
      'Sign in with a workspace member account to view the recordings.',
    ]
      .join('\n\n')
      .slice(0, 60000);
  }
  private prComment(task: Task, marker: string): string {
    const result = task.result as
      | {
          summary?: string;
          expectedBehavior?: string;
          actualBehavior?: string;
          steps?: {action: string}[];
        }
      | undefined;
    const origin =
      process.env.PUBLIC_WEB_URL ??
      new URL(
        process.env.OAUTH_WEB_REDIRECT_URI ??
          'http://localhost:4200/auth/callback',
      ).origin;
    const url = new URL(`/pull-requests/${task.pullRequestId}`, origin);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('PUBLIC_WEB_URL must use HTTP or HTTPS');
    url.searchParams.set('workspaceId', task.workspaceId);
    url.searchParams.set('taskId', task.id);
    const plain = (value: string) =>
      value
        .replace(/[\\`*_[\]<>]/g, '\\$&')
        .replace(/@/g, '@\u200b')
        .slice(0, 4000);
    const label =
      task.outcome === 'fixed'
        ? 'Fix verified'
        : task.outcome === 'not_fixed'
          ? 'Issue still occurs'
          : 'Fix verification inconclusive';

    return [
      marker,
      `## ${label}`,
      plain(result?.summary ?? 'No conclusive browser result was recorded.'),
      `Captured PR head: \`${task.headSha}\``,
      `Tested environment: ${plain(task.targetUrl!)}`,
      'The deployed version was supplied by the requester; its commit was not verified.',
      '### Checked steps',
      ...(result?.steps?.map(
        (step, index) =>
          `${index + 1}. ${plain(step.action).replace(/\n/g, ' ')}`,
      ) ?? ['No complete scenario was recorded.']),
      '### Expected behavior',
      plain(result?.expectedBehavior ?? 'Not established.'),
      '### Observed behavior',
      plain(result?.actualBehavior ?? 'No observation was recorded.'),
      `[View context, run and protected recording](${url.toString()})`,
      'Sign in with a workspace member account to view the recording.',
    ]
      .join('\n\n')
      .slice(0, 60000);
  }
}
