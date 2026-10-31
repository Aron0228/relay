import {BindingScope, injectable, service} from '@loopback/core';
import {IsolationLevel, repository, Transaction} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {allowedOrigins, approvedUrl} from '../ai/config';
import {
  EnvironmentRepository,
  GithubInstallationRepository,
  GithubRepositoryRepository,
  TaskRepository,
  UserRepository,
} from '../repositories';
import {GithubAppService} from './github-app.service';
import {WorkspaceService} from './workspace.service';

export const GITHUB_CONNECTION_SERVICE_BINDING_KEY =
  'services.GithubConnectionService';

@injectable({scope: BindingScope.SINGLETON})
export class GithubConnectionService {
  constructor(
    @service(WorkspaceService) private workspaces: WorkspaceService,
    @service(GithubAppService) private github: GithubAppService,
    @repository(GithubInstallationRepository)
    private installations: GithubInstallationRepository,
    @repository(GithubRepositoryRepository)
    private repositories: GithubRepositoryRepository,
    @repository(EnvironmentRepository)
    private environments: EnvironmentRepository,
    @repository(UserRepository) private users: UserRepository,
    @repository(TaskRepository) private tasks: TaskRepository,
  ) {}

  async list(workspaceId: string, userId: string) {
    await this.workspaces.requireMember(workspaceId, userId);
    const installations = await this.installations.find({
      where: {workspaceId, disconnectedAt: {eq: null as unknown as Date}},
    });
    const repositories = await this.repositories.find({
      where: {workspaceId, disconnectedAt: {eq: null as unknown as Date}},
    });

    return {
      installations: installations.map(item => ({
        id: item.id,
        githubId: Number(item.githubId),
        accountLogin: item.accountLogin,
      })),
      repositories: repositories.map(item => ({
        id: item.id,
        githubId: Number(item.githubId),
        installationId: item.installationId,
        fullName: item.fullName,
        defaultEnvironmentId: item.defaultEnvironmentId,
      })),
    };
  }

  async installationUrl(
    workspaceId: string,
    userId: string,
    installationId?: string,
  ) {
    await this.workspaces.requireMember(workspaceId, userId, true);

    if (!installationId) return {url: await this.github.installationUrl()};

    const installation = await this.installations.findOne({
      where: {
        id: installationId,
        workspaceId,
        disconnectedAt: {eq: null as unknown as Date},
      },
    });

    if (!installation)
      throw new HttpErrors.NotFound('GitHub connection not found');

    return {
      url: await this.github.installationSettingsUrl(
        Number(installation.githubId),
      ),
    };
  }

  async available(workspaceId: string, userId: string) {
    await this.workspaces.requireMember(workspaceId, userId, true);

    return this.github.managedInstallations(await this.users.findById(userId));
  }

  private async mutate<T>(
    workspaceId: string,
    userId: string,
    action: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    const transaction = await this.installations.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );

    try {
      await this.installations.execute(
        'SELECT id FROM auth.workspace WHERE id = $1 FOR UPDATE',
        [workspaceId],
        {transaction},
      );
      await this.workspaces.requireMember(
        workspaceId,
        userId,
        true,
        transaction,
      );
      const result = await action(transaction);
      await transaction.commit();

      return result;
    } catch (error) {
      await transaction.rollback();
      if ((error as {code?: string}).code === '23505')
        throw new HttpErrors.Conflict(
          'This GitHub resource is already connected',
        );
      throw error;
    }
  }

  async connect(workspaceId: string, userId: string, githubId: number) {
    await this.workspaces.requireMember(workspaceId, userId, true);
    const remote = await this.github.requireManager(
      githubId,
      await this.users.findById(userId),
    );

    return this.mutate(workspaceId, userId, async transaction => {
      const existing = await this.installations.findOne(
        {where: {githubId}},
        {transaction},
      );

      if (existing && existing.workspaceId !== workspaceId)
        throw new HttpErrors.Conflict(
          'This installation belongs to another workspace',
        );

      const data = {
        accountLogin: remote.account.login,
        connectedBy: userId,
        disconnectedAt: null,
      };

      if (existing) {
        await this.installations.updateById(existing.id, data, {transaction});

        return {id: existing.id};
      }

      const installation = await this.installations.create(
        {githubId, workspaceId, ...data},
        {transaction},
      );

      return {id: installation.id};
    });
  }

  private async activeInstallation(workspaceId: string, id: string) {
    const installation = await this.installations.findOne({
      where: {id, workspaceId, disconnectedAt: {eq: null as unknown as Date}},
    });

    if (!installation?.connectedBy)
      throw new HttpErrors.NotFound('GitHub connection not found');

    return installation;
  }

  async availableRepositories(
    workspaceId: string,
    userId: string,
    installationId: string,
  ) {
    await this.workspaces.requireMember(workspaceId, userId, true);
    const installation = await this.activeInstallation(
      workspaceId,
      installationId,
    );
    await this.github.requireManager(
      Number(installation.githubId),
      await this.users.findById(userId),
    );

    return (await this.github.repositories(Number(installation.githubId))).map(
      repo => ({githubId: repo.id, fullName: repo.full_name}),
    );
  }

  private async environment(
    workspaceId: string,
    id: string,
    transaction?: Transaction,
  ) {
    const environment = await this.environments.findOne(
      {where: {id, workspaceId, deletedAt: {eq: null as unknown as Date}}},
      {transaction},
    );

    if (!environment) throw new HttpErrors.NotFound('Environment not found');

    try {
      return {
        ...environment.toJSON(),
        id: environment.id,
        baseUrl: approvedUrl(environment.baseUrl, allowedOrigins()),
      };
    } catch {
      throw new HttpErrors.UnprocessableEntity(
        'The environment URL is not an approved test target',
      );
    }
  }

  async saveRepository(
    workspaceId: string,
    userId: string,
    installationId: string,
    githubId: number,
    environmentId: string,
  ) {
    await this.workspaces.requireMember(workspaceId, userId, true);
    const installation = await this.activeInstallation(
      workspaceId,
      installationId,
    );
    await this.github.requireManager(
      Number(installation.githubId),
      await this.users.findById(userId),
    );
    const remote = await this.github.requireRepository(
      Number(installation.githubId),
      githubId,
    );

    return this.mutate(workspaceId, userId, async transaction => {
      await this.activeInstallation(workspaceId, installationId);
      await this.environment(workspaceId, environmentId, transaction);
      const existing = await this.repositories.findOne(
        {where: {githubId}},
        {transaction},
      );

      if (
        existing &&
        (existing.workspaceId !== workspaceId ||
          existing.installationId !== installationId)
      )
        throw new HttpErrors.Conflict(
          'This repository belongs to another connection',
        );

      const data = {
        fullName: remote.full_name,
        defaultEnvironmentId: environmentId,
        disconnectedAt: null,
      };

      if (existing) {
        await this.repositories.updateById(existing.id, data, {transaction});

        return {id: existing.id};
      }

      const repo = await this.repositories.create(
        {githubId, workspaceId, installationId, ...data},
        {transaction},
      );

      return {id: repo.id};
    });
  }

  async disconnect(
    workspaceId: string,
    userId: string,
    id: string,
    installation: boolean,
  ) {
    await this.mutate(workspaceId, userId, async transaction => {
      const store = installation ? this.installations : this.repositories;
      const item = await store.findOne(
        {where: {id, workspaceId}},
        {transaction},
      );

      if (!item) throw new HttpErrors.NotFound('GitHub connection not found');

      const disconnectedAt = new Date();
      await store.updateById(id, {disconnectedAt}, {transaction});

      if (installation)
        await this.repositories.updateAll(
          {disconnectedAt},
          {installationId: id, workspaceId},
          {transaction},
        );
    });
  }

  async resolveTarget(
    repositoryId: string,
    workspaceId: string,
    environmentId?: string,
  ) {
    const repo = await this.repositories.findOne({
      where: {
        id: repositoryId,
        workspaceId,
        disconnectedAt: {eq: null as unknown as Date},
      },
    });

    if (!repo)
      throw new HttpErrors.NotFound('GitHub repository connection not found');

    const installation = await this.activeInstallation(
      workspaceId,
      repo.installationId,
    );
    await this.workspaces.requireMember(
      workspaceId,
      installation.connectedBy!,
      true,
    );
    await this.github.requireManager(
      Number(installation.githubId),
      await this.users.findById(installation.connectedBy!),
    );
    const remote = await this.github.requireRepository(
      Number(installation.githubId),
      Number(repo.githubId),
    );
    const environment = await this.environment(
      workspaceId,
      environmentId ?? repo.defaultEnvironmentId,
    );

    const currentRepository = await this.repositories.findOne({
      where: {
        id: repo.id,
        workspaceId,
        installationId: installation.id,
        disconnectedAt: {eq: null as unknown as Date},
      },
    });
    const currentInstallation = await this.activeInstallation(
      workspaceId,
      installation.id,
    );

    if (
      !currentRepository ||
      currentInstallation.connectedBy !== installation.connectedBy
    ) {
      throw new HttpErrors.Forbidden(
        'GitHub connection changed during access verification',
      );
    }

    await this.workspaces.requireMember(
      workspaceId,
      installation.connectedBy!,
      true,
    );

    return {
      repository: repo,
      installation,
      environment,
      fullName: remote.full_name,
      targetUrl: environment.baseUrl,
    };
  }

  async targetForTask(
    taskId: string,
    workspaceId: string,
    environmentId: string,
  ) {
    const task = await this.tasks.findOne({
      where: {id: taskId, workspaceId, environmentId},
    });

    if (!task) throw new HttpErrors.NotFound('Task not found');

    return this.resolveTarget(task.repositoryId, workspaceId, environmentId);
  }
}
