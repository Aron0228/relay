import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {redisConstructor} = vi.hoisted(() => ({redisConstructor: vi.fn()}));
vi.mock('ioredis', () => ({default: redisConstructor}));

import {RedisService} from '../../../services/redis.service';

describe('RedisService (unit)', () => {
  let service: RedisService;
  let client: {
    status: string;
    quit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    for (const key of [
      'REDIS_HOST',
      'REDIS_PORT',
      'REDIS_USERNAME',
      'REDIS_PASSWORD',
    ]) {
      vi.stubEnv(key, undefined);
    }
    client = {
      status: 'ready',
      quit: vi.fn().mockResolvedValue('OK'),
      disconnect: vi.fn(),
    };
    redisConstructor.mockReset();
    redisConstructor.mockImplementation(function () {
      return client;
    });
    service = new RedisService();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('does not connect until the client is requested', () => {
    expect(redisConstructor).not.toHaveBeenCalled();
  });

  it('uses local defaults when no connection settings are provided', () => {
    service.getClient();
    expect(redisConstructor).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 6379,
      username: undefined,
      password: undefined,
      maxRetriesPerRequest: 3,
    });
  });

  it('reads configured host, port, and credentials on first use', () => {
    vi.stubEnv('REDIS_HOST', 'redis.internal');
    vi.stubEnv('REDIS_PORT', '6380');
    vi.stubEnv('REDIS_USERNAME', 'default');
    vi.stubEnv('REDIS_PASSWORD', 'secret');
    service.getClient();
    expect(redisConstructor).toHaveBeenCalledWith({
      host: 'redis.internal',
      port: 6380,
      username: 'default',
      password: 'secret',
      maxRetriesPerRequest: 3,
    });
  });

  it.each(['ready', 'connecting', 'reconnecting'])(
    'reuses a client whose status is %s',
    status => {
      client.status = status;
      const first = service.getClient();
      expect(service.getClient()).toBe(first);
      expect(redisConstructor).toHaveBeenCalledOnce();
    },
  );

  it('replaces a client that has ended', () => {
    const first = service.getClient();
    client.status = 'end';
    const replacement = {...client, status: 'ready'};
    redisConstructor.mockImplementationOnce(function () {
      return replacement;
    });
    expect(service.getClient()).toBe(replacement);
    expect(service.getClient()).not.toBe(first);
    expect(redisConstructor).toHaveBeenCalledTimes(2);
  });

  it('allows repeated close calls before connecting', async () => {
    await service.close();
    await service.close();
    expect(redisConstructor).not.toHaveBeenCalled();
  });

  it('quits a ready client and disconnects it only once', async () => {
    service.getClient();
    await service.close();
    await service.close();
    expect(client.quit).toHaveBeenCalledOnce();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it.each(['connecting', 'reconnecting', 'close', 'wait'])(
    'disconnects a %s client without queuing QUIT',
    async status => {
      client.status = status;
      service.getClient();
      await service.close();
      expect(client.quit).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledOnce();
    },
  );

  it('leaves an already ended client alone during close', async () => {
    service.getClient();
    client.status = 'end';
    await service.close();
    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects even if QUIT fails and preserves the error', async () => {
    const error = new Error('Redis connection lost');
    client.quit.mockRejectedValueOnce(error);
    service.getClient();
    await expect(service.close()).rejects.toBe(error);
    expect(client.disconnect).toHaveBeenCalledOnce();
    await service.close();
    expect(client.quit).toHaveBeenCalledOnce();
  });

  it('can create a fresh client after closing', async () => {
    const first = service.getClient();
    await service.close();
    const replacement = {...client};
    redisConstructor.mockImplementationOnce(function () {
      return replacement;
    });
    expect(service.getClient()).toBe(replacement);
    expect(service.getClient()).not.toBe(first);
  });

  it('releases the client when stopped', async () => {
    service.getClient();
    await service.stop();
    expect(client.quit).toHaveBeenCalledOnce();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});
