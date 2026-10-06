import {BindingScope, injectable, service} from '@loopback/core';
import {securityId, UserProfile} from '@loopback/security';
import {HttpErrors} from '@loopback/rest';
import {createHash, randomBytes} from 'node:crypto';
import {
  OAuthClientType,
  OAUTH_CLIENT_TYPE,
  OAuthTransaction,
  Session,
  User,
} from '../models';
import {SessionStoreService} from './session-store.service';

export const SESSION_SERVICE_BINDING_KEY = 'services.SessionService';
export const SESSION_COOKIE_NAME = '__Host-relay_session';

export interface CreatedSession {
  token: string;
  session: Session;
}

@injectable({scope: BindingScope.SINGLETON})
export class SessionService {
  private readonly githubClientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  private readonly githubCallbackUri = process.env.GITHUB_OAUTH_CALLBACK_URI;
  private readonly oauthTransactionTtlMs =
    Number(process.env.OAUTH_TRANSACTION_TTL_MINUTES ?? 5) * 60 * 1000;
  private readonly oauthRedirectUris = {
    [OAUTH_CLIENT_TYPE.Web]: process.env.OAUTH_WEB_REDIRECT_URI,
    [OAUTH_CLIENT_TYPE.Mobile]: process.env.OAUTH_MOBILE_REDIRECT_URI,
  };
  private readonly idleTimeoutMs =
    Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES ?? 30) * 60 * 1000; // 30 minutes by default
  private readonly absoluteTimeoutMs =
    Number(process.env.SESSION_ABSOLUTE_TIMEOUT_HOURS ?? 12) * 60 * 60 * 1000; // 12 hours by default

  constructor(
    @service(SessionStoreService) private sessionStore: SessionStoreService,
  ) {}

  async create(user: User): Promise<CreatedSession> {
    const token = randomBytes(32).toString('hex');
    const createdAt = new Date();
    const session = await this.sessionStore.create({
      userId: user.id,
      tokenHash: this.hashToken(token),
      userProfile: {
        [securityId]: user.id,
        id: user.id,
        name: user.username,
        githubId: user.githubId,
      },
      createdAt,
      expiresAt: new Date(
        createdAt.getTime() +
          Math.min(this.idleTimeoutMs, this.absoluteTimeoutMs),
      ),
      absoluteExpiresAt: new Date(createdAt.getTime() + this.absoluteTimeoutMs),
      revokedAt: null,
    });

    return {token, session};
  }

  async get(token: string): Promise<Session | null> {
    const tokenHash = this.hashToken(token);
    const session = await this.sessionStore.get(tokenHash);
    if (!session || !this.isActive(session)) return null;

    const updated = await this.sessionStore.update(tokenHash, {
      expiresAt: new Date(
        Math.min(
          Date.now() + this.idleTimeoutMs,
          session.absoluteExpiresAt.getTime(),
        ),
      ),
    });

    return updated && this.isActive(updated) ? updated : null;
  }

  async invalidate(token: string): Promise<void> {
    await this.sessionStore.update(this.hashToken(token), {
      revokedAt: new Date(),
    });
  }

  async getUserProfile(token: string): Promise<UserProfile | null> {
    const session = await this.get(token);
    return session?.userProfile ?? null;
  }

  async createOAuthTransaction(
    clientType: OAuthClientType,
  ): Promise<OAuthTransaction> {
    const redirectUri = this.oauthRedirectUris[clientType];
    if (!redirectUri) {
      throw new Error(
        'An approved OAuth redirect URI must be configured for this client',
      );
    }
    const createdAt = new Date();
    return this.sessionStore.createTransaction({
      state: randomBytes(32).toString('base64url'),
      codeVerifier: randomBytes(32).toString('base64url'),
      clientType,
      redirectUri,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + this.oauthTransactionTtlMs),
    });
  }

  async createOAuthLoginUrl(clientType: OAuthClientType): Promise<string> {
    if (!this.githubClientId || !this.githubCallbackUri) {
      throw new HttpErrors.ServiceUnavailable('GitHub OAuth is not configured');
    }

    const transaction = await this.createOAuthTransaction(clientType);

    const url = new URL('https://github.com/login/oauth/authorize');

    url.searchParams.set('client_id', this.githubClientId);
    url.searchParams.set('redirect_uri', this.githubCallbackUri);
    url.searchParams.set('state', transaction.state);
    url.searchParams.set('prompt', 'select_account');
    url.searchParams.set(
      'code_challenge',
      createHash('sha256').update(transaction.codeVerifier).digest('base64url'),
    );
    url.searchParams.set('code_challenge_method', 'S256');

    return url.toString();
  }

  async consumeOAuthTransaction(
    state: string,
  ): Promise<OAuthTransaction | null> {
    const transaction = await this.sessionStore.consumeTransaction(state);
    return transaction && transaction.expiresAt.getTime() > Date.now()
      ? transaction
      : null;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private isActive(session: Session): boolean {
    const now = Date.now();
    return (
      !session.revokedAt &&
      session.expiresAt.getTime() > now &&
      session.absoluteExpiresAt.getTime() > now
    );
  }
}
