import {BindingScope, injectable} from '@loopback/core';
import {repository} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {WebhookDeliveryRepository} from '../repositories';

export const GITHUB_WEBHOOK_SERVICE_BINDING_KEY =
  'services.GithubWebhookService';

@injectable({scope: BindingScope.SINGLETON})
export class GithubWebhookService {
  private readonly secret = process.env.GITHUB_WEBHOOK_SECRET;

  constructor(
    @repository(WebhookDeliveryRepository)
    private deliveries: WebhookDeliveryRepository,
  ) {}

  async receive(
    body: Buffer,
    signature?: string,
    deliveryId?: string,
    eventType?: string,
  ): Promise<{duplicate: boolean}> {
    if (!this.secret) {
      throw new HttpErrors.ServiceUnavailable(
        'GitHub webhooks are not configured',
      );
    }

    if (!signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) {
      throw new HttpErrors.Unauthorized('Invalid webhook signature');
    }

    const expected = createHmac('sha256', this.secret).update(body).digest();

    if (
      !timingSafeEqual(
        expected,
        Buffer.from(signature.slice('sha256='.length), 'hex'),
      )
    ) {
      console.log('tst', Buffer.from(signature.slice('sha256='.length), 'hex'));
      throw new HttpErrors.Unauthorized('Invalid webhook signature');
    }

    if (
      !deliveryId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        deliveryId,
      )
    ) {
      throw new HttpErrors.BadRequest(
        'A valid X-GitHub-Delivery header is required',
      );
    }

    if (!eventType || !/^[a-z][a-z0-9_]{0,99}$/.test(eventType)) {
      throw new HttpErrors.BadRequest(
        'A valid X-GitHub-Event header is required',
      );
    }

    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      throw new HttpErrors.BadRequest('Invalid webhook JSON');
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new HttpErrors.BadRequest('Webhook payload must be a JSON object');
    }

    const recorded = await this.deliveries.record(
      deliveryId,
      eventType,
      payload,
    );

    return {
      duplicate: !recorded,
    };
  }
}
