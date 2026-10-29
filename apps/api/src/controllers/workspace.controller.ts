import {authenticate} from '@loopback/authentication';
import {inject, service} from '@loopback/core';
import {
  del,
  get,
  HttpErrors,
  param,
  patch,
  post,
  requestBody,
  Response,
  RestBindings,
} from '@loopback/rest';
import {securityId, SecurityBindings, UserProfile} from '@loopback/security';
import {z} from 'zod';
import {WorkspaceService} from '../services/workspace.service';
import {WorkspaceAvatarService} from '../services/workspace-avatar.service';
import {WORKSPACE_ROLE, WorkspaceRole} from '../models';

const workspaceInput = z
  .object({
    name: z.string().trim().min(1).max(100),
  })
  .strict();
const environmentInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    baseUrl: z.string().url().max(2000),
  })
  .strict();

function input<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);

  if (!result.success)
    throw new HttpErrors.UnprocessableEntity(
      result.error.issues.map(issue => issue.message).join('; '),
    );

  return result.data;
}

@authenticate('session')
export class WorkspaceController {
  constructor(
    @service(WorkspaceService) private workspaces: WorkspaceService,
    @service(WorkspaceAvatarService) private avatars: WorkspaceAvatarService,
    @inject(RestBindings.Http.RESPONSE) private response: Response,
  ) {}

  @get('/api/workspaces')
  list(@inject(SecurityBindings.USER) user: UserProfile) {
    return this.workspaces.list(user[securityId]);
  }

  @post('/api/workspaces')
  create(
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody() body: object,
  ) {
    const data = input(workspaceInput, body);

    return this.workspaces.create(user[securityId], data.name);
  }

  @post('/api/workspaces/{id}/avatar')
  async uploadAvatar(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody({
      required: true,
      content: {
        'image/png': {'x-parser': 'raw'},
        'image/jpeg': {'x-parser': 'raw'},
        'image/webp': {'x-parser': 'raw'},
      },
    })
    body: Buffer,
  ) {
    await this.workspaces.requireMember(id, user[securityId], true);
    const filename = await this.avatars.store(body);
    const avatarUrl = `/api/workspaces/${id}/avatar/${filename}`;
    let previous: string | null | undefined;

    try {
      previous = await this.workspaces.replaceAvatar(
        id,
        user[securityId],
        avatarUrl,
      );
    } catch (error) {
      await this.avatars.remove(filename);
      throw error;
    }

    await this.removePreviousAvatar(id, previous);

    return {avatarUrl};
  }

  @del('/api/workspaces/{id}/avatar')
  async deleteAvatar(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<void> {
    const previous = await this.workspaces.replaceAvatar(
      id,
      user[securityId],
      null,
    );

    await this.removePreviousAvatar(id, previous);
  }

  @get('/api/workspaces/{id}/avatar/{filename}')
  async avatar(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.path.string('filename') filename: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<Response> {
    await this.workspaces.requireMember(id, user[securityId]);
    const stored = await this.workspaces.avatarUrl(id);

    if (stored !== `/api/workspaces/${id}/avatar/${filename}`)
      throw new HttpErrors.NotFound('Avatar not found');

    this.response.setHeader('Content-Type', 'image/webp');
    this.response.setHeader('Cache-Control', 'private, no-store');
    this.response.setHeader('X-Content-Type-Options', 'nosniff');
    await new Promise<void>((resolve, reject) =>
      this.response.sendFile(this.avatars.filePath(filename), error =>
        error ? reject(error) : resolve(),
      ),
    );

    return this.response;
  }

  private async removePreviousAvatar(id: string, url?: string | null) {
    const prefix = `/api/workspaces/${id}/avatar/`;

    if (url?.startsWith(prefix))
      await this.avatars.remove(url.slice(prefix.length));
  }

  @get('/api/workspaces/{id}')
  get(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.workspaces.requireMember(id, user[securityId]);
  }

  @patch('/api/workspaces/{id}')
  update(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody() body: object,
  ) {
    return this.workspaces.update(
      id,
      user[securityId],
      input(workspaceInput.partial(), body),
    );
  }

  @del('/api/workspaces/{id}')
  async remove(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<void> {
    await this.workspaces.remove(id, user[securityId]);
  }

  @get('/api/workspaces/{id}/members')
  members(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.workspaces.listMembers(id, user[securityId]);
  }

  @patch('/api/workspaces/{id}/members/{userId}')
  async role(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.path.string('userId', {schema: {format: 'uuid'}}) userId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody() body: object,
  ): Promise<void> {
    const data = input(
      z
        .object({
          role: z.enum(
            Object.values(WORKSPACE_ROLE) as [
              WorkspaceRole,
              ...WorkspaceRole[],
            ],
          ),
        })
        .strict(),
      body,
    );

    await this.workspaces.changeMember(id, user[securityId], userId, data.role);
  }

  @del('/api/workspaces/{id}/members/{userId}')
  async removeMember(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.path.string('userId', {schema: {format: 'uuid'}}) userId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<void> {
    await this.workspaces.changeMember(id, user[securityId], userId);
  }

  @get('/api/workspace-invitations')
  invitations(@inject(SecurityBindings.USER) user: UserProfile) {
    return this.workspaces.listInvitations(user[securityId]);
  }

  @get('/api/workspaces/{id}/invitations')
  sentInvitations(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.workspaces.workspaceInvitations(id, user[securityId]);
  }

  @post('/api/workspaces/{id}/invitations')
  invite(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody() body: object,
  ) {
    const data = input(
      z
        .object({email: z.string().trim().toLowerCase().email().max(254)})
        .strict(),
      body,
    );

    return this.workspaces.invite(id, user[securityId], data.email);
  }

  @post('/api/workspace-invitations/{id}/response')
  async respond(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody() body: object,
  ): Promise<void> {
    const data = input(z.object({accept: z.boolean()}).strict(), body);

    await this.workspaces.respond(id, user[securityId], data.accept);
  }

  @del('/api/workspaces/{id}/invitations/{invitationId}')
  async revoke(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.path.string('invitationId', {schema: {format: 'uuid'}})
    invitationId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<void> {
    await this.workspaces.revoke(id, user[securityId], invitationId);
  }

  @get('/api/workspaces/{id}/environments')
  environments(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    return this.workspaces.listEnvironments(id, user[securityId]);
  }

  @post('/api/workspaces/{id}/environments')
  createEnvironment(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody() body: object,
  ) {
    return this.workspaces.saveEnvironment(
      id,
      user[securityId],
      input(environmentInput, body),
    );
  }

  @patch('/api/workspaces/{id}/environments/{environmentId}')
  updateEnvironment(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.path.string('environmentId', {schema: {format: 'uuid'}})
    environmentId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @requestBody() body: object,
  ) {
    return this.workspaces.saveEnvironment(
      id,
      user[securityId],
      input(environmentInput, body),
      environmentId,
    );
  }

  @del('/api/workspaces/{id}/environments/{environmentId}')
  async removeEnvironment(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.path.string('environmentId', {schema: {format: 'uuid'}})
    environmentId: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<void> {
    await this.workspaces.removeEnvironment(
      id,
      user[securityId],
      environmentId,
    );
  }
}
