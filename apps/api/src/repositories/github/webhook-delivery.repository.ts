import {inject} from '@loopback/core';
import {DefaultCrudRepository} from '@loopback/repository';
import {
  POSTGRES_DATASOURCE_BINDING_KEY,
  PostgresDataSource,
} from '../../datasources';
import {WebhookDelivery} from '../../models';

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
}
