import {Entity, model, property} from '@loopback/repository';

@model({
  settings: {forceId: true, postgresql: {schema: 'auth', table: 'workspace'}},
})
export class Workspace extends Entity {
  @property({
    type: 'string',
    postgresql: {columnName: 'id', dataType: 'uuid'},
    id: true,
  })
  id!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'name', dataType: 'text'},
    required: true,
  })
  name!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'avatar_url', dataType: 'text'},
  })
  avatarUrl?: string | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'created_by', dataType: 'uuid'},
    required: true,
  })
  createdBy!: string;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt?: Date;

  @property({
    type: 'date',
    postgresql: {columnName: 'updated_at', dataType: 'timestamptz'},
  })
  updatedAt?: Date;

  @property({
    type: 'date',
    postgresql: {columnName: 'deleted_at', dataType: 'timestamptz'},
  })
  deletedAt?: Date | null;

  constructor(data?: Partial<Workspace>) {
    super(data);
  }
}
