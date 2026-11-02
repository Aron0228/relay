import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {StageRequest} from '../../models';

export const STAGE_REQUEST_REPOSITORY_BINDING_KEY =
  'repositories.StageRequestRepository';

export class StageRequestRepository extends DefaultCrudRepository<
  StageRequest,
  typeof StageRequest.prototype.id
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(StageRequest, dataSource);
  }
}
