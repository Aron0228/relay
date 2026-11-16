import {AuthorizationDecision} from '@loopback/authorization';
import {BindingScope, inject, injectable} from '@loopback/core';
import {repository, Transaction} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {IAM_POLICY_ENGINE_BINDING_KEY} from '../authorization/keys';
import {IamPolicyEngine} from '../authorization/policy-engine';
import {
  IAM_ACTION,
  IAM_RESOURCE_TYPE,
  IamAction,
  IamResource,
  IamSubject,
} from '../authorization/types';
import {
  GithubIssueRepository,
  GithubPullRequestRepository,
  GithubRepositoryRepository,
  UserRepository,
  WorkspaceInvitationRepository,
  RunRepository,
  TaskRepository,
  WorkspaceMemberRepository,
  WorkspaceRepository,
} from '../repositories';

@injectable({scope: BindingScope.SINGLETON})
export class IamAuthorizationService {
  constructor(
    @repository(WorkspaceRepository) private workspaces: WorkspaceRepository,
    @repository(WorkspaceMemberRepository)
    private members: WorkspaceMemberRepository,
    @repository(RunRepository) private runs: RunRepository,
    @repository(TaskRepository) private tasks: TaskRepository,
    @inject(IAM_POLICY_ENGINE_BINDING_KEY) private engine: IamPolicyEngine,
    @repository(GithubIssueRepository) private issues: GithubIssueRepository,
    @repository(GithubPullRequestRepository)
    private pullRequests: GithubPullRequestRepository,
    @repository(GithubRepositoryRepository)
    private repositories: GithubRepositoryRepository,
    @repository(UserRepository) private users: UserRepository,
    @repository(WorkspaceInvitationRepository)
    private invitations: WorkspaceInvitationRepository,
  ) {}

  async workspace(
    workspaceId: string,
    userId: string,
    action: IamAction = IAM_ACTION.WorkspaceRead,
    transaction?: Transaction,
  ) {
    const options = {transaction};
    const workspace = await this.workspaces.findOne(
      {where: {id: workspaceId, deletedAt: {eq: null as unknown as Date}}},
      options,
    );
    const member = await this.members.findOne(
      {where: {workspaceId, userId}},
      options,
    );

    if (!workspace || !member) {
      throw new HttpErrors.NotFound('Workspace not found');
    }

    const subject: IamSubject = {
      id: userId,
      workspaceId,
      role: member.role,
      isOwner: workspace.createdBy === userId,
    };

    this.enforce(subject, action, {
      type: IAM_RESOURCE_TYPE.Workspace,
      id: workspaceId,
      workspaceId,
    });

    return {
      ...workspace.toJSON(),
      createdBy: workspace.createdBy,
      isOwner: workspace.createdBy === userId,
      role: member.role,
    };
  }

  async assert(
    userId: string,
    action: IamAction,
    resource: Pick<IamResource, 'type' | 'id'>,
  ): Promise<void> {
    if (resource.type === IAM_RESOURCE_TYPE.Workspace) {
      await this.workspace(resource.id, userId, action);
      return;
    }

    if (resource.type === IAM_RESOURCE_TYPE.User) {
      this.enforce({id: userId}, action, resource);
      return;
    }

    if (resource.type === IAM_RESOURCE_TYPE.Invitation) {
      await this.invitation(resource.id, userId, action);
      return;
    }

    let workspaceId: string | undefined;
    let initiatorId: string | undefined;

    if (resource.type === IAM_RESOURCE_TYPE.Run) {
      const run = await this.runs.findOne({where: {id: resource.id}});

      if (!run) throw new HttpErrors.NotFound('Run not found');

      workspaceId = run.workspaceId ?? undefined;
      initiatorId = run.taskId
        ? (await this.tasks.findById(run.taskId)).requestedBy
        : (run.userId ?? undefined);
    } else if (
      resource.type === IAM_RESOURCE_TYPE.Issue ||
      resource.type === IAM_RESOURCE_TYPE.PullRequest
    ) {
      const source =
        resource.type === IAM_RESOURCE_TYPE.Issue
          ? await this.issues.findById(resource.id)
          : await this.pullRequests.findById(resource.id);
      const linkedRepository = await this.repositories.findById(source.repositoryId);
      workspaceId = linkedRepository.workspaceId;
    } else {
      const task = await this.tasks.findOne({where: {id: resource.id}});

      if (!task) throw new HttpErrors.NotFound('Task not found');

      workspaceId = task.workspaceId;
      initiatorId = task.requestedBy;
    }

    const workspace = workspaceId
      ? await this.workspace(workspaceId, userId)
      : undefined;

    if (!workspace && initiatorId !== userId) {
      throw new HttpErrors.NotFound('Resource not found');
    }

    this.enforce(
      {
        id: userId,
        workspaceId,
        role: workspace?.role,
        isOwner: workspace?.isOwner,
      },
      action,
      {...resource, workspaceId, initiatorId},
    );
  }

  async invitation(
    invitationId: string,
    userId: string,
    action: IamAction = IAM_ACTION.InvitationRespond,
    transaction?: Transaction,
  ): Promise<void> {
    const invitation = await this.invitations.findOne(
      {where: {id: invitationId}},
      {transaction},
    );
    const user = await this.users.findById(userId, undefined, {transaction});
    const workspace =
      invitation &&
      (await this.workspaces.findOne(
        {
          where: {
            id: invitation.workspaceId,
            deletedAt: {eq: null as unknown as Date},
          },
        },
        {transaction},
      ));

    if (
      !invitation ||
      !workspace ||
      !user.verifiedEmails?.includes(invitation.email)
    ) {
      throw new HttpErrors.NotFound('Invitation not found');
    }

    this.enforce({id: userId}, action, {
      type: IAM_RESOURCE_TYPE.Invitation,
      id: invitationId,
      recipientId: user.id,
    });
  }

  private enforce(
    subject: IamSubject,
    action: IamAction,
    resource: IamResource,
  ): void {
    if (
      this.engine.evaluate({subject, action, resource}) ===
      AuthorizationDecision.ALLOW
    ) {
      return;
    }

    throw new HttpErrors.Forbidden(
      action === IAM_ACTION.WorkspaceManage
        ? 'Workspace admin access is required'
        : 'Access denied',
    );
  }
}
