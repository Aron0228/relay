import {Entity, model, property} from '@loopback/repository';
import {AgentResult} from '../../ai/types';

@model({settings: {postgresql: {schema: 'execution', table: 'run_result'}}})
export class RunResult extends Entity {
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

  @property({type: 'string', default: 'browser-test'})
  type!: string;

  @property({type: 'string', required: true})
  status!: AgentResult['verdict'];

  @property({type: 'number', required: true})
  confidence!: number;

  @property({type: 'object', required: true, postgresql: {dataType: 'jsonb'}})
  result!: AgentResult;

  @property({
    type: 'date',
    defaultFn: 'now',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt!: Date;

  constructor(data?: Partial<RunResult>) {
    super(data);
  }
}
