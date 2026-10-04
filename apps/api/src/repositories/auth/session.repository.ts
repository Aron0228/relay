import {
  BelongsToAccessor,
  DefaultCrudRepository,
  repository,
} from '@loopback/repository';
import {Session, SessionRelations, User} from '../../models';
import {Getter, inject} from '@loopback/core';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {UserRepository} from './user.repository';

export const SESSION_REPOSITORY_BINDING_KEY = 'repositories.SessionRepository';

export class SessionRepository extends DefaultCrudRepository<
  Session,
  typeof Session.prototype.id,
  SessionRelations
> {
  public readonly user: BelongsToAccessor<User, typeof User.prototype.id>;

  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY)
    postgresDataSource: PostgresDataSource,
    @repository.getter(UserRepository)
    userRepositoryGetter: Getter<UserRepository>,
  ) {
    super(Session, postgresDataSource);

    this.user = this.createBelongsToAccessorFor('user', userRepositoryGetter);
  }
}
