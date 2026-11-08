import {authenticate} from '@loopback/authentication';
import {inject, service} from '@loopback/core';
import {get, param, Response, RestBindings} from '@loopback/rest';
import {SecurityBindings, securityId, UserProfile} from '@loopback/security';
import {IssueQueryService} from '../services';

@authenticate('session')
export class PullRequestController {
  constructor(
    @service(IssueQueryService) private investigations: IssueQueryService,
    @inject(RestBindings.Http.RESPONSE) private response: Response,
  ) {}

  @get('/api/pull-requests')
  async list(
    @inject(SecurityBindings.USER) user: UserProfile,
    @param.query.string('workspaceId', {
      required: true,
      schema: {format: 'uuid'},
    })
    workspaceId: string,
    @param.query.string('search', {schema: {type: 'string', maxLength: 200}})
    search: string = '',
    @param.query.string('before', {schema: {format: 'uuid'}}) before?: string,
  ) {
    this.response.setHeader('Cache-Control', 'no-store');
    return this.investigations.list(
      workspaceId,
      user[securityId],
      search,
      before,
      true,
    );
  }

  @get('/api/pull-requests/{id}')
  async get(
    @inject(SecurityBindings.USER) user: UserProfile,
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.query.string('taskId', {schema: {format: 'uuid'}}) taskId?: string,
  ) {
    this.response.setHeader('Cache-Control', 'no-store');
    return this.investigations.get(id, user[securityId], taskId, true);
  }
}
