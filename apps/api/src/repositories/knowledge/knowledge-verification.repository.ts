import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {KnowledgeVerification} from '../../models/knowledge/knowledge-verification.model';

export class KnowledgeVerificationRepository extends DefaultTransactionalRepository<
  KnowledgeVerification,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(KnowledgeVerification, dataSource);
  }
}
