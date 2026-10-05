import {BindingScope, lifeCycleObserver} from '@loopback/core';
import Redis, {RedisOptions} from 'ioredis';

export const REDIS_SERVICE_BINDING_KEY = 'services.RedisService';

@lifeCycleObserver('redis', {scope: BindingScope.SINGLETON})
export class RedisService {
  private client?: Redis;

  private get connectionOptions(): RedisOptions {
    const options: RedisOptions = {maxRetriesPerRequest: 3};

    return {
      ...options,
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
    };
  }

  getClient(): Redis {
    if (!this.client || this.client.status === 'end') {
      this.client = new Redis(this.connectionOptions);
    }
    return this.client;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client || client.status === 'end') return;

    if (client.status !== 'ready') {
      client.disconnect();

      return;
    }

    try {
      await client.quit();
    } finally {
      client.disconnect();
    }
  }

  async stop(): Promise<void> {
    await this.close();
  }
}
