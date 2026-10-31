import {randomUUID} from 'node:crypto';
import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {WebhookDelivery, WebhookStatus, WEBHOOK_STATUS} from '../../models';

export const WEBHOOK_DELIVERY_REPOSITORY_BINDING_KEY =
  'repositories.WebhookDeliveryRepository';

export class WebhookDeliveryRepository extends DefaultCrudRepository<
  WebhookDelivery,
  typeof WebhookDelivery.prototype.id
> {
  constructor(
    @inject(POSTGRES_DATASOURCE_BINDING_KEY) dataSource: PostgresDataSource,
  ) {
    super(WebhookDelivery, dataSource);
  }

  async record(
    deliveryId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const rows = (await this.dataSource.execute(
      `INSERT INTO github.webhook_delivery (delivery_id, event_type, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (delivery_id) DO NOTHING RETURNING id`,
      [deliveryId, eventType, JSON.stringify(payload)],
    )) as {id: string}[];

    return rows.length > 0;
  }
  async claim(
    deliveryId: string,
    leaseMs: number,
  ): Promise<WebhookDelivery | null> {
    const token = randomUUID();
    const rows = (await this.dataSource.execute(
      `WITH claimed AS (UPDATE github.webhook_delivery
       SET status = 'processing', processing_token = $2, lease_expires_at = now() + ($3::int * interval '1 millisecond'), attempts = attempts + 1
       WHERE delivery_id = $1 AND event_type = 'issue_comment'
         AND ((status IN ('received', 'failed') AND next_attempt_at <= now())
           OR (status = 'processing' AND lease_expires_at <= now()))
       RETURNING id, delivery_id AS "deliveryId", event_type AS "eventType", payload, status, attempts, received_at AS "receivedAt", lease_expires_at AS "leaseExpiresAt", processing_token AS "processingToken") SELECT * FROM claimed`,
      [deliveryId, token, leaseMs],
    )) as Partial<WebhookDelivery>[];

    return rows.length ? new WebhookDelivery(rows[0]) : null;
  }

  due(limit: number) {
    const now = new Date();

    return this.find({
      where: {
        eventType: 'issue_comment',
        or: [
          {
            status: {inq: [WEBHOOK_STATUS.Received, WEBHOOK_STATUS.Failed]},
            nextAttemptAt: {lte: now},
          },
          {status: WEBHOOK_STATUS.Processing, leaseExpiresAt: {lte: now}},
        ],
      },
      order: ['receivedAt ASC'],
      limit,
    });
  }

  async settle(
    delivery: WebhookDelivery,
    status: WebhookStatus,
    error?: string,
    taskId?: string,
  ) {
    const delaySeconds = Math.min(
      300,
      5 * 2 ** Math.min(delivery.attempts ?? 1, 6),
    );

    await this.updateAll(
      {
        status,
        processingToken: null,
        leaseExpiresAt: null,
        processingError: error ?? null,
        taskId: taskId ?? null,
        processedAt: status === WEBHOOK_STATUS.Failed ? null : new Date(),
        nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
      },
      {id: delivery.id, processingToken: delivery.processingToken!},
    );
  }
}
