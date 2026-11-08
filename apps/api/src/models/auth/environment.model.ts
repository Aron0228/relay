import {belongsTo, Entity, model, property} from '@loopback/repository';
import {GithubRepository} from '../github/repository.model';

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
  })
  baseUrl?: string | null;

  @belongsTo(
    () => GithubRepository,
    {name: 'repository'},
    {
      type: 'string',
      postgresql: {columnName: 'repository_id', dataType: 'uuid'},
    },
  )
  repositoryId?: string;

  @property({
    type: 'array',
    itemType: 'string',
    default: [],
    postgresql: {columnName: 'allowed_origins', dataType: 'jsonb'},
  })
  allowedOrigins!: string[];

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
