import {BindingScope, injectable, service} from '@loopback/core';
import {securityId, UserProfile} from '@loopback/security';
import {createHash, randomBytes} from 'node:crypto';
import {Session, User} from '../models';
import {SessionStoreService} from './session-store.service';

export const SESSION_SERVICE_BINDING_KEY = 'services.SessionService';

export interface CreatedSession {
  token: string;
  session: Session;
}

@injectable({scope: BindingScope.SINGLETON})
export class SessionService {
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
