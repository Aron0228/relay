import {gzipSync} from 'node:zlib';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {setupApplication} from '../acceptance/test-helper';
import {
  setupWebhookTest,
  signature,
  WEBHOOK_PATH,
  WEBHOOK_PAYLOAD,
} from './helpers/github-webhook';

describe('GitHub webhook security (e2e)', () => {
  let test: Awaited<ReturnType<typeof setupWebhookTest>>;

  beforeAll(async () => {
    test = await setupWebhookTest();
  });

  afterAll(async () => {
    await test?.cleanup();
  });

  it.each(['missing', 'malformed', 'short', 'sha1', 'wrong-secret'])(
    'rejects a %s signature without logging an event',
    async invalid => {
      const id = test.deliveryId();
      const request = test.send(id);
      const invalidSignatures: Record<string, string> = {
        'wrong-secret': signature(WEBHOOK_PAYLOAD, 'ice-king-secret'),
        sha1: `sha1=${'a'.repeat(40)}`,
        short: 'sha256=abc',
        malformed: `sha256=${'z'.repeat(64)}`,
      };

      if (invalid === 'missing') {
        request.unset('X-Hub-Signature-256');
      } else {
        request.set('X-Hub-Signature-256', invalidSignatures[invalid]);
      }

      await request.expect(401);

      expect((await test.deliveries.count({deliveryId: id})).count).toBe(0);
    },
  );

  it('rejects payload tampering even when the JSON remains valid', async () => {
    const id = test.deliveryId();

    await test
      .send(id, WEBHOOK_PAYLOAD.replace('opened', 'closed'))
      .set('X-Hub-Signature-256', signature(WEBHOOK_PAYLOAD))
      .expect(401);

    expect((await test.deliveries.count({deliveryId: id})).count).toBe(0);
  });

  it('verifies the exact whitespace and Unicode bytes rather than reserialized JSON', async () => {
    const id = test.deliveryId();
    const body =
      '{\n  "message": "BMO szereti Óóó földjét", "action" : "opened"\n}\n';

    await test.send(id, body).expect(200);
    await test
      .send(id, body)
      .set('X-Hub-Signature-256', signature(JSON.stringify(JSON.parse(body))))
      .expect(401);

    expect((await test.deliveries.count({deliveryId: id})).count).toBe(1);
  });

  it.each(['X-GitHub-Delivery', 'X-GitHub-Event'])(
    'requires the %s header',
    async header => {
      const id = test.deliveryId();

      await test.send(id).unset(header).expect(400);

      expect((await test.deliveries.count({deliveryId: id})).count).toBe(0);
    },
  );

  it.each(['X-GitHub-Delivery', 'X-GitHub-Event'])(
    'rejects malformed %s metadata',
    async header => {
      const id = test.deliveryId();

      await test
        .send(id)
        .set(header, "'; DROP TABLE github.webhook_delivery; --")
        .expect(400);

      expect((await test.deliveries.count({deliveryId: id})).count).toBe(0);
    },
  );

  it.each(['{broken', '[]', 'null', '42', '"BMO"'])(
    'rejects invalid or non-object JSON: %s',
    async body => {
      const id = test.deliveryId();

      await test.send(id, body).expect(400);

      expect((await test.deliveries.count({deliveryId: id})).count).toBe(0);
    },
  );

  it('does not let an unsigned replay bypass signature verification', async () => {
    const id = test.deliveryId();

    await test.send(id).expect(200);

    await test.send(id).unset('X-Hub-Signature-256').expect(401);

    expect((await test.deliveries.count({deliveryId: id})).count).toBe(1);
  });

  it('rejects unsupported content types', async () => {
    const id = test.deliveryId();

    await test.send(id).set('Content-Type', 'text/plain').expect(415);

    expect((await test.deliveries.count({deliveryId: id})).count).toBe(0);
  });

  it('rejects compressed bodies so verification uses the actual delivery bytes', async () => {
    const id = test.deliveryId();

    await test.client
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .set('X-GitHub-Delivery', id)
      .set('X-GitHub-Event', 'issues')
      .set('X-Hub-Signature-256', signature(WEBHOOK_PAYLOAD))
      .send(gzipSync(WEBHOOK_PAYLOAD))
      .expect(415);

    expect((await test.deliveries.count({deliveryId: id})).count).toBe(0);
  });

  it('rejects bodies over 25 MB before logging', async () => {
    const id = test.deliveryId();
    const body = JSON.stringify({message: 'B'.repeat(25 * 1024 * 1024)});

    await test.send(id, body).expect(413);

    expect((await test.deliveries.count({deliveryId: id})).count).toBe(0);
  });

  it('fails closed when the webhook secret is missing', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', '');
    const {app, client} = await setupApplication();
    const id = test.deliveryId();

    try {
      await client
        .post(WEBHOOK_PATH)
        .set('Content-Type', 'application/json')
        .set('X-GitHub-Delivery', id)
        .set('X-GitHub-Event', 'issues')
        .set('X-Hub-Signature-256', signature(WEBHOOK_PAYLOAD))
        .send(WEBHOOK_PAYLOAD)
        .expect(503);

      expect((await test.deliveries.count({deliveryId: id})).count).toBe(0);
    } finally {
      await app.stop();
    }
  });
});
