import {BindingScope, injectable, service} from '@loopback/core';
import {repository} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {createHash, randomBytes} from 'node:crypto';
import {UserRepository} from '../repositories';
import {GithubOAuthService} from './github-oauth.service';
import {SessionService} from './session.service';
import {SessionStoreService} from './session-store.service';

@injectable({scope: BindingScope.SINGLETON})
export class OAuthCallbackService {
  private readonly exchangeTtlMs =
    Number(process.env.OAUTH_EXCHANGE_TTL_SECONDS ?? 60) * 1000;

  constructor(
    @service(SessionService) private sessions: SessionService,
    @service(SessionStoreService) private store: SessionStoreService,
    @service(GithubOAuthService) private github: GithubOAuthService,
    @repository(UserRepository) private users: UserRepository,
  ) {}

  async callback(
    state?: string,
    code?: string,
    error?: string,
  ): Promise<string> {
    if (!state) throw new HttpErrors.BadRequest('OAuth state is required');

    const transaction = await this.sessions.consumeOAuthTransaction(state);

    if (!transaction) {
      throw new HttpErrors.BadRequest('OAuth state is invalid or expired');
    }
    if (error)
      throw new HttpErrors.Unauthorized('GitHub authorization was denied');
    if (!code)
      throw new HttpErrors.BadRequest('OAuth authorization code is required');

    const githubUser = await this.github.getUser(
      code,
      transaction.codeVerifier,
    );
    const user = await this.users.resolveGithubUser(
      githubUser.id,
      githubUser.login,
    );

    const exchangeCode = randomBytes(32).toString('base64url');
    const createdAt = new Date();

    await this.store.createExchangeCode({
      codeHash: createHash('sha256').update(exchangeCode).digest('hex'),
      userId: user.id,
      clientType: transaction.clientType,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + this.exchangeTtlMs),
    });

    const url = new URL(transaction.redirectUri);

    url.searchParams.set('exchange_code', exchangeCode);

    return url.toString();
  }
}
