import {AuthenticationStrategy} from '@loopback/authentication';
import {inject} from '@loopback/core';
import {Request} from '@loopback/rest';
import {UserProfile} from '@loopback/security';
import {parseCookie} from 'cookie';
import {SESSION_COOKIE_NAME, SESSION_SERVICE_BINDING_KEY} from '../services';
import type {SessionService} from '../services';

export class SessionStrategy implements AuthenticationStrategy {
  name = 'session';

  constructor(
    @inject(SESSION_SERVICE_BINDING_KEY) private sessions: SessionService,
  ) {}

  async authenticate(request: Request): Promise<UserProfile | undefined> {
    const token = this.getToken(request);

    if (!token) return undefined;

    return (await this.sessions.getUserProfile(token)) ?? undefined;
  }

  private getToken(request: Request): string | undefined {
    const authorization = request.headers.authorization;

    if (authorization !== undefined) {
      return /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
    }

    return (
      parseCookie(request.headers.cookie ?? '')[SESSION_COOKIE_NAME] ||
      undefined
    );
  }
}
