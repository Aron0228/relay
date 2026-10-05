import {BindingScope, injectable, service} from '@loopback/core';
import {DataObject, repository} from '@loopback/repository';
import {securityId} from '@loopback/security';
import Redis from 'ioredis';
import {Session} from '../models';
import {SessionRepository} from '../repositories';
import {RedisService} from './redis.service';

export const SESSION_STORE_SERVICE_BINDING_KEY = 'services.SessionStoreService';

export type SessionUpdate = Partial<
  Pick<Session, 'userProfile' | 'expiresAt' | 'absoluteExpiresAt' | 'revokedAt'>
>;

type SerializedSession = Pick<Session, 'id' | 'userId' | 'tokenHash'> & {
  userProfile: Omit<Session['userProfile'], symbol>;
  createdAt: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  revokedAt?: string | null;
};

@injectable({scope: BindingScope.SINGLETON})
export class SessionStoreService {
  constructor(
    @service(RedisService) private redisService: RedisService,
    @repository(SessionRepository) private sessionRepository: SessionRepository,
  ) {}

  async create(data: DataObject<Session>): Promise<Session> {
    const session = await this.sessionRepository.create(data);

    await this.cacheSession(session);

    return session;
  }

  async get(tokenHash: string): Promise<Session | null> {
    const cached = await this.withRedis(client =>
      client.get(this.cacheKey(tokenHash)),
    );

    if (cached) {
      const session = this.deserializeSession(cached);
      if (session) return session;
    }

    return this.loadFromPostgres(tokenHash);
  }

  private async loadFromPostgres(tokenHash: string): Promise<Session | null> {
    const session = await this.sessionRepository.findOne({where: {tokenHash}});

    if (session) {
      await this.cacheSession(session);
    } else {
      await this.removeCachedSession(tokenHash);
    }

    return session;
  }

  async update(
    tokenHash: string,
    data: SessionUpdate,
  ): Promise<Session | null> {
    const {count} = await this.sessionRepository.updateAll(data, {tokenHash});
    await this.removeCachedSession(tokenHash);

    if (!count) {
      return null;
    }

    return this.loadFromPostgres(tokenHash);
  }

  async delete(tokenHash: string): Promise<void> {
    await this.sessionRepository.deleteAll({tokenHash});

    await this.removeCachedSession(tokenHash);
  }

  private cacheKey(tokenHash: string): string {
    return `relay:session:${tokenHash}`;
  }

  private deserializeSession(value: string): Session | null {
    try {
      const data = JSON.parse(value) as SerializedSession;
      const session = new Session({
        ...data,
        userProfile: {...data.userProfile, [securityId]: data.userId},
        createdAt: new Date(data.createdAt),
        expiresAt: new Date(data.expiresAt),
        absoluteExpiresAt: new Date(data.absoluteExpiresAt),
        revokedAt: data.revokedAt ? new Date(data.revokedAt) : null,
      });

      if (
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now() ||
        session.absoluteExpiresAt.getTime() <= Date.now()
      ) {
        return null;
      }

      return session;
    } catch {
      return null;
    }
  }

  private async cacheSession(session: Session): Promise<void> {
    const expiresAt = Math.min(
      session.expiresAt.getTime(),
      session.absoluteExpiresAt.getTime(),
    );

    if (session.revokedAt || expiresAt <= Date.now()) {
      await this.removeCachedSession(session.tokenHash);
      return;
    }

    await this.withRedis(client =>
      client.set(
        this.cacheKey(session.tokenHash),
        JSON.stringify(session.toJSON()),
        'PXAT',
        expiresAt,
      ),
    );
  }

  private async removeCachedSession(tokenHash: string): Promise<void> {
    await this.withRedis(client => client.del(this.cacheKey(tokenHash)));
  }

  private async withRedis<T>(
    operation: (client: Redis) => Promise<T>,
  ): Promise<T | undefined> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const client = this.redisService.getClient();

      if (client.status !== 'ready') return;

      return await Promise.race([
        operation(client),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Session cache operation timed out')),
            1000,
          );
        }),
      ]);
    } catch {
      console.warn('Session cache unavailable; using PostgreSQL.');

      return undefined;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
