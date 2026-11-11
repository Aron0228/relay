import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {RunPatch} from '../../models/knowledge/run-patch.model';

export class RunPatchRepository extends DefaultTransactionalRepository<
  RunPatch,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(RunPatch, dataSource);
  }
}
