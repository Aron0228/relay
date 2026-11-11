import {KnowledgeType, KnowledgeStatus} from '../../ai/knowledge-tools';
import {Entity, model, property} from '@loopback/repository';

@model({
  settings: {
    forceId: false,
    postgresql: {schema: 'knowledge', table: 'environment_knowledge'},
  },
})
export class EnvironmentKnowledge extends Entity {
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
    postgresql: {columnName: 'scope_origin', dataType: 'text'},
  })
  scopeOrigin!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'type', dataType: 'text'},
  })
  type!: KnowledgeType;

  @property({
    type: 'string',
    postgresql: {columnName: 'title', dataType: 'text'},
  })
  title!: string;

  @property({
    type: 'string',
    postgresql: {columnName: 'content', dataType: 'text'},
  })
  content!: string;

  @property({
    type: 'number',
    postgresql: {columnName: 'confidence', dataType: 'double precision'},
  })
  confidence!: number;

  @property({
    type: 'string',
    postgresql: {columnName: 'verification_status', dataType: 'text'},
  })
  verificationStatus!: KnowledgeStatus;

  @property({
    type: 'number',
    postgresql: {columnName: 'version', dataType: 'integer'},
  })
  version!: number;

  @property({
    type: 'string',
    postgresql: {columnName: 'source_run_id', dataType: 'uuid'},
  })
  sourceRunId!: string;

  @property({
    type: 'array',
    itemType: 'string',
    postgresql: {columnName: 'source_event_ids', dataType: 'jsonb'},
  })
  sourceEventIds!: string[];

  @property({
    type: 'date',
    postgresql: {columnName: 'last_verified_at', dataType: 'timestamptz'},
  })
  lastVerifiedAt?: Date | null;

  @property({
    type: 'date',
    postgresql: {columnName: 'created_at', dataType: 'timestamptz'},
  })
  createdAt!: Date;

  @property({
    type: 'date',
    postgresql: {columnName: 'updated_at', dataType: 'timestamptz'},
  })
  updatedAt!: Date;

  constructor(data?: Partial<EnvironmentKnowledge>) {
    super(data);
  }
}
