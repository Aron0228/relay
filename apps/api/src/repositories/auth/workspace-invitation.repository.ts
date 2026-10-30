import {inject} from '@loopback/core';
import {DefaultTransactionalRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {WorkspaceInvitation} from '../../models';

export const WORKSPACE_INVITATION_REPOSITORY_BINDING_KEY =
  'repositories.WorkspaceInvitationRepository';

export class WorkspaceInvitationRepository extends DefaultTransactionalRepository<
  WorkspaceInvitation,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) datasource: PostgresDataSource,
  ) {
    super(WorkspaceInvitation, datasource);
  }
}
