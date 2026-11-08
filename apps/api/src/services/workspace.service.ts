import {BindingScope, injectable} from '@loopback/core';
import {IsolationLevel, repository, Transaction} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {allowedOrigins, approvedUrl} from '../ai/config';
import {
  environmentTarget,
  normalizeEnvironmentOrigin,
} from '../ai/environment-target';
import {Workspace, WorkspaceRole} from '../models';
import {
  EnvironmentRepository,
  UserRepository,
  WorkspaceInvitationRepository,
  WorkspaceMemberRepository,
  WorkspaceRepository,
} from '../repositories';

export const WORKSPACE_SERVICE_BINDING_KEY = 'services.WorkspaceService';

@injectable({scope: BindingScope.SINGLETON})
export class WorkspaceService {
  constructor(
    @repository(WorkspaceRepository) private workspaces: WorkspaceRepository,
    @repository(WorkspaceMemberRepository)
    private members: WorkspaceMemberRepository,
    @repository(WorkspaceInvitationRepository)
    private invitations: WorkspaceInvitationRepository,
    @repository(EnvironmentRepository)
    private environments: EnvironmentRepository,
    @repository(UserRepository) private users: UserRepository,
  ) {}

  async list(userId: string) {
    const memberships = await this.members.find({where: {userId}});
    const workspaces = await this.workspaces.find({
      where: {
        id: {inq: memberships.map(item => item.workspaceId)},
        deletedAt: {eq: null as unknown as Date},
      },
      order: ['createdAt ASC'],
    });

    const counts = (await this.members.execute(
      'SELECT m.workspace_id AS "workspaceId", count(*)::int AS count FROM auth.workspace_member m WHERE EXISTS (SELECT 1 FROM auth.workspace_member own WHERE own.workspace_id = m.workspace_id AND own.user_id = $1) GROUP BY m.workspace_id',
      [userId],
    )) as {workspaceId: string; count: number}[];

    return workspaces.map(workspace => ({
      ...workspace.toJSON(),
      isOwner: workspace.createdBy === userId,
      memberCount:
        counts.find(item => item.workspaceId === workspace.id)?.count ?? 0,
      role: memberships.find(item => item.workspaceId === workspace.id)!.role,
    }));
  }

  async requireMember(
    workspaceId: string,
    userId: string,
    admin = false,
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

    if (!workspace || !member)
      throw new HttpErrors.NotFound('Workspace not found');
    if (admin && member.role !== 'admin')
      throw new HttpErrors.Forbidden('Workspace admin access is required');

    return {
      ...workspace.toJSON(),
      createdBy: workspace.createdBy,
      isOwner: workspace.createdBy === userId,
      role: member.role,
    };
  }

  async create(userId: string, name: string, avatarUrl?: string | null) {
    const transaction = await this.workspaces.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );

    try {
      const workspace = await this.workspaces.create(
        {name: name.trim(), avatarUrl, createdBy: userId},
        {transaction},
      );

      await this.members.create(
        {workspaceId: workspace.id, userId, role: 'admin'},
        {transaction},
      );
      await transaction.commit();

      return {
        ...workspace.toJSON(),
        id: workspace.id,
        isOwner: true,
        role: 'admin' as const,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async locked<T>(
    workspaceId: string,
    action: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    const transaction = await this.workspaces.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );

    try {
      await this.workspaces.execute(
        'SELECT id FROM auth.workspace WHERE id = $1 FOR UPDATE',
        [workspaceId],
        {transaction},
      );
      const result = await action(transaction);

      await transaction.commit();

      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async update(
    workspaceId: string,
    userId: string,
    data: Pick<Partial<Workspace>, 'name' | 'avatarUrl'>,
  ) {
    return this.locked(workspaceId, async transaction => {
      await this.requireMember(workspaceId, userId, true, transaction);
      await this.workspaces.updateById(
        workspaceId,
        {
          ...data,
          ...(data.name ? {name: data.name.trim()} : {}),
          updatedAt: new Date(),
        },
        {transaction},
      );

      return this.requireMember(workspaceId, userId, false, transaction);
    });
  }

  async avatarUrl(workspaceId: string) {
    return (await this.workspaces.findById(workspaceId)).avatarUrl;
  }

  async replaceAvatar(
    workspaceId: string,
    userId: string,
    avatarUrl: string | null,
  ) {
    return this.locked(workspaceId, async transaction => {
      await this.requireMember(workspaceId, userId, true, transaction);
      const workspace = await this.workspaces.findById(workspaceId, undefined, {
        transaction,
      });
      const previousUrl = workspace.avatarUrl;

      await this.workspaces.updateById(
        workspaceId,
        {avatarUrl, updatedAt: new Date()},
        {transaction},
      );

      return previousUrl;
    });
  }

  async remove(workspaceId: string, userId: string) {
    await this.locked(workspaceId, async transaction => {
      await this.requireMember(workspaceId, userId, true, transaction);
      await this.workspaces.updateById(
        workspaceId,
        {deletedAt: new Date(), updatedAt: new Date()},
        {transaction},
      );
      await this.invitations.deleteAll({workspaceId}, {transaction});
    });
  }

  async listMembers(workspaceId: string, userId: string) {
    const workspace = await this.requireMember(workspaceId, userId);
    const members = await this.members.find({
      where: {workspaceId},
      order: ['joinedAt ASC'],
    });
    const users = await this.users.find({
      where: {id: {inq: members.map(member => member.userId)}},
    });

    return members.map(member => ({
      ...member.toJSON(),
      userId: member.userId,
      isOwner: member.userId === workspace.createdBy,
      username: users.find(user => user.id === member.userId)?.username,
    }));
  }

  async changeMember(
    workspaceId: string,
    actorId: string,
    userId: string,
    role?: WorkspaceRole,
  ) {
    await this.locked(workspaceId, async transaction => {
      const workspace = await this.requireMember(
        workspaceId,
        actorId,
        role !== undefined || actorId !== userId,
        transaction,
      );
      const member = await this.members.findOne(
        {where: {workspaceId, userId}},
        {transaction},
      );

      if (!member) throw new HttpErrors.NotFound('Member not found');

      if (userId === workspace.createdBy) {
        throw new HttpErrors.Conflict(
          'The workspace owner cannot leave, be removed or change roles',
        );
      }

      if (member.role === 'admin' && role !== 'admin') {
        const {count} = await this.members.count(
          {workspaceId, role: 'admin'},
          {transaction},
        );

        if (count === 1)
          throw new HttpErrors.Conflict(
            'The last admin cannot leave, be removed or demoted',
          );
      }

      if (role) await this.members.updateById(member.id, {role}, {transaction});
      else await this.members.deleteById(member.id, {transaction});
    });
  }

  async listInvitations(userId: string) {
    const user = await this.users.findById(userId);
    const invitations = await this.invitations.find({
      where: {email: {inq: user.verifiedEmails ?? []}},
      order: ['createdAt DESC'],
    });
    const workspaces = await this.workspaces.find({
      where: {
        id: {inq: invitations.map(item => item.workspaceId)},
        deletedAt: {eq: null as unknown as Date},
      },
    });

    return invitations
      .filter(item =>
        workspaces.some(workspace => workspace.id === item.workspaceId),
      )
      .map(item => ({
        ...item.toJSON(),
        workspaceName: workspaces.find(
          workspace => workspace.id === item.workspaceId,
        )!.name,
      }));
  }

  async workspaceInvitations(workspaceId: string, userId: string) {
    await this.requireMember(workspaceId, userId, true);

    return this.invitations.find({
      where: {workspaceId},
      order: ['createdAt DESC'],
    });
  }

  async invite(workspaceId: string, userId: string, email: string) {
    return this.locked(workspaceId, async transaction => {
      await this.requireMember(workspaceId, userId, true, transaction);
      const normalized = email.trim().toLowerCase();
      const existing = await this.invitations.findOne(
        {where: {workspaceId, email: normalized}},
        {transaction},
      );

      if (existing) return existing;

      return this.invitations.create(
        {workspaceId, email: normalized, invitedBy: userId},
        {transaction},
      );
    });
  }

  async respond(invitationId: string, userId: string, accept: boolean) {
    const invitation = await this.invitations.findOne({
      where: {id: invitationId},
    });

    if (!invitation) throw new HttpErrors.NotFound('Invitation not found');

    await this.locked(invitation.workspaceId, async transaction => {
      const current = await this.invitations.findOne(
        {where: {id: invitationId}},
        {transaction},
      );
      const user = await this.users.findById(userId, undefined, {transaction});
      const workspace = await this.workspaces.findOne(
        {
          where: {
            id: invitation.workspaceId,
            deletedAt: {eq: null as unknown as Date},
          },
        },
        {transaction},
      );

      if (
        !current ||
        !workspace ||
        !user.verifiedEmails?.includes(current.email)
      )
        throw new HttpErrors.NotFound('Invitation not found');

      if (accept) {
        const member = await this.members.findOne(
          {where: {workspaceId: current.workspaceId, userId}},
          {transaction},
        );

        if (!member)
          await this.members.create(
            {workspaceId: current.workspaceId, userId, role: 'member'},
            {transaction},
          );
      }

      await this.invitations.deleteById(invitationId, {transaction});
    });
  }

  async revoke(workspaceId: string, userId: string, invitationId: string) {
    await this.locked(workspaceId, async transaction => {
      await this.requireMember(workspaceId, userId, true, transaction);
      await this.invitations.deleteAll(
        {id: invitationId, workspaceId},
        {transaction},
      );
    });
  }

  async listEnvironments(workspaceId: string, userId: string) {
    await this.requireMember(workspaceId, userId);

    const environments = await this.environments.find({
      where: {workspaceId, deletedAt: {eq: null as unknown as Date}},
      order: ['createdAt ASC'],
    });
    const repositories = (await this.environments.execute(
      'SELECT id, full_name AS "fullName", default_environment_id AS "defaultEnvironmentId" FROM github.repository WHERE workspace_id = $1 AND disconnected_at IS NULL',
      [workspaceId],
    )) as {id: string; fullName: string; defaultEnvironmentId: string | null}[];

    return environments.map(environment => ({
      ...environment.toJSON(),
      repositoryName:
        repositories.find(item => item.id === environment.repositoryId)
          ?.fullName ?? null,
      isDefault: repositories.some(
        item => item.defaultEnvironmentId === environment.id,
      ),
    }));
  }

  async environment(workspaceId: string, userId: string, id: string) {
    await this.requireMember(workspaceId, userId);
    const environment = await this.environments.findOne({
      where: {id, workspaceId, deletedAt: {eq: null as unknown as Date}},
    });

    if (!environment) throw new HttpErrors.NotFound('Environment not found');

    try {
      return {
        ...environment.toJSON(),
        id: environment.id,
        name: environment.name,
        baseUrl: environmentTarget(environment),
      };
    } catch {
      throw new HttpErrors.UnprocessableEntity(
        'This environment needs a concrete base URL before a test can start',
      );
    }
  }

  async saveEnvironment(
    workspaceId: string,
    userId: string,
    data: {
      name: string;
      baseUrl?: string | null;
      repositoryId?: string | null;
      allowedOrigins?: string[];
    },
    id?: string,
  ) {
    let baseUrl: string | null = null;
    let origins: string[] | undefined;

    try {
      if (data.baseUrl) baseUrl = approvedUrl(data.baseUrl, allowedOrigins());
      if (data.allowedOrigins)
        origins = [
          ...new Set(data.allowedOrigins.map(normalizeEnvironmentOrigin)),
        ];
    } catch (error) {
      throw new HttpErrors.BadRequest(
        `Invalid environment URL configuration: ${(error as Error).message}`,
      );
    }

    return this.locked(workspaceId, async transaction => {
      await this.requireMember(workspaceId, userId, true, transaction);
      const options = {transaction};
      const existing = id
        ? await this.environments.findOne(
            {
              where: {
                id,
                workspaceId,
                deletedAt: {eq: null as unknown as Date},
              },
            },
            options,
          )
        : null;
      if (id && !existing)
        throw new HttpErrors.NotFound('Environment not found');
      const repositoryId =
        data.repositoryId === undefined
          ? existing?.repositoryId
          : data.repositoryId;
      const allowed = origins ?? existing?.allowedOrigins ?? [];

      if (!baseUrl && !allowed.length)
        throw new HttpErrors.BadRequest(
          'Provide a base URL or at least one allowed origin',
        );
      if (repositoryId) {
        const linked = (await this.environments.execute(
          `SELECT id FROM github.repository WHERE id = $1 AND workspace_id = $2 AND disconnected_at IS NULL`,
          [repositoryId, workspaceId],
          options,
        )) as {id: string}[];
        if (!linked.length)
          throw new HttpErrors.NotFound('Repository not found');
      }
      if (id) {
        const defaults = (await this.environments.execute(
          'SELECT id FROM github.repository WHERE default_environment_id = $1',
          [id],
          options,
        )) as {id: string}[];
        if (defaults.length && (!baseUrl || repositoryId !== defaults[0].id))
          throw new HttpErrors.Conflict(
            'Choose another default environment before removing its base URL or changing its repository',
          );
        if (existing?.repositoryId && repositoryId !== existing.repositoryId) {
          const history = (await this.environments.execute(
            'SELECT id FROM execution.task WHERE environment_id = $1 LIMIT 1',
            [id],
            options,
          )) as {id: string}[];
          if (history.length)
            throw new HttpErrors.Conflict(
              'An environment with task history cannot move to another repository',
            );
        }
      }
      const values = {
        name: data.name.trim(),
        baseUrl,
        repositoryId: repositoryId ?? (null as unknown as string),
        allowedOrigins: allowed,
      };

      if (id) {
        const {count} = await this.environments.updateAll(
          values,
          {id, workspaceId, deletedAt: {eq: null as unknown as Date}},
          {transaction},
        );

        if (!count) throw new HttpErrors.NotFound('Environment not found');

        return this.environments.findById(id, undefined, {transaction});
      }

      return this.environments.create({...values, workspaceId}, {transaction});
    });
  }

  async removeEnvironment(workspaceId: string, userId: string, id: string) {
    await this.locked(workspaceId, async transaction => {
      await this.requireMember(workspaceId, userId, true, transaction);
      const defaults = (await this.environments.execute(
        'SELECT id FROM github.repository WHERE workspace_id = $1 AND default_environment_id = $2 AND disconnected_at IS NULL',
        [workspaceId, id],
        {transaction},
      )) as {id: string}[];

      if (defaults.length)
        throw new HttpErrors.Conflict(
          'Choose another default test environment before deleting this environment',
        );

      const {count} = await this.environments.updateAll(
        {deletedAt: new Date()},
        {id, workspaceId, deletedAt: {eq: null as unknown as Date}},
        {transaction},
      );

      if (!count) throw new HttpErrors.NotFound('Environment not found');
    });
  }
}
