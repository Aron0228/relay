import {belongsTo, Entity, model, property} from '@loopback/repository';
import {Workspace} from '../auth/workspace.model';
import {Environment} from '../auth/environment.model';
import {GithubRepository} from '../github/repository.model';
import {GithubIssue} from '../github/issue.model';
import {User} from '../auth/user.model';

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
  Reproduced: 'reproduced',
  NotReproduced: 'not_reproduced',
  Inconclusive: 'inconclusive',
} as const;

export type TaskOutcome = (typeof TASK_OUTCOME)[keyof typeof TASK_OUTCOME];

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
      required: true,
      postgresql: {columnName: 'issue_id', dataType: 'uuid'},
    },
  )
  issueId!: string;

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
    type: 'string',
    required: true,
    default: TASK_FEEDBACK_STATUS.Pending,
    jsonSchema: {enum: Object.values(TASK_FEEDBACK_STATUS)},
    postgresql: {columnName: 'feedback_status', dataType: 'text'},
  })
  feedbackStatus!: TaskFeedbackStatus;

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
