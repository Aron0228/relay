import {Request} from '@loopback/rest';
import {parseCookie} from 'cookie';
import {SESSION_COOKIE_NAME} from '../services/session.service';

export function getSessionToken(request: Request): string | undefined {
  const authorization = request.headers.authorization;

  if (authorization !== undefined) {
    return /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
  }

  return (
    parseCookie(request.headers.cookie ?? '')[SESSION_COOKIE_NAME] || undefined
  );
}
