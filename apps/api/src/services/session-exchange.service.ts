import {BindingScope, injectable, service} from '@loopback/core';
import {repository} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {createHash} from 'node:crypto';
import {OAuthClientType} from '../models';
import {UserRepository} from '../repositories';
import {CreatedSession, SessionService} from './session.service';
import {SessionStoreService} from './session-store.service';

export interface ExchangedSession extends CreatedSession {
  clientType: OAuthClientType;
}

@injectable({scope: BindingScope.SINGLETON})
export class SessionExchangeService {
  constructor(
    @service(SessionStoreService) private store: SessionStoreService,
    @service(SessionService) private sessions: SessionService,
    @repository(UserRepository) private users: UserRepository,
  ) {}

  async exchange(code: string): Promise<ExchangedSession> {
    const codeHash = createHash('sha256').update(code).digest('hex');

    const exchange = await this.store.consumeExchangeCode(codeHash);

    if (!exchange) {
      throw new HttpErrors.Unauthorized('Exchange code is invalid or expired');
    }

    const user = await this.users.findOne({where: {id: exchange.userId}});

    if (!user)
      throw new HttpErrors.Unauthorized('Exchange user no longer exists');

    const created = await this.sessions.create(user);

    return {...created, clientType: exchange.clientType};
  }
}
