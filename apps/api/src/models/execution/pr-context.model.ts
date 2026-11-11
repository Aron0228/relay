import {belongsTo, Entity, model, property} from '@loopback/repository';
import {Task} from './task.model';
import {PrContextData, PrSource} from '../../ai/pr-context';
import {TokenUsage} from '../../ai/types';

@model({
  settings: {
    forceId: true,
    postgresql: {schema: 'execution', table: 'pr_context'},
  },
})
export class PrContext extends Entity {
  @property({type: 'string', id: true, postgresql: {dataType: 'uuid'}})
  id!: string;

  @belongsTo(
    () => Task,
    {name: 'task'},
    {
      type: 'string',
      required: true,
      postgresql: {columnName: 'task_id', dataType: 'uuid'},
    },
  )
  taskId!: string;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'head_sha'},
  })
  headSha!: string;

  @property({type: 'string', default: 'pending'})
  status!: 'pending' | 'collecting' | 'completed' | 'failed' | 'cancelled';

  @property({type: 'string'})
  model?: string;

  @property({type: 'string', postgresql: {columnName: 'prompt_version'}})
  promptVersion?: string;

  @property({type: 'object', postgresql: {dataType: 'jsonb'}})
  data?: PrContextData;

  @property({
    type: 'array',
    itemType: 'object',
    postgresql: {dataType: 'jsonb'},
  })
  sources!: PrSource[];

  @property({type: 'object', postgresql: {dataType: 'jsonb'}})
  metrics?: TokenUsage;

  @property({type: 'string'})
  error?: string;

  @property({type: 'number', default: 0})
  attempts!: number;

  @property({
    type: 'string',
    postgresql: {columnName: 'lease_token', dataType: 'uuid'},
  })
  leaseToken?: string | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'lease_expires_at', dataType: 'timestamptz'},
  })
  leaseExpiresAt?: Date | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt!: Date;

  @property({
    type: 'date',
    postgresql: {columnName: 'completed_at', dataType: 'timestamptz'},
  })
  completedAt?: Date;

  constructor(data?: Partial<PrContext>) {
    super(data);
  }
}
