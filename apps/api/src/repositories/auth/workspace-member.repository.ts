import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {WorkspaceMember} from '../../models';

export const WORKSPACE_MEMBER_REPOSITORY_BINDING_KEY =
  'repositories.WorkspaceMemberRepository';

export class WorkspaceMemberRepository extends DefaultTransactionalRepository<
  WorkspaceMember,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) datasource: PostgresDataSource,
  ) {
    super(WorkspaceMember, datasource);
  }
}
