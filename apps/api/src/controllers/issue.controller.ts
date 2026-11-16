import {authorizeIam, IAM_ACTION, IAM_RESOURCE_TYPE} from '../authorization';
import {authenticate} from '@loopback/authentication';
import {inject, service} from '@loopback/core';
import {get, param, post, Response, RestBindings} from '@loopback/rest';
import {SecurityBindings, securityId, UserProfile} from '@loopback/security';
import {IssueQueryService, WorkerService} from '../services';

@authenticate('session')
export class IssueController {
  constructor(
    @service(IssueQueryService) private issues: IssueQueryService,
    @service(WorkerService) private workers: WorkerService,
    @inject(RestBindings.Http.RESPONSE) private response: Response,
  ) {}

  @authorizeIam(IAM_ACTION.IssuesList, IAM_RESOURCE_TYPE.Workspace)
  @get('/api/issues')
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
    return this.issues.list(workspaceId, user[securityId], search, before);
  }

  @authorizeIam(IAM_ACTION.IssueRead, IAM_RESOURCE_TYPE.Issue)
  @get('/api/issues/{id}')
  async get(
    @inject(SecurityBindings.USER) user: UserProfile,
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.query.string('taskId', {schema: {format: 'uuid'}}) taskId?: string,
  ) {
    this.response.setHeader('Cache-Control', 'no-store');
    return this.issues.get(id, user[securityId], taskId);
  }

  @authorizeIam(IAM_ACTION.TaskCancel, IAM_RESOURCE_TYPE.Task)
  @post('/api/tasks/{id}/cancel')
  async cancel(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
  ): Promise<void> {
    await this.workers.cancelTask(id);
    this.response.status(204);
  }
}
