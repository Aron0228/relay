import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {Environment} from '../../models';

export const ENVIRONMENT_REPOSITORY_BINDING_KEY =
  'repositories.EnvironmentRepository';

export class EnvironmentRepository extends DefaultTransactionalRepository<
  Environment,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) datasource: PostgresDataSource,
  ) {
    super(Environment, datasource);
  }
}
