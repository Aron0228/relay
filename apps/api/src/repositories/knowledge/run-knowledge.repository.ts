import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {RunKnowledge} from '../../models/knowledge/run-knowledge.model';

export class RunKnowledgeRepository extends DefaultTransactionalRepository<
  RunKnowledge,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(RunKnowledge, dataSource);
  }
}
