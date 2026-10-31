import {belongsTo, Entity, model, property} from '@loopback/repository';
import {Workspace} from '../auth/workspace.model';

@model({
  settings: {
    forceId: true,
    postgresql: {schema: 'github', table: 'installation'},
  },
})
export class GithubInstallation extends Entity {
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

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'account_login', dataType: 'text'},
  })
  accountLogin!: string;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt?: Date;

  @property({
    type: 'date',
    postgresql: {columnName: 'disconnected_at', dataType: 'timestamptz'},
  })
  disconnectedAt?: Date | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'connected_by', dataType: 'uuid'},
  })
  connectedBy?: string | null;

  constructor(data?: Partial<GithubInstallation>) {
    super(data);
  }
}
