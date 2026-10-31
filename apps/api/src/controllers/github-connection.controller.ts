import {authenticate} from '@loopback/authentication';
import {inject, service} from '@loopback/core';
import {del, get, HttpErrors, param, post, requestBody} from '@loopback/rest';
import {securityId, SecurityBindings, UserProfile} from '@loopback/security';
import {z} from 'zod';
import {GithubConnectionService} from '../services/github-connection.service';

function input<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);

  if (!result.success)
    throw new HttpErrors.UnprocessableEntity(
      'Invalid GitHub connection settings',
    );

  return result.data;
}
const githubId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

@authenticate('session')
export class GithubConnectionController {
  constructor(
    @service(GithubConnectionService)
    private connections: GithubConnectionService,
  ) {}

  @get('/api/workspaces/{id}/github')
  list(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.connections.list(id, user[securityId]);
  }

  @get('/api/workspaces/{id}/github/installation-url')
  installationUrl(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.connections.installationUrl(id, user[securityId]);
  }

  @get(
    '/api/workspaces/{id}/github/installations/{installationId}/settings-url',
  )
  settingsUrl(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.path.string('installationId', {schema: {format: 'uuid'}})
    installationId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.connections.installationUrl(
      id,
      user[securityId],
      installationId,
    );
  }

  @get('/api/workspaces/{id}/github/available-installations')
  available(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.connections.available(id, user[securityId]);
  }

  @post('/api/workspaces/{id}/github/installations')
  connect(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody() body: object,
  ) {
    const data = input(z.object({githubId}).strict(), body);

    return this.connections.connect(id, user[securityId], data.githubId);
  }

  @get(
    '/api/workspaces/{id}/github/installations/{installationId}/repositories',
  )
  repositories(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.path.string('installationId', {schema: {format: 'uuid'}})
    installationId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.connections.availableRepositories(
      id,
      user[securityId],
      installationId,
    );
  }

  @post('/api/workspaces/{id}/github/repositories')
  save(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody() body: object,
  ) {
    const data = input(
      z
        .object({
          installationId: z.uuid(),
          githubId,
          environmentId: z.uuid(),
        })
        .strict(),
      body,
    );

    return this.connections.saveRepository(
      id,
      user[securityId],
      data.installationId,
      data.githubId,
      data.environmentId,
    );
  }

  @del('/api/workspaces/{id}/github/installations/{installationId}')
  async disconnect(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.path.string('installationId', {schema: {format: 'uuid'}})
    installationId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<void> {
    await this.connections.disconnect(
      id,
      user[securityId],
      installationId,
      true,
    );
  }

  @del('/api/workspaces/{id}/github/repositories/{repositoryId}')
  async remove(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.path.string('repositoryId', {schema: {format: 'uuid'}})
    repositoryId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<void> {
    await this.connections.disconnect(
      id,
      user[securityId],
      repositoryId,
      false,
    );
  }
}
