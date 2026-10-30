import {belongsTo, Entity, model, property} from '@loopback/repository';
import {GithubRepository} from './repository.model';

@model({
  settings: {forceId: true, postgresql: {schema: 'github', table: 'issue'}},
})
export class GithubIssue extends Entity {
  @property({type: 'string', id: true, postgresql: {dataType: 'uuid'}})
  id!: string;

  @property({
    type: 'number',
    required: true,
    postgresql: {columnName: 'github_id', dataType: 'bigint'},
  })
  githubId!: number;

  @belongsTo(
    () => GithubRepository,
    {name: 'repository'},
    {
      type: 'string',
      required: true,
      postgresql: {columnName: 'repository_id', dataType: 'uuid'},
    },
  )
  repositoryId!: string;

  @property({type: 'number', required: true, postgresql: {dataType: 'integer'}})
  number!: number;

  @property({type: 'string', required: true, postgresql: {dataType: 'text'}})
  url!: string;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt?: Date;

  constructor(data?: Partial<GithubIssue>) {
    super(data);
  }
}
