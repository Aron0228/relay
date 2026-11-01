import {belongsTo, Entity, model, property} from '@loopback/repository';
import {Run, RUN_STAGE} from './run.model';
import {Task} from './task.model';

@model({settings: {postgresql: {schema: 'execution', table: 'stage_request'}}})
export class StageRequest extends Entity {
  @property({
    type: 'string',
    id: true,
    generated: true,
    postgresql: {dataType: 'uuid'},
  })
  id!: string;

  @belongsTo(
    () => Task,
    {name: 'task'},
    {type: 'string', postgresql: {columnName: 'task_id', dataType: 'uuid'}},
  )
  taskId!: string;

  @belongsTo(
    () => Run,
    {name: 'sourceRun'},
    {
      type: 'string',
      postgresql: {columnName: 'source_run_id', dataType: 'uuid'},
    },
  )
  sourceRunId!: string;

  @property({
    type: 'string',
    required: true,
    jsonSchema: {enum: [RUN_STAGE.StepVerification, RUN_STAGE.Critic]},
  })
  stage!: typeof RUN_STAGE.StepVerification | typeof RUN_STAGE.Critic;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt?: Date;

  @property({
    type: 'date',
    postgresql: {columnName: 'consumed_at', dataType: 'timestamptz'},
  })
  consumedAt?: Date | null;

  constructor(data?: Partial<StageRequest>) {
    super(data);
  }
}
