import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {EnvironmentKnowledge} from '../../models/knowledge/environment-knowledge.model';

export class EnvironmentKnowledgeRepository extends DefaultTransactionalRepository<
  EnvironmentKnowledge,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(EnvironmentKnowledge, dataSource);
  }
}
