import {AgentInput} from '../../ai/types';
import {Task} from './task.model';
import {belongsTo, Entity, model, property} from '@loopback/repository';

export const RUN_STAGE = {
  Reproduction: 'reproduction',
  StepVerification: 'step_verification',
  Critic: 'critic',
} as const;

export type RunStage = (typeof RUN_STAGE)[keyof typeof RUN_STAGE];

export const RUN_STATUS = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export function isRunFinished(status: RunStatus): boolean {
  return status !== RUN_STATUS.Queued && status !== RUN_STATUS.Running;
}

@model({
  settings: {forceId: false, postgresql: {schema: 'execution', table: 'run'}},
})
export class Run extends Entity {
  @belongsTo(
    () => Task,
    {name: 'task'},
    {type: 'string', postgresql: {columnName: 'task_id', dataType: 'uuid'}},
  )
  taskId?: string;

  @property({type: 'string', jsonSchema: {enum: Object.values(RUN_STAGE)}})
  stage?: RunStage | null;

  @property({
    type: 'number',
    jsonSchema: {minimum: 1},
    postgresql: {dataType: 'integer'},
  })
  attempt?: number | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'workspace_id', dataType: 'uuid'},
  })
  workspaceId?: string | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'environment_id', dataType: 'uuid'},
  })
  environmentId?: string | null;

  @property({
    type: 'string',
    id: true,
    required: true,
    postgresql: {dataType: 'uuid'},
  })
  id!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'user_id', dataType: 'uuid'},
  })
  userId?: string | null;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'script_name', dataType: 'text'},
  })
  scriptName!: string;

  @property({
    type: 'object',
    postgresql: {columnName: 'agent_input', dataType: 'jsonb'},
  })
  agentInput?: AgentInput;

  @property({
    type: 'string',
    required: true,
    default: RUN_STATUS.Queued,
    jsonSchema: {enum: Object.values(RUN_STATUS)},
  })
  status!: RunStatus;

  @property({
    type: 'string',
    required: true,
    postgresql: {
      columnName: 'view_token_hash',
      dataType: 'varchar',
      dataLength: 64,
    },
  })
  viewTokenHash!: string;

  @property({
    type: 'boolean',
    default: false,
    postgresql: {columnName: 'cancel_requested', dataType: 'boolean'},
  })
  cancelRequested!: boolean;

  @property({
    type: 'number',
    postgresql: {columnName: 'worker_pid', dataType: 'integer'},
  })
  workerPid?: number | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'video_file', dataType: 'text'},
  })
  videoFile?: string | null;

  @property({type: 'string'})
  error?: string | null;

  @property({
    type: 'date',
    defaultFn: 'now',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt!: Date;

  @property({
    type: 'date',
    defaultFn: 'now',
    postgresql: {columnName: 'queued_at', dataType: 'timestamptz'},
  })
  queuedAt!: Date;

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

  constructor(data?: Partial<Run>) {
    super(data);
  }
}
