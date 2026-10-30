import {Entity, model, property} from '@loopback/repository';

@model({
  settings: {
    forceId: true,
    postgresql: {schema: 'auth', table: 'workspace_invitation'},
  },
})
export class WorkspaceInvitation extends Entity {
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
    postgresql: {columnName: 'email', dataType: 'text'},
    required: true,
  })
  email!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'invited_by', dataType: 'uuid'},
    required: true,
  })
  invitedBy!: string;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt?: Date;

  constructor(data?: Partial<WorkspaceInvitation>) {
    super(data);
  }
}
