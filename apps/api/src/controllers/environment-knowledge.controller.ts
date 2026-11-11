import {authenticate} from '@loopback/authentication';
import {inject, service} from '@loopback/core';
import {get, param, patch, requestBody, HttpErrors} from '@loopback/rest';
import {SecurityBindings, securityId, UserProfile} from '@loopback/security';
import {z} from 'zod';
import {EnvironmentKnowledgeService} from '../services/environment-knowledge.service';

@authenticate('session')
export class EnvironmentKnowledgeController {
  constructor(
    @service(EnvironmentKnowledgeService)
    private knowledge: EnvironmentKnowledgeService,
  ) {}

  @get('/api/workspaces/{workspaceId}/environments/{environmentId}/knowledge')
  list(
    @param.path.string('workspaceId', {schema: {format: 'uuid'}})
    workspaceId: string,
    @param.path.string('environmentId', {schema: {format: 'uuid'}})
    environmentId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @param.query.string('search', {schema: {minLength: 0, maxLength: 500}})
    search = '',
    @param.query.string('type', {
      schema: {enum: ['navigation', 'workflow', 'precondition', 'behavior']},
    })
    type?: string,
    @param.query.string('status', {
      schema: {enum: ['unverified', 'verified', 'retired', 'stale']},
    })
    status?: string,
    @param.query.number('offset', {schema: {type: 'integer', minimum: 0}})
    offset = 0,
  ) {
    return this.knowledge.list(
      workspaceId,
      environmentId,
      user[securityId],
      search,
      type,
      status,
      offset,
    );
  }

  @get(
    '/api/workspaces/{workspaceId}/environments/{environmentId}/knowledge-patches',
  )
  history(
    @param.path.string('workspaceId', {schema: {format: 'uuid'}})
    workspaceId: string,
    @param.path.string('environmentId', {schema: {format: 'uuid'}})
    environmentId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @param.query.number('offset', {schema: {type: 'integer', minimum: 0}})
    offset = 0,
    @param.query.string('status', {
      schema: {enum: ['pending', 'accepted', 'rejected', 'conflict']},
    })
    status?: string,
    @param.query.string('result', {
      schema: {
        enum: ['unverified', 'confirmed', 'contradicted', 'inconclusive'],
      },
    })
    result?: string,
  ) {
    return this.knowledge.history(
      workspaceId,
      environmentId,
      user[securityId],
      offset,
      status,
      result,
    );
  }

  @get(
    '/api/workspaces/{workspaceId}/environments/{environmentId}/knowledge/{id}',
  )
  detail(
    @param.path.string('workspaceId', {schema: {format: 'uuid'}})
    workspaceId: string,
    @param.path.string('environmentId', {schema: {format: 'uuid'}})
    environmentId: string,
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.knowledge.detail(
      workspaceId,
      environmentId,
      user[securityId],
      id,
    );
  }

  @patch(
    '/api/workspaces/{workspaceId}/environments/{environmentId}/knowledge-patches/{id}',
  )
  decide(
    @param.path.string('workspaceId', {schema: {format: 'uuid'}})
    workspaceId: string,
    @param.path.string('environmentId', {schema: {format: 'uuid'}})
    environmentId: string,
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody() body: object,
  ) {
    const result = z.object({accept: z.boolean()}).strict().safeParse(body);

    if (!result.success)
      throw new HttpErrors.UnprocessableEntity('Provide accept as a boolean');

    return this.knowledge.decide(
      workspaceId,
      environmentId,
      user[securityId],
      id,
      result.data.accept,
    );
  }

  @get(
    '/api/workspaces/{workspaceId}/environments/{environmentId}/knowledge-patches/{id}',
  )
  patchDetail(
    @param.path.string('workspaceId', {schema: {format: 'uuid'}})
    workspaceId: string,
    @param.path.string('environmentId', {schema: {format: 'uuid'}})
    environmentId: string,
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @param.query.number('offset', {schema: {type: 'integer', minimum: 0}})
    offset = 0,
  ) {
    return this.knowledge.patchDetail(
      workspaceId,
      environmentId,
      user[securityId],
      id,
      offset,
    );
  }

  @get(
    '/api/workspaces/{workspaceId}/environments/{environmentId}/knowledge-patches/{patchId}/verifications/{id}',
  )
  verification(
    @param.path.string('workspaceId', {schema: {format: 'uuid'}})
    workspaceId: string,
    @param.path.string('environmentId', {schema: {format: 'uuid'}})
    environmentId: string,
    @param.path.string('patchId', {schema: {format: 'uuid'}}) patchId: string,
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.knowledge.verificationDetail(
      workspaceId,
      environmentId,
      user[securityId],
      patchId,
      id,
    );
  }

  @get('/api/workspaces/{workspaceId}/runs/{id}/knowledge-patches')
  runPatches(
    @param.path.string('workspaceId', {schema: {format: 'uuid'}})
    workspaceId: string,
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.knowledge.runPatches(workspaceId, id, user[securityId]);
  }

  @get('/api/workspaces/{workspaceId}/runs/{id}/knowledge')
  usage(
    @param.path.string('workspaceId', {schema: {format: 'uuid'}})
    workspaceId: string,
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.knowledge.runUsage(workspaceId, id, user[securityId]);
  }
}
