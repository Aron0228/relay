import {Entity, model, property} from '@loopback/repository';

export const WORKSPACE_ROLE = {Admin: 'admin', Member: 'member'} as const;
export type WorkspaceRole =
  (typeof WORKSPACE_ROLE)[keyof typeof WORKSPACE_ROLE];

@model({
  settings: {
    forceId: true,
    postgresql: {schema: 'auth', table: 'workspace_member'},
  },
})
export class WorkspaceMember extends Entity {
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
    postgresql: {columnName: 'user_id', dataType: 'uuid'},
    required: true,
  })
  userId!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'role', dataType: 'text'},
    required: true,
    jsonSchema: {enum: Object.values(WORKSPACE_ROLE)},
  })
  role!: WorkspaceRole;

  @property({
    type: 'date',
    postgresql: {columnName: 'joined_at', dataType: 'timestamptz'},
  })
  joinedAt?: Date;

  constructor(data?: Partial<WorkspaceMember>) {
    super(data);
  }
}
