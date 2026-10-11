import {Entity, model, property} from '@loopback/repository';

@model({settings: {postgresql: {schema: 'execution', table: 'run_event'}}})
export class RunEvent extends Entity {
  @property({
    type: 'string',
    id: true,
    generated: true,
    postgresql: {dataType: 'uuid'},
  })
  id!: string;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'run_id', dataType: 'uuid'},
  })
  runId!: string;

  @property({type: 'number', generated: true, postgresql: {dataType: 'bigint'}})
  sequence!: number;

  @property({type: 'string', required: true})
  type!: string;

  @property({type: 'object', default: {}, postgresql: {dataType: 'jsonb'}})
  payload!: Record<string, unknown>;

  @property({
    type: 'date',
    defaultFn: 'now',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt!: Date;

  constructor(data?: Partial<RunEvent>) {
    super(data);
  }
}
