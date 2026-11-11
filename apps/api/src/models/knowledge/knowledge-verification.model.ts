import {KnowledgeVerificationResult} from '../../ai/knowledge-tools';
import {Entity, model, property} from '@loopback/repository';

@model({
  settings: {
    forceId: false,
    postgresql: {schema: 'knowledge', table: 'knowledge_verification'},
  },
})
export class KnowledgeVerification extends Entity {
  @property({
    type: 'string',
    id: true,
    generated: true,
    postgresql: {columnName: 'id', dataType: 'uuid'},
  })
  id!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'patch_id', dataType: 'uuid'},
  })
  patchId!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'knowledge_id', dataType: 'uuid'},
  })
  knowledgeId?: string | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'run_id', dataType: 'uuid'},
  })
  runId!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'request_id', dataType: 'uuid'},
  })
  requestId!: string;

  @property({
    type: 'number',
    postgresql: {columnName: 'base_version', dataType: 'integer'},
  })
  baseVersion?: number | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'result', dataType: 'text'},
  })
  result!: KnowledgeVerificationResult;

  @property({
    type: 'number',
    postgresql: {columnName: 'confidence', dataType: 'double precision'},
  })
  confidence!: number;

  @property({
    type: 'string',
    postgresql: {columnName: 'reason', dataType: 'text'},
  })
  reason!: string;

  @property({
    type: 'array',
    itemType: 'string',
    postgresql: {columnName: 'source_event_ids', dataType: 'jsonb'},
  })
  sourceEventIds!: string[];

  @property({
    type: 'array',
    itemType: 'string',
    postgresql: {columnName: 'observed_urls', dataType: 'jsonb'},
  })
  observedUrls!: string[];

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt!: Date;

  @property({type: 'number', generated: true, postgresql: {dataType: 'bigint'}})
  sequence!: number;

  constructor(data?: Partial<KnowledgeVerification>) {
    super(data);
  }
}
