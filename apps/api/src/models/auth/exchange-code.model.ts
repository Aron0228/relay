import {Entity, model, property} from '@loopback/repository';

import {OAuthClientType, OAUTH_CLIENT_TYPE} from './oauth-transaction.model';

@model({
  settings: {
    forceId: false,
    postgresql: {schema: 'auth', table: 'exchange_code'},
  },
})
export class ExchangeCode extends Entity {
  @property({
    type: 'string',
    id: true,
    required: true,
    postgresql: {columnName: 'code_hash', dataType: 'text'},
  })
  codeHash!: string;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'user_id', dataType: 'uuid'},
  })
  userId!: string;

  @property({
    type: 'string',
    required: true,
    jsonSchema: {enum: Object.values(OAUTH_CLIENT_TYPE)},
    postgresql: {columnName: 'client_type', dataType: 'text'},
  })
  clientType!: OAuthClientType;

  @property({
    type: 'date',
    required: true,
    defaultFn: 'now',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt!: Date;

  @property({
    type: 'date',
    required: true,
    postgresql: {columnName: 'expires_at', dataType: 'timestamptz'},
  })
  expiresAt!: Date;

  constructor(data?: Partial<ExchangeCode>) {
    super(data);
  }
}
