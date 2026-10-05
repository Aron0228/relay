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
}
