import {Entity, model, property} from '@loopback/repository';

@model({
  settings: {
    forceId: true,
    postgresql: {schema: 'auth', table: 'user'},
  },
})
export class User extends Entity {
  @property({
    type: 'string',
    id: true,
    postgresql: {dataType: 'uuid'},
  })
  id!: string;

  @property({
    type: 'number',
    required: true,
    postgresql: {columnName: 'github_id', dataType: 'bigint'},
  })
  githubId!: number;

  @property({
    type: 'string',
    required: true,
    postgresql: {dataType: 'text'},
  })
  username!: string;

  constructor(data?: Partial<User>) {
    super(data);
  }
}

// No relations are defined yet.
export type UserRelations = object;

export type UserWithRelations = User & UserRelations;
