import {Entity, model, property} from '@loopback/repository';

@model({
  settings: {
    forceId: false,
    postgresql: {schema: 'github', table: 'installation_intent'},
  },
})
export class InstallationIntent extends Entity {
  @property({
    type: 'string',
    id: true,
    required: true,
    postgresql: {columnName: 'state_hash', dataType: 'varchar', dataLength: 64},
  })
  stateHash!: string;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'workspace_id', dataType: 'uuid'},
  })
  workspaceId!: string;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'user_id', dataType: 'uuid'},
  })
  userId!: string;

  @property({
    type: 'date',
    required: true,
    postgresql: {columnName: 'expires_at', dataType: 'timestamptz'},
  })
  expiresAt!: Date;

  constructor(data?: Partial<InstallationIntent>) {
    super(data);
  }
}
