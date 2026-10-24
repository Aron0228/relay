import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {Run} from '../../models';

export const RUN_REPOSITORY_BINDING_KEY = 'repositories.RunRepository';

export class RunRepository extends DefaultTransactionalRepository<
  Run,
  typeof Run.prototype.id
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(Run, dataSource);
  }
}
