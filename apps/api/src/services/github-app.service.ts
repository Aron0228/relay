/* eslint-disable @typescript-eslint/naming-convention -- GitHub REST payloads use snake_case. */
import {BindingScope, injectable} from '@loopback/core';
import {HttpErrors} from '@loopback/rest';
import {createPrivateKey, sign} from 'node:crypto';
import {z} from 'zod';
import {User} from '../models';

export const GITHUB_APP_SERVICE_BINDING_KEY = 'services.GithubAppService';

const installationSchema = z.object({
  id: z.number().int().positive(),
  account: z.object({
    id: z.number().int().positive(),
    login: z.string().min(1),
    type: z.enum(['User', 'Organization']),
  }),
  suspended_at: z.string().nullable(),
  permissions: z.object({issues: z.string().optional()}),
});
const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().regex(/^[^/]+\/[^/]+$/),
  archived: z.boolean(),
  disabled: z.boolean(),
});
export type AppInstallation = z.infer<typeof installationSchema>;
export type AppRepository = z.infer<typeof repositorySchema>;

@injectable({scope: BindingScope.SINGLETON})
export class GithubAppService {
  private readonly tokenRefreshWindowMs = 60 * 1000;
  private readonly requestTimeoutMs = 10 * 1000;
  private readonly tokens = new Map<
    number,
    {token: string; expiresAt: number}
  >();

  private jwt(): string {
    const issuer =
      process.env.GITHUB_APP_CLIENT_ID || process.env.GITHUB_APP_ID;
    const pem = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!issuer || !pem)
      throw new HttpErrors.ServiceUnavailable('GitHub App is not configured');

    try {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(
        JSON.stringify({alg: 'RS256', typ: 'JWT'}),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({iat: now - 60, exp: now + 9 * 60, iss: issuer}),
      ).toString('base64url');
      const input = `${header}.${payload}`;
      const signature = sign(
        'RSA-SHA256',
        Buffer.from(input),
        createPrivateKey(pem.replace(/\\n/g, '\n')),
      );

      return `${input}.${signature.toString('base64url')}`;
    } catch {
      throw new HttpErrors.ServiceUnavailable(
        'GitHub App credentials are invalid',
      );
    }
  }

  private async request(
    path: string,
    token: string,
    method = 'GET',
    body?: object,
  ): Promise<unknown> {
    let response: globalThis.Response;

    try {
      response = await fetch(`https://api.github.com${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'relay-api',
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new HttpErrors.BadGateway('GitHub App request failed');
    }

    if ([401, 403, 404].includes(response.status))
      throw new HttpErrors.Forbidden(
        'GitHub App access is unavailable or insufficient',
      );
    if (!response.ok)
      throw new HttpErrors.BadGateway('GitHub App request failed');

    try {
      return await response.json();
    } catch {
      throw new HttpErrors.BadGateway('GitHub returned invalid data');
    }
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);

    if (!parsed.success)
      throw new HttpErrors.BadGateway('GitHub returned invalid data');

    return parsed.data;
  }

  async installationUrl(): Promise<string> {
    const app = this.parse(
      z.object({slug: z.string().regex(/^[a-zA-Z0-9-]+$/)}),
      await this.request('/app', this.jwt()),
    );

    return `https://github.com/apps/${app.slug}/installations/new`;
  }

  async installationSettingsUrl(id: number): Promise<string> {
    const installation = this.parse(
      installationSchema,
      await this.request(`/app/installations/${id}`, this.jwt()),
    );

    if (installation.id !== id)
      throw new HttpErrors.BadGateway(
        'GitHub returned an invalid installation',
      );

    return installation.account.type === 'Organization'
      ? `https://github.com/organizations/${encodeURIComponent(installation.account.login)}/settings/installations/${id}`
      : `https://github.com/settings/installations/${id}`;
  }

  async installation(id: number): Promise<AppInstallation> {
    const installation = this.parse(
      installationSchema,
      await this.request(`/app/installations/${id}`, this.jwt()),
    );

    if (
      installation.id !== id ||
      installation.suspended_at ||
      installation.permissions.issues !== 'write'
    ) {
      this.tokens.delete(id);
      throw new HttpErrors.Forbidden(
        'The installation is suspended or lacks Issues write access',
      );
    }

    return installation;
  }

  private async token(id: number): Promise<string> {
    const cached = this.tokens.get(id);

    if (cached && cached.expiresAt > Date.now() + this.tokenRefreshWindowMs)
      return cached.token;

    this.tokens.delete(id);
    const data = this.parse(
      z.object({token: z.string().min(1), expires_at: z.string().datetime()}),
      await this.request(
        `/app/installations/${id}/access_tokens`,
        this.jwt(),
        'POST',
      ),
    );
    const expiresAt = Date.parse(data.expires_at);

    if (expiresAt <= Date.now() + this.tokenRefreshWindowMs)
      throw new HttpErrors.BadGateway('GitHub returned an expired token');

    this.tokens.set(id, {token: data.token, expiresAt});

    return data.token;
  }

  private async installedRequest(
    id: number,
    path: string,
    method = 'GET',
    body?: object,
  ): Promise<unknown> {
    try {
      return await this.request(path, await this.token(id), method, body);
    } catch (error) {
      this.tokens.delete(id);
      throw error;
    }
  }

  async requireManager(id: number, user: User): Promise<AppInstallation> {
    const installation = await this.installation(id);

    if (installation.account.type === 'User') {
      if (String(installation.account.id) !== String(user.githubId))
        throw new HttpErrors.Forbidden(
          'Only the GitHub account owner can connect this installation',
        );

      return installation;
    }

    const current = this.parse(
      z.object({id: z.number(), login: z.string().min(1)}),
      await this.installedRequest(
        id,
        `/users/${encodeURIComponent(user.username)}`,
      ),
    );

    if (String(current.id) !== String(user.githubId))
      throw new HttpErrors.Forbidden(
        'Sign in again to refresh your GitHub identity',
      );

    const membership = this.parse(
      z.object({state: z.string(), role: z.string()}),
      await this.installedRequest(
        id,
        `/orgs/${encodeURIComponent(installation.account.login)}/memberships/${encodeURIComponent(current.login)}`,
      ),
    );

    if (membership.state !== 'active' || membership.role !== 'admin')
      throw new HttpErrors.Forbidden(
        'An active GitHub organization owner must connect this installation',
      );

    return installation;
  }

  async managedInstallations(user: User) {
    const available: {githubId: number; accountLogin: string}[] = [];

    for (let page = 1; ; page++) {
      const items = this.parse(
        z.array(installationSchema),
        await this.request(
          `/app/installations?per_page=100&page=${page}`,
          this.jwt(),
        ),
      );

      for (const item of items) {
        if (item.suspended_at) continue;

        try {
          await this.requireManager(item.id, user);
          available.push({githubId: item.id, accountLogin: item.account.login});
        } catch (error) {
          if (!(error instanceof HttpErrors.Forbidden)) throw error;
        }
      }

      if (items.length < 100) return available;
    }
  }

  async repositories(id: number): Promise<AppRepository[]> {
    await this.installation(id);
    const repositories: AppRepository[] = [];

    for (let page = 1; ; page++) {
      const data = this.parse(
        z.object({repositories: z.array(repositorySchema)}),
        await this.installedRequest(
          id,
          `/installation/repositories?per_page=100&page=${page}`,
        ),
      );
      repositories.push(
        ...data.repositories.filter(repo => !repo.archived && !repo.disabled),
      );

      if (data.repositories.length < 100) return repositories;
    }
  }

  async requireRepository(
    installationId: number,
    githubId: number,
  ): Promise<AppRepository> {
    const repository = (await this.repositories(installationId)).find(
      repo => String(repo.id) === String(githubId),
    );

    if (!repository)
      throw new HttpErrors.Forbidden(
        'Repository is no longer available to this installation',
      );

    return repository;
  }

  async getIssue(installationId: number, repositoryId: number, number: number) {
    if (!Number.isSafeInteger(number) || number < 1)
      throw new HttpErrors.BadRequest('Invalid issue number');
    const repo = await this.requireRepository(installationId, repositoryId);
    const path = repo.full_name.split('/').map(encodeURIComponent).join('/');
    const issue = this.parse(
      z.object({
        id: z.number().int().positive(),
        number: z.number().int(),
        html_url: z.string().url(),
        title: z.string(),
        body: z.string().nullable(),
        pull_request: z.unknown().optional(),
      }),
      await this.installedRequest(
        installationId,
        `/repos/${path}/issues/${number}`,
      ),
    );

    if (issue.pull_request || issue.number !== number)
      throw new HttpErrors.BadRequest('A GitHub issue is required');

    return {
      githubId: issue.id,
      number: issue.number,
      url: issue.html_url,
      title: issue.title,
      body: issue.body ?? '',
    };
  }

  async createComment(
    installationId: number,
    repositoryId: number,
    number: number,
    body: string,
  ) {
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      !body.trim() ||
      body.length > 65536
    )
      throw new HttpErrors.BadRequest('Invalid issue comment');
    const repo = await this.requireRepository(installationId, repositoryId);
    const path = repo.full_name.split('/').map(encodeURIComponent).join('/');
    const comment = this.parse(
      z.object({id: z.number().int().positive(), html_url: z.string().url()}),
      await this.installedRequest(
        installationId,
        `/repos/${path}/issues/${number}/comments`,
        'POST',
        {body},
      ),
    );

    return {githubId: comment.id, url: comment.html_url};
  }
}
