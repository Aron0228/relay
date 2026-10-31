import {GithubIssue, GithubRepository} from '../../models';
import {Getter, inject} from '@loopback/core';
import {
  BelongsToAccessor,
  DefaultTransactionalRepository,
  repository,
  Transaction,
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
  async snapshotSource(
    githubId: number,
    repositoryId: string,
    number: number,
    url: string,
    transaction: Transaction,
  ): Promise<GithubIssue | null> {
    const rows = (await this.dataSource.execute(
      `INSERT INTO github.issue AS existing (github_id, repository_id, number, url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (github_id) DO UPDATE SET url = EXCLUDED.url
       WHERE existing.repository_id = EXCLUDED.repository_id AND existing.number = EXCLUDED.number
       RETURNING id, github_id AS "githubId", repository_id AS "repositoryId", number, url`,
      [githubId, repositoryId, number, url],
      {transaction},
    )) as Partial<GithubIssue>[];

    return rows.length ? new GithubIssue(rows[0]) : null;
  }
}
