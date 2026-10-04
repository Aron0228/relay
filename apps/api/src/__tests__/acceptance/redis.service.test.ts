import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {setupApplication} from './test-helper';
import type {RelayApplication} from '../../application';
import type {RedisService} from '../../services';
import {REDIS_SERVICE_BINDING_KEY} from '../../services';

describe('RedisService (acceptance)', () => {
  let app: RelayApplication;
  let redisService: RedisService;

  beforeAll(async () => {
    ({app} = await setupApplication());
    redisService = await app.get<RedisService>(REDIS_SERVICE_BINDING_KEY);
  });

  afterAll(async () => {
    await app?.stop();
  });

  it('discovers the service during boot and resolves the same singleton', async () => {
    expect(redisService).toBeDefined();
    expect(await app.get<RedisService>(REDIS_SERVICE_BINDING_KEY)).toBe(
      redisService,
    );
  });

  it('closes the Redis service when the application stops', async () => {
    const close = vi.spyOn(redisService, 'close');
    try {
      await app.stop();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      close.mockRestore();
    }
  });
});
