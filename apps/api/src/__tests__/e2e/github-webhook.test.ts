import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {setupWebhookTest, WEBHOOK_PAYLOAD} from './helpers/github-webhook';

describe('GitHub webhook (e2e)', () => {
  let test: Awaited<ReturnType<typeof setupWebhookTest>>;

  beforeAll(async () => {
    test = await setupWebhookTest();
  });

  afterAll(async () => {
    await test?.cleanup();
  });

  it('records Finn’s signed event before acknowledging it', async () => {
    const id = test.deliveryId();
    const before = Date.now();

    const response = await test.send(id).expect(200);
    const delivery = await test.deliveries.findOne({where: {deliveryId: id}});

    expect(response.body).toEqual({duplicate: false});
    expect(delivery).toMatchObject({
      deliveryId: id,
      eventType: 'issues',
      status: 'received',
      payload: JSON.parse(WEBHOOK_PAYLOAD),
    });
    expect(delivery!.receivedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('deduplicates a replay without changing the original event', async () => {
    const id = test.deliveryId();

    await test.send(id).expect(200);

    const before = await test.deliveries.findOne({where: {deliveryId: id}});

    const replay = await test
      .send(id, JSON.stringify({action: 'closed'}), 'pull_request')
      .expect(200);

    expect(replay.body).toEqual({duplicate: true});
    expect((await test.deliveries.count({deliveryId: id})).count).toBe(1);
    expect(
      (await test.deliveries.findOne({where: {deliveryId: id}}))!.toJSON(),
    ).toEqual(before!.toJSON());
  });

  it('records exactly one of BMO’s simultaneous deliveries', async () => {
    const id = test.deliveryId();

    const responses = await Promise.all(
      Array.from({length: 6}, () => test.send(id)),
    );

    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(responses.filter(response => !response.body.duplicate)).toHaveLength(
      1,
    );
    expect(responses.filter(response => response.body.duplicate)).toHaveLength(
      5,
    );
    expect((await test.deliveries.count({deliveryId: id})).count).toBe(1);
  });

  it('accepts distinct deliveries with identical payloads', async () => {
    for (const id of [test.deliveryId(), test.deliveryId()]) {
      const response = await test.send(id).expect(200);

      expect(response.body.duplicate).toBe(false);
    }
  });

  it.each(['ping', 'installation', 'future_github_event'])(
    'logs %s events without requiring a repository',
    async event => {
      const id = test.deliveryId();

      await test.send(id, '{"zen":"Algebraic!"}', event).expect(200);

      expect(
        await test.deliveries.findOne({where: {deliveryId: id}}),
      ).toMatchObject({eventType: event, payload: {zen: 'Algebraic!'}});
    },
  );

  it('returns an error if storage fails, allowing GitHub to retry', async () => {
    const id = test.deliveryId();
    const record = vi
      .spyOn(test.deliveries, 'record')
      .mockRejectedValueOnce(new Error('Ice King froze PostgreSQL'));

    try {
      await test.send(id).expect(500);
      expect((await test.deliveries.count({deliveryId: id})).count).toBe(0);
    } finally {
      record.mockRestore();
    }

    expect((await test.send(id).expect(200)).body).toEqual({duplicate: false});
  });
});
