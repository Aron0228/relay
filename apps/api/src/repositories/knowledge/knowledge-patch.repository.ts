import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {KnowledgePatch} from '../../models/knowledge/knowledge-patch.model';

export class KnowledgePatchRepository extends DefaultTransactionalRepository<
  KnowledgePatch,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(KnowledgePatch, dataSource);
  }
}
