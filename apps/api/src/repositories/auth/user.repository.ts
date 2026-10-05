import {DefaultCrudRepository} from '@loopback/repository';
import {User, UserRelations} from '../../models';
import {inject} from '@loopback/core';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';

export const USER_REPOSITORY_BINDING_KEY = 'repositories.UserRepository';

export class UserRepository extends DefaultCrudRepository<
  User,
  typeof User.prototype.id,
  UserRelations
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY)
    postgresDataSource: PostgresDataSource,
  ) {
    super(User, postgresDataSource);
  }

  async resolveGithubUser(githubId: number, username: string): Promise<User> {
    const rows = (await this.dataSource.execute(
      `INSERT INTO auth."user" (github_id, username) VALUES ($1, $2)
       ON CONFLICT (github_id) DO UPDATE SET username = EXCLUDED.username
       RETURNING id, github_id AS "githubId", username`,
      [githubId, username],
    )) as User[];

    return new User(rows[0]);
  }
}
