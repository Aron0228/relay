import sharp from 'sharp';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {vi} from 'vitest';
import {randomInt, randomUUID} from 'node:crypto';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {setupApplication} from './test-helper';
import type {User, Workspace} from '../../models';
import type {
  UserRepository,
  WorkspaceMemberRepository,
  WorkspaceRepository,
  RunRepository,
} from '../../repositories';
import type {
  SessionService,
  SessionStoreService,
  WorkspaceService,
  WorkerService,
} from '../../services';

describe('Workspace access and lifecycle', () => {
  let app: Awaited<ReturnType<typeof setupApplication>>['app'];
  let client: Awaited<ReturnType<typeof setupApplication>>['client'];
  let service: WorkspaceService;
  let users: UserRepository;
  let workspaces: WorkspaceRepository;
  let members: WorkspaceMemberRepository;
  let finn: User, jake: User, iceKing: User;
  const ids: string[] = [];
  const hashes: string[] = [];
  let avatarDirectory: string;
  let finnToken: string, jakeToken: string, iceToken: string;

  beforeAll(async () => {
    avatarDirectory = await mkdtemp(path.join(tmpdir(), 'bmo-avatars-'));
    vi.stubEnv('WORKSPACE_AVATAR_DIR', avatarDirectory);
    ({app, client} = await setupApplication());
    service = await app.get('services.WorkspaceService');
    users = await app.get('repositories.UserRepository');
    workspaces = await app.get('repositories.WorkspaceRepository');
    members = await app.get('repositories.WorkspaceMemberRepository');
    const sessions = await app.get<SessionService>('services.SessionService');
    const people = [];

    for (const name of ['Finn', 'Jake', 'Ice King']) {
      const user = await users.create({
        githubId: randomInt(1_000_000_000, 2_000_000_000),
        username: name,
        verifiedEmails: [`${name.replace(' ', '').toLowerCase()}@ooo.example`],
      });
      const session = await sessions.create(user);
      hashes.push(session.session.tokenHash);
      people.push({user, token: session.token});
    }

    [finn, jake, iceKing] = people.map(person => person.user);
    [finnToken, jakeToken, iceToken] = people.map(person => person.token);
  });

  afterAll(async () => {
    if (!app) return;

    try {
      const runs = await app.get<RunRepository>('repositories.RunRepository');
      await runs.deleteAll({workspaceId: {inq: ids}});
      await workspaces.deleteAll({id: {inq: ids}});
      const store = await app.get<SessionStoreService>(
        'services.SessionStoreService',
      );
      for (const hash of hashes) await store.delete(hash);
      await users.deleteAll({id: {inq: [finn.id, jake.id, iceKing.id]}});
    } finally {
      await app.stop();
      await rm(avatarDirectory, {recursive: true, force: true});
      vi.unstubAllEnvs();
    }
  });

  async function create() {
    const response = await client
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${finnToken}`)
      .send({name: 'Candy Kingdom'})
      .expect(200);
    ids.push(response.body.id);

    return response.body as Workspace;
  }

  it('requires a session and atomically creates the admin membership', async () => {
    await client.get('/api/workspaces').expect(401);
    const workspace = await create();
    const listed = await client
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${finnToken}`)
      .expect(200);
    expect(listed.body).toContainEqual(
      expect.objectContaining({id: workspace.id, role: 'admin'}),
    );
    expect(
      await members.findOne({
        where: {workspaceId: workspace.id, userId: finn.id},
      }),
    ).toMatchObject({role: 'admin'});
    await client
      .get(`/api/workspaces/${workspace.id}`)
      .set('Authorization', `Bearer ${iceToken}`)
      .expect(404);
  });

  it('validates input and rejects fields not owned by the caller', async () => {
    await client
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${finnToken}`)
      .send({name: '  '})
      .expect(422);
    await client
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${finnToken}`)
      .send({name: 'Ooo', createdBy: iceKing.id})
      .expect(422);
  });

  it('matches invitations only against verified emails and consumes them once', async () => {
    const workspace = await create();
    const invitation = await service.invite(
      workspace.id,
      finn.id,
      'JAKE@ooo.example',
    );
    expect(
      (await service.invite(workspace.id, finn.id, 'jake@ooo.example')).id,
    ).toBe(invitation.id);
    expect(await service.listInvitations(iceKing.id)).toEqual([]);
    await client
      .post(`/api/workspace-invitations/${invitation.id}/response`)
      .set('Authorization', `Bearer ${iceToken}`)
      .send({accept: true})
      .expect(404);
    const inbox = await client
      .get('/api/workspace-invitations')
      .set('Authorization', `Bearer ${jakeToken}`)
      .expect(200);
    expect(inbox.body).toContainEqual(
      expect.objectContaining({
        id: invitation.id,
        workspaceName: 'Candy Kingdom',
      }),
    );
    const responses = await Promise.allSettled([
      service.respond(invitation.id, jake.id, true),
      service.respond(invitation.id, jake.id, true),
    ]);
    expect(
      responses.filter(response => response.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await members.count({workspaceId: workspace.id, userId: jake.id}),
    ).toEqual({count: 1});
    await client
      .patch(`/api/workspaces/${workspace.id}`)
      .set('Authorization', `Bearer ${jakeToken}`)
      .send({name: 'Jake Kingdom'})
      .expect(403);
  });

  it('allows only admins to manage settings, invitations and member roles', async () => {
    const workspace = await create();
    await members.create({
      workspaceId: workspace.id,
      userId: jake.id,
      role: 'member',
    });
    await client
      .patch(`/api/workspaces/${workspace.id}`)
      .set('Authorization', `Bearer ${finnToken}`)
      .send({name: 'Tree Fort'})
      .expect(200);
    expect((await workspaces.findById(workspace.id)).name).toBe('Tree Fort');
    await client
      .post(`/api/workspaces/${workspace.id}/invitations`)
      .set('Authorization', `Bearer ${jakeToken}`)
      .send({email: 'marceline@ooo.example'})
      .expect(403);
    await client
      .patch(`/api/workspaces/${workspace.id}/members/${finn.id}`)
      .set('Authorization', `Bearer ${jakeToken}`)
      .send({role: 'member'})
      .expect(403);
    await client
      .delete(`/api/workspaces/${workspace.id}/members/${finn.id}`)
      .set('Authorization', `Bearer ${finnToken}`)
      .expect(409);
    await client
      .patch(`/api/workspaces/${workspace.id}/members/${jake.id}`)
      .set('Authorization', `Bearer ${finnToken}`)
      .send({role: 'admin'})
      .expect(204);
    expect(
      await members.findOne({
        where: {workspaceId: workspace.id, userId: jake.id},
      }),
    ).toMatchObject({role: 'admin'});
  });

  it('supports invitations before signup, rejection and admin revocation', async () => {
    const workspace = await create();
    const future = await service.invite(
      workspace.id,
      finn.id,
      'marceline@ooo.example',
    );
    await service.revoke(workspace.id, finn.id, future.id);
    const invitation = await service.invite(
      workspace.id,
      finn.id,
      'jake@ooo.example',
    );
    await service.respond(invitation.id, jake.id, false);
    expect(
      await members.count({workspaceId: workspace.id, userId: jake.id}),
    ).toEqual({count: 0});
    expect(await service.workspaceInvitations(workspace.id, finn.id)).toEqual(
      [],
    );
  });

  it('keeps the owner immutable even when another admin exists', async () => {
    const workspace = await create();
    await members.create({
      workspaceId: workspace.id,
      userId: jake.id,
      role: 'admin',
    });

    const listed = await service.listMembers(workspace.id, jake.id);
    expect(listed.find(member => member.userId === finn.id)).toMatchObject({
      isOwner: true,
    });
    expect(await service.requireMember(workspace.id, finn.id)).toMatchObject({
      isOwner: true,
    });

    for (const role of ['member', 'admin'] as const) {
      await expect(
        service.changeMember(workspace.id, jake.id, finn.id, role),
      ).rejects.toMatchObject({statusCode: 409});
    }
    await expect(
      service.changeMember(workspace.id, jake.id, finn.id),
    ).rejects.toMatchObject({statusCode: 409});
    await expect(
      service.changeMember(workspace.id, finn.id, finn.id),
    ).rejects.toMatchObject({statusCode: 409});
    expect(
      await members.findOne({
        where: {workspaceId: workspace.id, userId: finn.id},
      }),
    ).toMatchObject({role: 'admin'});
  });

  it('serializes concurrent demotions so the final admin is preserved', async () => {
    const workspace = await create();
    await members.create({
      workspaceId: workspace.id,
      userId: jake.id,
      role: 'admin',
    });
    const results = await Promise.allSettled([
      service.changeMember(workspace.id, finn.id, finn.id, 'member'),
      service.changeMember(workspace.id, jake.id, jake.id, 'member'),
    ]);
    expect(
      results.filter(result => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await members.count({workspaceId: workspace.id, role: 'admin'}),
    ).toEqual({count: 1});
  });

  it('allows members to leave and forbids removal of the last admin', async () => {
    const workspace = await create();
    await members.create({
      workspaceId: workspace.id,
      userId: jake.id,
      role: 'member',
    });
    await service.changeMember(workspace.id, jake.id, jake.id);
    await expect(
      service.changeMember(workspace.id, finn.id, finn.id),
    ).rejects.toMatchObject({statusCode: 409});
  });

  it('uploads and serves only decoded images to workspace members', async () => {
    const workspace = await create();
    await members.create({
      workspaceId: workspace.id,
      userId: jake.id,
      role: 'member',
    });
    const image = await sharp({
      create: {width: 32, height: 32, channels: 3, background: '#f0c040'},
    })
      .png()
      .toBuffer();
    const upload = `/api/workspaces/${workspace.id}/avatar`;

    await client
      .post(upload)
      .set('Content-Type', 'image/png')
      .send(image)
      .expect(401);
    await client
      .post(upload)
      .set('Authorization', `Bearer ${jakeToken}`)
      .set('Content-Type', 'image/png')
      .send(image)
      .expect(403);
    const saved = await client
      .post(upload)
      .set('Authorization', `Bearer ${finnToken}`)
      .set('Content-Type', 'image/png')
      .send(image)
      .expect(200);
    expect(saved.body.avatarUrl).toMatch(/\.webp$/);
    await client.get(saved.body.avatarUrl).expect(401);
    await client
      .get(saved.body.avatarUrl)
      .set('Authorization', `Bearer ${iceToken}`)
      .expect(404);
    const downloaded = await client
      .get(saved.body.avatarUrl)
      .set('Authorization', `Bearer ${jakeToken}`)
      .expect(200);
    expect(downloaded.headers['content-type']).toContain('image/webp');
    expect(downloaded.headers['x-content-type-options']).toBe('nosniff');
    expect((await sharp(downloaded.body).metadata()).format).toBe('webp');
    await client
      .post(upload)
      .set('Authorization', `Bearer ${finnToken}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
      .expect(422);
    await client
      .post(upload)
      .set('Authorization', `Bearer ${finnToken}`)
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(5 * 1024 * 1024 + 1))
      .expect(413);
    const replaced = await client
      .post(upload)
      .set('Authorization', `Bearer ${finnToken}`)
      .set('Content-Type', 'image/png')
      .send(image)
      .expect(200);
    expect(replaced.body.avatarUrl).not.toBe(saved.body.avatarUrl);
    await client
      .get(saved.body.avatarUrl)
      .set('Authorization', `Bearer ${finnToken}`)
      .expect(404);
    await client
      .delete(upload)
      .set('Authorization', `Bearer ${finnToken}`)
      .expect(204);
    expect((await workspaces.findById(workspace.id)).avatarUrl).toBeNull();
    await client
      .get(replaced.body.avatarUrl)
      .set('Authorization', `Bearer ${finnToken}`)
      .expect(404);
  });

  it('validates environments and retains historical runs after deletion', async () => {
    const workspace = await create();
    const other = await create();
    await members.create({
      workspaceId: workspace.id,
      userId: jake.id,
      role: 'member',
    });
    const environment = await service.saveEnvironment(workspace.id, finn.id, {
      name: 'Candy Shop',
      baseUrl: 'https://academybugs.com/',
    });
    await expect(
      service.saveEnvironment(workspace.id, jake.id, {
        name: 'No',
        baseUrl: 'https://academybugs.com/',
      }),
    ).rejects.toMatchObject({statusCode: 403});
    await expect(
      service.saveEnvironment(workspace.id, finn.id, {
        name: 'No',
        baseUrl: 'http://unapproved.example/',
      }),
    ).rejects.toMatchObject({statusCode: 400});
    await expect(
      service.environment(other.id, finn.id, environment.id),
    ).rejects.toMatchObject({statusCode: 404});
    const runs = await app.get<RunRepository>('repositories.RunRepository');
    const run = await runs.create({
      id: randomUUID(),
      userId: finn.id,
      workspaceId: workspace.id,
      environmentId: environment.id,
      scriptName: 'agent',
      viewTokenHash: 'a'.repeat(64),
      status: 'completed',
      cancelRequested: false,
    });
    const worker = await app.get<WorkerService>('services.WorkerService');
    expect((await worker.getOwned(run.id, jake.id)).id).toBe(run.id);
    await expect(worker.getOwned(run.id, iceKing.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(worker.getViewable(run.id, 'anything')).rejects.toMatchObject({
      statusCode: 404,
    });
    const page = await client
      .get(`/api/runs?workspaceId=${workspace.id}`)
      .set('Authorization', `Bearer ${jakeToken}`)
      .expect(200);
    expect(page.body.items).toHaveLength(1);
    await client
      .post('/api/runs/agent')
      .set('Authorization', `Bearer ${finnToken}`)
      .send({
        workspaceId: other.id,
        environmentId: environment.id,
        prompt: 'Find the Candy Shop',
      })
      .expect(404);
    await service.removeEnvironment(workspace.id, finn.id, environment.id);
    expect(await runs.exists(run.id)).toBe(true);
    await expect(
      service.environment(workspace.id, finn.id, environment.id),
    ).rejects.toMatchObject({statusCode: 404});
    await service.remove(workspace.id, finn.id);
    expect(await runs.exists(run.id)).toBe(true);
    await expect(worker.getOwned(run.id, finn.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
