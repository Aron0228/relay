import {belongsTo, Entity, model, property} from '@loopback/repository';
import {Workspace} from '../auth/workspace.model';
import {Environment} from '../auth/environment.model';
import {GithubRepository} from '../github/repository.model';
import {GithubIssue} from '../github/issue.model';
import {GithubPullRequest} from '../github/pull-request.model';
import {User} from '../auth/user.model';

export const TASK_KIND = {
  IssueReproduction: 'issue_reproduction',
  PrVerification: 'pr_verification',
} as const;
export type TaskKind = (typeof TASK_KIND)[keyof typeof TASK_KIND];

export const TASK_STATUS = {
  Pending: 'pending',
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_OUTCOME = {
  Fixed: 'fixed',
  NotFixed: 'not_fixed',
  Reproduced: 'reproduced',
  NotReproduced: 'not_reproduced',
  Inconclusive: 'inconclusive',
} as const;

export type TaskOutcome = (typeof TASK_OUTCOME)[keyof typeof TASK_OUTCOME];

export const TASK_FEEDBACK_PHASE = {
  Progress: 'progress',
  Final: 'final',
} as const;
export type TaskFeedbackPhase =
  (typeof TASK_FEEDBACK_PHASE)[keyof typeof TASK_FEEDBACK_PHASE];

export const TASK_FEEDBACK_STATUS = {
  Pending: 'pending',
  Sending: 'sending',
  Sent: 'sent',
  Failed: 'failed',
} as const;

export type TaskFeedbackStatus =
  (typeof TASK_FEEDBACK_STATUS)[keyof typeof TASK_FEEDBACK_STATUS];

@model({
  settings: {forceId: true, postgresql: {schema: 'execution', table: 'task'}},
})
export class Task extends Entity {
  @property({type: 'string', id: true, postgresql: {dataType: 'uuid'}})
  id!: string;

  @belongsTo(
    () => Workspace,
    {name: 'workspace'},
    {
      type: 'string',
      required: true,
      postgresql: {columnName: 'workspace_id', dataType: 'uuid'},
    },
  )
  workspaceId!: string;

  @belongsTo(
    () => Environment,
    {name: 'environment'},
    {
      type: 'string',
      required: true,
      postgresql: {columnName: 'environment_id', dataType: 'uuid'},
    },
  )
  environmentId!: string;

  @belongsTo(
    () => GithubRepository,
    {name: 'repository'},
    {
      type: 'string',
      required: true,
      postgresql: {columnName: 'repository_id', dataType: 'uuid'},
    },
  )
  repositoryId!: string;

  @belongsTo(
    () => GithubIssue,
    {name: 'issue'},
    {
      type: 'string',
      postgresql: {columnName: 'issue_id', dataType: 'uuid'},
    },
  )
  issueId?: string;

  @property({
    type: 'string',
    default: 'issue_reproduction',
    jsonSchema: {enum: Object.values(TASK_KIND)},
  })
  kind!: TaskKind;

  @belongsTo(
    () => GithubPullRequest,
    {name: 'pullRequest'},
    {
      type: 'string',
      postgresql: {columnName: 'pull_request_id', dataType: 'uuid'},
    },
  )
  pullRequestId?: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'target_url', dataType: 'text'},
  })
  targetUrl?: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'base_sha', dataType: 'text'},
  })
  baseSha?: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'head_sha', dataType: 'text'},
  })
  headSha?: string;

  @belongsTo(
    () => User,
    {name: 'requester'},
    {
      type: 'string',
      required: true,
      postgresql: {columnName: 'requested_by', dataType: 'uuid'},
    },
  )
  requestedBy!: string;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'issue_title', dataType: 'text'},
  })
  issueTitle!: string;

  @property({
    type: 'string',
    default: '',
    postgresql: {columnName: 'issue_body', dataType: 'text'},
  })
  issueBody!: string;

  @property({
    type: 'number',
    required: true,
    postgresql: {columnName: 'source_comment_id', dataType: 'bigint'},
  })
  sourceCommentId!: number;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'source_comment_url', dataType: 'text'},
  })
  sourceCommentUrl!: string;

  @property({
    type: 'string',
    required: true,
    default: TASK_STATUS.Pending,
    jsonSchema: {enum: Object.values(TASK_STATUS)},
  })
  status!: TaskStatus;

  @property({type: 'string', jsonSchema: {enum: Object.values(TASK_OUTCOME)}})
  outcome?: TaskOutcome | null;

  @property({type: 'object', postgresql: {dataType: 'jsonb'}})
  result?: Record<string, unknown> | null;

  @property({
    type: 'boolean',
    default: false,
    postgresql: {columnName: 'cancel_requested'},
  })
  cancelRequested!: boolean;

  @property({
    type: 'number',
    default: 0,
    postgresql: {columnName: 'feedback_attempts', dataType: 'integer'},
  })
  feedbackAttempts!: number;

  @property({
    type: 'date',
    postgresql: {
      columnName: 'feedback_next_attempt_at',
      dataType: 'timestamptz',
    },
  })
  feedbackNextAttemptAt?: Date | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'feedback_lease_token', dataType: 'uuid'},
  })
  feedbackLeaseToken?: string | null;

  @property({
    type: 'date',
    postgresql: {
      columnName: 'feedback_lease_expires_at',
      dataType: 'timestamptz',
    },
  })
  feedbackLeaseExpiresAt?: Date | null;

  @property({
    type: 'string',
    required: true,
    default: TASK_FEEDBACK_STATUS.Pending,
    jsonSchema: {enum: Object.values(TASK_FEEDBACK_STATUS)},
    postgresql: {columnName: 'feedback_status', dataType: 'text'},
  })
  feedbackStatus!: TaskFeedbackStatus;

  @property({
    type: 'string',
    default: TASK_FEEDBACK_PHASE.Progress,
    jsonSchema: {enum: Object.values(TASK_FEEDBACK_PHASE)},
    postgresql: {columnName: 'feedback_phase'},
  })
  feedbackPhase!: TaskFeedbackPhase;

  @property({
    type: 'number',
    postgresql: {columnName: 'feedback_comment_id', dataType: 'bigint'},
  })
  feedbackCommentId?: number | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'feedback_error', dataType: 'text'},
  })
  feedbackError?: string | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'feedback_sent_at', dataType: 'timestamptz'},
  })
  feedbackSentAt?: Date | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt?: Date;

  @property({
    type: 'date',
    postgresql: {columnName: 'queued_at', dataType: 'timestamptz'},
  })
  queuedAt?: Date | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'started_at', dataType: 'timestamptz'},
  })
  startedAt?: Date | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'ended_at', dataType: 'timestamptz'},
  })
  endedAt?: Date | null;

  constructor(data?: Partial<Task>) {
    super(data);
  }
}
