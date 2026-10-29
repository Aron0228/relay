import {BindingScope, injectable} from '@loopback/core';
import {z} from 'zod';
import {HttpErrors} from '@loopback/rest';

export interface GithubUser {
  id: number;
  login: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  avatar_url?: string;
  verifiedEmails?: string[];
}

interface GithubTokenResponse {
  // GitHub's response uses OAuth's snake_case field names.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  access_token?: string;
  error?: string;
}

@injectable({scope: BindingScope.SINGLETON})
export class GithubOAuthService {
  private readonly clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  private readonly clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  private readonly callbackUri = process.env.GITHUB_OAUTH_CALLBACK_URI;

  async getUser(code: string, codeVerifier: string): Promise<GithubUser> {
    if (!this.clientId || !this.clientSecret || !this.callbackUri) {
      throw new HttpErrors.ServiceUnavailable('GitHub OAuth is not configured');
    }
    const body = new URLSearchParams();

    body.set('client_id', this.clientId);
    body.set('client_secret', this.clientSecret);
    body.set('redirect_uri', this.callbackUri);
    body.set('code', code);
    body.set('code_verifier', codeVerifier);

    const token = (await this.request(
      'https://github.com/login/oauth/access_token',
      {method: 'POST', headers: {Accept: 'application/json'}, body},
    )) as GithubTokenResponse;

    if (token?.error || !token?.access_token) {
      throw new HttpErrors.Unauthorized(
        'GitHub authorization code was rejected',
      );
    }

    const user = (await this.request('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token.access_token}`,
        'User-Agent': 'relay-api',
      },
    })) as GithubUser;

    // Validate the external identity before using it for authentication.
    if (
      !user ||
      !Number.isSafeInteger(user.id) ||
      user.id <= 0 ||
      !user.login
    ) {
      throw new HttpErrors.BadGateway('GitHub returned an invalid user');
    }

    const verifiedEmails: string[] = [];

    for (let page = 1; ; page++) {
      const response = await this.request(
        `https://api.github.com/user/emails?per_page=100&page=${page}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token.access_token}`,
            'User-Agent': 'relay-api',
          },
        },
      );
      const emails = z
        .array(z.object({email: z.string().email(), verified: z.boolean()}))
        .safeParse(response);

      if (!emails.success)
        throw new HttpErrors.BadGateway('GitHub returned invalid email data');

      verifiedEmails.push(
        ...emails.data
          .filter(email => email.verified)
          .map(email => email.email.toLowerCase()),
      );

      if (emails.data.length < 100) break;
    }

    return {...user, verifiedEmails};
  }

  private async request(url: string, options: RequestInit): Promise<unknown> {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10 * 1000),
      });

      if (!response.ok) throw new Error('GitHub request failed');

      return await response.json();
    } catch {
      throw new HttpErrors.BadGateway('GitHub authentication request failed');
    }
  }
}
