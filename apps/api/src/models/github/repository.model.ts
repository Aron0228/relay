import {belongsTo, Entity, model, property} from '@loopback/repository';
import {Workspace} from '../auth/workspace.model';
import {GithubInstallation} from './installation.model';
import {Environment} from '../auth/environment.model';

@model({
  settings: {
    forceId: true,
    postgresql: {schema: 'github', table: 'repository'},
  },
})
export class GithubRepository extends Entity {
  @property({type: 'string', id: true, postgresql: {dataType: 'uuid'}})
  id!: string;

  @property({
    type: 'number',
    required: true,
    postgresql: {columnName: 'github_id', dataType: 'bigint'},
  })
  githubId!: number;

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
    () => GithubInstallation,
    {name: 'installation'},
    {
      type: 'string',
      required: true,
      postgresql: {columnName: 'installation_id', dataType: 'uuid'},
    },
  )
  installationId!: string;

  @belongsTo(
    () => Environment,
    {name: 'defaultEnvironment'},
    {
      type: 'string',
      required: true,
      postgresql: {columnName: 'default_environment_id', dataType: 'uuid'},
    },
  )
  defaultEnvironmentId!: string;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'full_name', dataType: 'text'},
  })
  fullName!: string;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt?: Date;

  constructor(data?: Partial<GithubRepository>) {
    super(data);
  }
}
