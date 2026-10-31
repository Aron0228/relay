import {Entity, model, property} from '@loopback/repository';

export const WEBHOOK_STATUS = {
  Received: 'received',
  Processing: 'processing',
  Processed: 'processed',
  Ignored: 'ignored',
  Rejected: 'rejected',
  Failed: 'failed',
} as const;
export type WebhookStatus =
  (typeof WEBHOOK_STATUS)[keyof typeof WEBHOOK_STATUS];

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
    default: WEBHOOK_STATUS.Received,
    jsonSchema: {enum: Object.values(WEBHOOK_STATUS)},
    postgresql: {dataType: 'text'},
  })
  status!: WebhookStatus;

  @property({type: 'object', required: true, postgresql: {dataType: 'jsonb'}})
  payload!: Record<string, unknown>;

  @property({
    type: 'date',
    required: true,
    defaultFn: 'now',
    postgresql: {columnName: 'received_at', dataType: 'timestamptz'},
  })
  receivedAt!: Date;

  @property({
    type: 'string',
    postgresql: {columnName: 'processing_token', dataType: 'uuid'},
  })
  processingToken?: string | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'lease_expires_at', dataType: 'timestamptz'},
  })
  leaseExpiresAt?: Date | null;

  @property({
    type: 'number',
    postgresql: {columnName: 'attempts', dataType: 'integer'},
    default: 0,
  })
  attempts?: number | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'next_attempt_at', dataType: 'timestamptz'},
  })
  nextAttemptAt?: Date | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'processed_at', dataType: 'timestamptz'},
  })
  processedAt?: Date | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'processing_error', dataType: 'text'},
  })
  processingError?: string | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'task_id', dataType: 'uuid'},
  })
  taskId?: string | null;

  constructor(data?: Partial<WebhookDelivery>) {
    super(data);
  }
}
