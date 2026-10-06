import {AuthenticationStrategy} from '@loopback/authentication';
import {inject} from '@loopback/core';
import {Request} from '@loopback/rest';
import {UserProfile} from '@loopback/security';
import {SESSION_SERVICE_BINDING_KEY} from '../services';
import type {SessionService} from '../services';
import {getSessionToken} from '../utils/session-token';

export class SessionStrategy implements AuthenticationStrategy {
  name = 'session';

  constructor(
    @inject(SESSION_SERVICE_BINDING_KEY) private sessions: SessionService,
  ) {}

  async authenticate(request: Request): Promise<UserProfile | undefined> {
    const token = getSessionToken(request);

    if (!token) return undefined;

    return (await this.sessions.getUserProfile(token)) ?? undefined;
  }
}
