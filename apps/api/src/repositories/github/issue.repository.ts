import {GithubIssue, GithubRepository} from '../../models';
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
import {GithubRepositoryRepository} from './repository.repository';

export const GITHUB_ISSUE_REPOSITORY_BINDING_KEY =
  'repositories.GithubIssueRepository';

export class GithubIssueRepository extends DefaultTransactionalRepository<
  GithubIssue,
  string
> {
  readonly repository: BelongsToAccessor<GithubRepository, string>;

  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
    @repository.getter(GithubRepositoryRepository)
    repositoryGetter: Getter<GithubRepositoryRepository>,
  ) {
    super(GithubIssue, dataSource);

    this.repository = this.createBelongsToAccessorFor(
      'repository',
      repositoryGetter,
    );
  }
}
