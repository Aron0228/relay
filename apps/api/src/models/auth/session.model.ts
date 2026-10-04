import {belongsTo, Entity, model, property} from '@loopback/repository';
import {securityId, UserProfile} from '@loopback/security';
import {User, UserWithRelations} from './user.model';

@model({
  settings: {
    forceId: true,
    postgresql: {schema: 'auth', table: 'session'},
  },
})
export class Session extends Entity {
  @property({
    type: 'string',
    id: true,
    postgresql: {dataType: 'uuid'},
  })
  id!: string;

  @belongsTo(
    () => User,
    {name: 'user'},
    {
      type: 'string',
      required: true,
      postgresql: {columnName: 'user_id', dataType: 'uuid'},
    },
  )
  userId!: string;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'token_hash', dataType: 'varchar', dataLength: 64},
    jsonSchema: {minLength: 64, maxLength: 64, pattern: '^[0-9a-f]{64}$'},
  })
  tokenHash!: string;

  @property({
    type: 'object',
    required: true,
    postgresql: {columnName: 'user_profile', dataType: 'jsonb'},
  })
  userProfile!: UserProfile;

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

  @property({
    type: 'date',
    required: true,
    postgresql: {columnName: 'absolute_expires_at', dataType: 'timestamptz'},
  })
  absoluteExpiresAt!: Date;

  @property({
    type: 'date',
    postgresql: {columnName: 'revoked_at', dataType: 'timestamptz'},
    jsonSchema: {nullable: true},
  })
  revokedAt?: Date | null;

  constructor(data?: Partial<Session>) {
    super(data);

    if (this.userProfile && this.userId) {
      this.userProfile = {...this.userProfile, [securityId]: this.userId};
    }
  }
}

export interface SessionRelations {
  user?: UserWithRelations;
}

export type SessionWithRelations = Session & SessionRelations;
