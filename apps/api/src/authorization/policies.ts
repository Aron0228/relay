import {
  IAM_ACTION,
  IAM_EFFECT,
  IAM_RESOURCE_TYPE,
  IAM_ROLE,
  IamPolicy,
} from './types';

const administrators = [IAM_ROLE.Owner, IAM_ROLE.Admin];

export const IAM_POLICIES: readonly IamPolicy[] = [
  {
    name: 'users-can-manage-their-own-collections',
    effect: IAM_EFFECT.Allow,
    actions: [
      IAM_ACTION.WorkspaceList,
      IAM_ACTION.WorkspaceCreate,
      IAM_ACTION.InvitationList,
      IAM_ACTION.RunList,
    ],
    resourceType: IAM_RESOURCE_TYPE.User,
    condition: ({subject, resource}) => subject.id === resource.id,
  },
  {
    name: 'invitation-recipients-can-respond',
    effect: IAM_EFFECT.Allow,
    actions: [IAM_ACTION.InvitationRespond],
    resourceType: IAM_RESOURCE_TYPE.Invitation,
    condition: ({subject, resource}) => subject.id === resource.recipientId,
  },
  ...(
    [
      [IAM_RESOURCE_TYPE.Issue, IAM_ACTION.IssueRead],
      [IAM_RESOURCE_TYPE.PullRequest, IAM_ACTION.PullRequestRead],
    ] as const
  ).map(
    ([resourceType, action]) =>
      ({
        name: `${resourceType}-members-can-read`,
        effect: IAM_EFFECT.Allow,
        actions: [action],
        resourceType,
        roles: [...administrators, IAM_ROLE.Member],
      }) satisfies IamPolicy,
  ),
  {
    name: 'workspace-members-can-read',
    effect: IAM_EFFECT.Allow,
    actions: [IAM_ACTION.WorkspaceRead],
    resourceType: IAM_RESOURCE_TYPE.Workspace,
    roles: [...administrators, IAM_ROLE.Member],
  },
  {
    name: 'workspace-members-can-list-investigations',
    effect: IAM_EFFECT.Allow,
    actions: [IAM_ACTION.IssuesList, IAM_ACTION.PullRequestsList],
    resourceType: IAM_RESOURCE_TYPE.Workspace,
    roles: [...administrators, IAM_ROLE.Member],
  },
  {
    name: 'workspace-members-can-start-runs',
    effect: IAM_EFFECT.Allow,
    actions: [IAM_ACTION.RunCreate],
    resourceType: IAM_RESOURCE_TYPE.Workspace,
    roles: [...administrators, IAM_ROLE.Member],
  },
  {
    name: 'workspace-administrators-can-update',
    effect: IAM_EFFECT.Allow,
    actions: [IAM_ACTION.WorkspaceUpdate],
    resourceType: IAM_RESOURCE_TYPE.Workspace,
    roles: administrators,
  },
  {
    name: 'workspace-management-requires-admin-membership',
    effect: IAM_EFFECT.Allow,
    actions: [IAM_ACTION.WorkspaceManage],
    resourceType: IAM_RESOURCE_TYPE.Workspace,
    roles: [IAM_ROLE.Admin],
  },
  ...[
    IAM_ACTION.WorkspaceDelete,
    IAM_ACTION.MembersManage,
    IAM_ACTION.InvitationsManage,
    IAM_ACTION.EnvironmentsManage,
  ].map(action => ({
    name: `${action}-requires-admin-membership`,
    effect: IAM_EFFECT.Allow,
    actions: [action],
    resourceType: IAM_RESOURCE_TYPE.Workspace,
    roles: [IAM_ROLE.Admin],
  })),
  {
    name: 'run-members-or-initiator-can-read',
    effect: IAM_EFFECT.Allow,
    actions: [IAM_ACTION.RunRead],
    resourceType: IAM_RESOURCE_TYPE.Run,
    condition: ({subject, resource}) =>
      resource.workspaceId !== undefined || subject.id === resource.initiatorId,
  },
  ...[IAM_RESOURCE_TYPE.Run, IAM_RESOURCE_TYPE.Task].flatMap(resourceType => {
    const action =
      resourceType === IAM_RESOURCE_TYPE.Run
        ? IAM_ACTION.RunCancel
        : IAM_ACTION.TaskCancel;

    return [
      {
        name: `${resourceType}-administrators-can-cancel`,
        effect: IAM_EFFECT.Allow,
        actions: [action],
        resourceType,
        roles: administrators,
      },
      {
        name: `${resourceType}-initiator-can-cancel`,
        effect: IAM_EFFECT.Allow,
        actions: [action],
        resourceType,
        condition: ({subject, resource}) => subject.id === resource.initiatorId,
      },
    ] satisfies IamPolicy[];
  }),
];
