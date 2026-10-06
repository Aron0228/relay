import {Entity, model, property} from '@loopback/repository';

@model({settings: {postgresql: {schema: 'github', table: 'webhook_delivery'}}})
export class WebhookDelivery extends Entity {
  @property({
    type: 'string',
    id: true,
    generated: true,
    postgresql: {dataType: 'uuid'},
  })
  id!: string;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'delivery_id', dataType: 'uuid'},
  })
  deliveryId!: string;

  @property({
    type: 'string',
    required: true,
    postgresql: {columnName: 'event_type', dataType: 'text'},
  })
  eventType!: string;

  @property({
    type: 'string',
    required: true,
    default: 'received',
    postgresql: {dataType: 'text'},
  })
  status!: string;

  @property({type: 'object', required: true, postgresql: {dataType: 'jsonb'}})
  payload!: Record<string, unknown>;

  @property({
    type: 'date',
    required: true,
    defaultFn: 'now',
    postgresql: {columnName: 'received_at', dataType: 'timestamptz'},
  })
  receivedAt!: Date;

  constructor(data?: Partial<WebhookDelivery>) {
    super(data);
  }
}
