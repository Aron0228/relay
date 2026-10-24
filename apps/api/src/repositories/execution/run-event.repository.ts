import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {RunEvent} from '../../models';

export const RUN_EVENT_REPOSITORY_BINDING_KEY =
  'repositories.RunEventRepository';

export class RunEventRepository extends DefaultCrudRepository<
  RunEvent,
  typeof RunEvent.prototype.id
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(RunEvent, dataSource);
  }
}
