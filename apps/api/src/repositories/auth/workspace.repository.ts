import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {Workspace} from '../../models';

export const WORKSPACE_REPOSITORY_BINDING_KEY =
  'repositories.WorkspaceRepository';

export class WorkspaceRepository extends DefaultTransactionalRepository<
  Workspace,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) datasource: PostgresDataSource,
  ) {
    super(Workspace, datasource);
  }
}
