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
import {Environment, GithubRepository} from '../../models';
import type {GithubRepositoryRepository} from '../github/repository.repository';

export const ENVIRONMENT_REPOSITORY_BINDING_KEY =
  'repositories.EnvironmentRepository';

export class EnvironmentRepository extends DefaultTransactionalRepository<
  Environment,
  string
> {
  readonly repository: BelongsToAccessor<GithubRepository, string>;

  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) datasource: PostgresDataSource,
    @repository.getter('GithubRepositoryRepository')
    repositoryGetter: Getter<GithubRepositoryRepository>,
  ) {
    super(Environment, datasource);

    this.repository = this.createBelongsToAccessorFor(
      'repository',
      repositoryGetter,
    );
  }
}
