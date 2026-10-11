import {createHmac, randomUUID} from 'node:crypto';
import {vi} from 'vitest';
import type {WebhookDeliveryRepository} from '../../../repositories';
import {setupApplication} from '../../acceptance/test-helper';

export const WEBHOOK_SECRET = 'princess-bubblegum-webhook-secret';
export const WEBHOOK_PATH = '/api/github/webhooks';
export const WEBHOOK_PAYLOAD = JSON.stringify({
  action: 'opened',
  installation: {id: 12345},
  // eslint-disable-next-line @typescript-eslint/naming-convention
  repository: {id: 67890, full_name: 'candy-kingdom/enchiridion'},
  issue: {number: 1, title: 'Finn and Jake save Ooo'},
});

export function signature(body: string, secret = WEBHOOK_SECRET) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export async function setupWebhookTest() {
  vi.stubEnv('GITHUB_WEBHOOK_SECRET', WEBHOOK_SECRET);

  const {app, client} = await setupApplication();

  const deliveries = await app.get<WebhookDeliveryRepository>(
    'repositories.WebhookDeliveryRepository',
  );

  app.getBinding('repositories.WebhookDeliveryRepository').to(deliveries);

  const ids: string[] = [];

  function deliveryId() {
    const id = randomUUID();

    ids.push(id);

    return id;
  }

  function send(id: string, body = WEBHOOK_PAYLOAD, event = 'issues') {
    return client
      .post(WEBHOOK_PATH)
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Delivery', id)
      .set('X-GitHub-Event', event)
      .set('X-Hub-Signature-256', signature(body))
      .send(body);
  }

  async function cleanup() {
    try {
      if (ids.length) {
        await deliveries.deleteAll({deliveryId: {inq: ids}});
      }
    } finally {
      await app.stop();

      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  }

  return {app, client, deliveries, deliveryId, send, cleanup};
}
