import {Entity, model, property} from '@loopback/repository';

@model({settings: {postgresql: {schema: 'github', table: 'command_reply'}}})
export class CommandReply extends Entity {
  @property({
    type: 'string',
    id: true,
    generated: true,
    postgresql: {dataType: 'uuid'},
  })
  id!: string;

  @property({
    type: 'number',
    postgresql: {columnName: 'source_comment_id', dataType: 'bigint'},
  })
  sourceCommentId!: number;

  @property({
    type: 'string',
    postgresql: {columnName: 'repository_id', dataType: 'uuid'},
  })
  repositoryId!: string;

  @property({type: 'number'})
  number!: number;

  @property({type: 'string'})
  body!: string;

  @property({type: 'string'})
  status!: 'pending' | 'sending' | 'sent' | 'failed';

  @property({type: 'number'})
  attempts!: number;

  @property({
    type: 'number',
    postgresql: {columnName: 'comment_id', dataType: 'bigint'},
  })
  commentId?: number;

  @property({
    type: 'string',
    postgresql: {columnName: 'lease_token', dataType: 'uuid'},
  })
  leaseToken?: string | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'lease_expires_at', dataType: 'timestamptz'},
  })
  leaseExpiresAt?: Date | null;

  @property({type: 'string'})
  error?: string;

  constructor(data?: Partial<CommandReply>) {
    super(data);
  }
}
