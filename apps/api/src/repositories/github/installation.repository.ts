import {GithubInstallation, Workspace} from '../../models';
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

export const GITHUB_INSTALLATION_REPOSITORY_BINDING_KEY =
  'repositories.GithubInstallationRepository';

export class GithubInstallationRepository extends DefaultTransactionalRepository<
  GithubInstallation,
  string
> {
  readonly workspace: BelongsToAccessor<Workspace, string>;

  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
    @repository.getter(WorkspaceRepository)
    workspaceGetter: Getter<WorkspaceRepository>,
  ) {
    super(GithubInstallation, dataSource);

    this.workspace = this.createBelongsToAccessorFor(
      'workspace',
      workspaceGetter,
    );
  }
}
