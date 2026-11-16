import {WorkspaceRole} from '../models/auth/workspace-member.model';

export const IAM_ACTION = {
  WorkspaceList: 'workspace:list',
  WorkspaceCreate: 'workspace:create',
  InvitationList: 'invitation:list',
  InvitationRespond: 'invitation:respond',
  IssuesList: 'issues:list',
  PullRequestsList: 'pull-requests:list',
  IssueRead: 'issue:read',
  PullRequestRead: 'pull-request:read',
  RunList: 'run:list',
  RunCreate: 'run:create',
  WorkspaceRead: 'workspace:read',
  WorkspaceManage: 'workspace:manage',
  WorkspaceUpdate: 'workspace:update',
  WorkspaceDelete: 'workspace:delete',
  MembersManage: 'members:manage',
  InvitationsManage: 'invitations:manage',
  EnvironmentsManage: 'environments:manage',
  RunRead: 'run:read',
  RunCancel: 'run:cancel',
  TaskCancel: 'task:cancel',
} as const;

export type IamAction = (typeof IAM_ACTION)[keyof typeof IAM_ACTION];

export const IAM_RESOURCE_TYPE = {
  User: 'user',
  Invitation: 'invitation',
  Issue: 'issue',
  PullRequest: 'pull-request',
  Workspace: 'workspace',
  Run: 'run',
  Task: 'task',
} as const;

export type IamResourceType =
  (typeof IAM_RESOURCE_TYPE)[keyof typeof IAM_RESOURCE_TYPE];

export const IAM_ROLE = {
  Owner: 'owner',
  Admin: 'admin',
  Member: 'member',
} as const;

export type IamRole = (typeof IAM_ROLE)[keyof typeof IAM_ROLE];

export const IAM_EFFECT = {Allow: 'allow', Deny: 'deny'} as const;
export type IamEffect = (typeof IAM_EFFECT)[keyof typeof IAM_EFFECT];

export interface IamSubject {
  id: string;
  workspaceId?: string;
  role?: WorkspaceRole;
  isOwner?: boolean;
}

export interface IamResource {
  type: IamResourceType;
  id: string;
  workspaceId?: string;
  initiatorId?: string;
  recipientId?: string;
}

export interface IamRequest {
  subject: IamSubject;
  action: IamAction;
  resource: IamResource;
}

export interface IamPolicy {
  name: string;
  effect: IamEffect;
  actions: readonly IamAction[];
  resourceType: IamResourceType;
  roles?: readonly IamRole[];
  condition?: (request: IamRequest) => boolean;
}
