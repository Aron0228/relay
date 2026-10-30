import {
  Task,
  Workspace,
  Environment,
  GithubRepository,
  GithubIssue,
  User,
} from '../../models';
import {Getter, inject} from '@loopback/core';
import {
  BelongsToAccessor,
  DefaultTransactionalRepository,
  repository,
} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {WorkspaceRepository} from '../auth/workspace.repository';
import {EnvironmentRepository} from '../auth/environment.repository';
import {GithubRepositoryRepository} from '../github/repository.repository';
import {GithubIssueRepository} from '../github/issue.repository';
import {UserRepository} from '../auth/user.repository';

export const TASK_REPOSITORY_BINDING_KEY = 'repositories.TaskRepository';

export class TaskRepository extends DefaultTransactionalRepository<
  Task,
  string
> {
  readonly workspace: BelongsToAccessor<Workspace, string>;
  readonly environment: BelongsToAccessor<Environment, string>;
  readonly repository: BelongsToAccessor<GithubRepository, string>;
  readonly issue: BelongsToAccessor<GithubIssue, string>;
  readonly requester: BelongsToAccessor<User, string>;

  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
    @repository.getter(WorkspaceRepository)
    workspaceGetter: Getter<WorkspaceRepository>,
    @repository.getter(EnvironmentRepository)
    environmentGetter: Getter<EnvironmentRepository>,
    @repository.getter(GithubRepositoryRepository)
    repositoryGetter: Getter<GithubRepositoryRepository>,
    @repository.getter(GithubIssueRepository)
    issueGetter: Getter<GithubIssueRepository>,
    @repository.getter(UserRepository) requesterGetter: Getter<UserRepository>,
  ) {
    super(Task, dataSource);

    this.workspace = this.createBelongsToAccessorFor(
      'workspace',
      workspaceGetter,
    );
    this.environment = this.createBelongsToAccessorFor(
      'environment',
      environmentGetter,
    );
    this.repository = this.createBelongsToAccessorFor(
      'repository',
      repositoryGetter,
    );
    this.issue = this.createBelongsToAccessorFor('issue', issueGetter);
    this.requester = this.createBelongsToAccessorFor(
      'requester',
      requesterGetter,
    );
  }
}
