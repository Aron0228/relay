import {Entity, model, property} from '@loopback/repository';

@model({
  settings: {
    forceId: false,
    postgresql: {schema: 'knowledge', table: 'run_patch'},
  },
})
export class RunPatch extends Entity {
  @property({
    type: 'string',
    id: true,
    generated: true,
    postgresql: {columnName: 'id', dataType: 'uuid'},
  })
  id!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'run_id', dataType: 'uuid'},
  })
  runId!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'patch_id', dataType: 'uuid'},
  })
  patchId!: string;

  @property({
    type: 'object',
    postgresql: {columnName: 'snapshot', dataType: 'jsonb'},
  })
  snapshot!: Record<string, unknown>;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt!: Date;

  constructor(data?: Partial<RunPatch>) {
    super(data);
  }
}
