import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {CommandReply} from '../../models';

export const COMMAND_REPLY_REPOSITORY_BINDING_KEY =
  'repositories.CommandReplyRepository';

export class CommandReplyRepository extends DefaultCrudRepository<
  CommandReply,
  string
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(CommandReply, dataSource);
  }
}
