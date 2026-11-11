import {
  KnowledgeOperation,
  KnowledgePatchStatus,
} from '../../ai/knowledge-tools';
import {Entity, model, property} from '@loopback/repository';

@model({
  settings: {
    forceId: false,
    postgresql: {schema: 'knowledge', table: 'knowledge_patch'},
  },
})
export class KnowledgePatch extends Entity {
  @property({
    type: 'string',
    id: true,
    generated: true,
    postgresql: {columnName: 'id', dataType: 'uuid'},
  })
  id!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'environment_id', dataType: 'uuid'},
  })
  environmentId!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'knowledge_id', dataType: 'uuid'},
  })
  knowledgeId?: string | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'source_run_id', dataType: 'uuid'},
  })
  sourceRunId!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'request_id', dataType: 'uuid'},
  })
  requestId!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'operation', dataType: 'text'},
  })
  operation!: KnowledgeOperation;

  @property({
    type: 'string',
    postgresql: {columnName: 'status', dataType: 'text'},
  })
  status!: KnowledgePatchStatus;

  @property({
    type: 'number',
    postgresql: {columnName: 'base_version', dataType: 'integer'},
  })
  baseVersion?: number | null;

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
    type: 'object',
    postgresql: {columnName: 'proposal', dataType: 'jsonb'},
  })
  proposal!: Record<string, unknown>;

  @property({
    type: 'object',
    postgresql: {columnName: 'previous', dataType: 'jsonb'},
  })
  previous?: Record<string, unknown> | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt!: Date;

  @property({
    type: 'string',
    postgresql: {columnName: 'decided_by', dataType: 'uuid'},
  })
  decidedBy?: string;

  @property({
    type: 'date',
    postgresql: {columnName: 'decided_at', dataType: 'timestamptz'},
  })
  decidedAt?: Date;

  @property({
    type: 'string',
    postgresql: {columnName: 'source_environment_id', dataType: 'uuid'},
  })
  sourceEnvironmentId?: string | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'source_url', dataType: 'text'},
  })
  sourceUrl?: string | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'scope_origin', dataType: 'text'},
  })
  scopeOrigin?: string | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'scope_path', dataType: 'text'},
  })
  scopePath!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'source_pull_request_id', dataType: 'uuid'},
  })
  sourcePullRequestId?: string | null;

  @property({
    type: 'string',
    postgresql: {columnName: 'applied_verification_id', dataType: 'uuid'},
  })
  appliedVerificationId?: string | null;

  constructor(data?: Partial<KnowledgePatch>) {
    super(data);
  }
}
