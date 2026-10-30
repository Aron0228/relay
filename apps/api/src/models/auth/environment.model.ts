import {Entity, model, property} from '@loopback/repository';

@model({
  settings: {forceId: true, postgresql: {schema: 'auth', table: 'environment'}},
})
export class Environment extends Entity {
  @property({
    type: 'string',
    postgresql: {columnName: 'id', dataType: 'uuid'},
    id: true,
  })
  id!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'workspace_id', dataType: 'uuid'},
    required: true,
  })
  workspaceId!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'name', dataType: 'text'},
    required: true,
  })
  name!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'base_url', dataType: 'text'},
    required: true,
  })
  baseUrl!: string;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt?: Date;

  @property({
    type: 'date',
    postgresql: {columnName: 'deleted_at', dataType: 'timestamptz'},
  })
  deletedAt?: Date | null;

  constructor(data?: Partial<Environment>) {
    super(data);
  }
}
