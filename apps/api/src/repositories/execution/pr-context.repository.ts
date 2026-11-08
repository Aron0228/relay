import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {PrContext} from '../../models';

export const PR_CONTEXT_REPOSITORY_BINDING_KEY =
  'repositories.PrContextRepository';

export class PrContextRepository extends DefaultTransactionalRepository<
  PrContext,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(PrContext, dataSource);
  }
}
