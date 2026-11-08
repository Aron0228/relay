import {
  GithubRepository,
  Workspace,
  GithubInstallation,
  Environment,
} from '../../models';
import {Getter, inject} from '@loopback/core';
import {
  BelongsToAccessor,
  HasManyRepositoryFactory,
  DefaultTransactionalRepository,
  repository,
} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {WorkspaceRepository} from '../auth/workspace.repository';
import {GithubInstallationRepository} from './installation.repository';
import {EnvironmentRepository} from '../auth/environment.repository';

export const GITHUB_REPOSITORY_REPOSITORY_BINDING_KEY =
  'repositories.GithubRepositoryRepository';

export class GithubRepositoryRepository extends DefaultTransactionalRepository<
  GithubRepository,
  string
> {
  readonly environments: HasManyRepositoryFactory<Environment, string>;
  readonly workspace: BelongsToAccessor<Workspace, string>;
  readonly installation: BelongsToAccessor<GithubInstallation, string>;
  readonly defaultEnvironment: BelongsToAccessor<Environment, string>;

  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
    @repository.getter(WorkspaceRepository)
    workspaceGetter: Getter<WorkspaceRepository>,
    @repository.getter(GithubInstallationRepository)
    installationGetter: Getter<GithubInstallationRepository>,
    @repository.getter(EnvironmentRepository)
    defaultEnvironmentGetter: Getter<EnvironmentRepository>,
  ) {
    super(GithubRepository, dataSource);

    this.workspace = this.createBelongsToAccessorFor(
      'workspace',
      workspaceGetter,
    );
    this.installation = this.createBelongsToAccessorFor(
      'installation',
      installationGetter,
    );
    this.environments = this.createHasManyRepositoryFactoryFor(
      'environments',
      defaultEnvironmentGetter,
    );

    this.defaultEnvironment = this.createBelongsToAccessorFor(
      'defaultEnvironment',
      defaultEnvironmentGetter,
    );
  }
}
