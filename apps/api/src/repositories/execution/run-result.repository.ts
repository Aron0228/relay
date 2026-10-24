import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {RunResult} from '../../models';

export const RUN_RESULT_REPOSITORY_BINDING_KEY =
  'repositories.RunResultRepository';

export class RunResultRepository extends DefaultCrudRepository<
  RunResult,
  typeof RunResult.prototype.id
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(RunResult, dataSource);
  }
}
