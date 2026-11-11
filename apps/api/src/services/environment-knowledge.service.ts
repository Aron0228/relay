import {BindingScope, injectable, service} from '@loopback/core';
import {IsolationLevel, repository} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {
  EnvironmentRepository,
  EnvironmentKnowledgeRepository,
  KnowledgePatchRepository,
  RunKnowledgeRepository,
  RunRepository,
  RunEventRepository,
} from '../repositories';
import {EnvironmentKnowledge} from '../models';
import {
  KnowledgeRequest,
  KnowledgePatchStatus,
  knowledgePatchSchema,
  knowledgeSearchSchema,
} from '../ai/knowledge-tools';
import {positiveInteger} from '../ai/config';
import {WorkspaceService} from './workspace.service';

export const ENVIRONMENT_KNOWLEDGE_SERVICE_BINDING_KEY =
  'services.EnvironmentKnowledgeService';

@injectable({scope: BindingScope.SINGLETON})
export class EnvironmentKnowledgeService {
  private readonly limit = Math.min(
    20,
    positiveInteger('AI_KNOWLEDGE_MAX_RECORDS', 8),
  );
  private readonly maxCharacters = Math.min(
    24000,
    Math.max(0, positiveInteger('AI_MAX_OBSERVATION_CHARACTERS', 12000) - 1024),
    positiveInteger('AI_KNOWLEDGE_MAX_CHARACTERS', 8000),
  );

  constructor(
    @repository(EnvironmentKnowledgeRepository)
    private knowledge: EnvironmentKnowledgeRepository,
    @repository(KnowledgePatchRepository)
    private patches: KnowledgePatchRepository,
    @repository(RunKnowledgeRepository) private usage: RunKnowledgeRepository,
    @repository(RunRepository) private runs: RunRepository,
    @repository(RunEventRepository) private events: RunEventRepository,
    @repository(EnvironmentRepository)
    private environments: EnvironmentRepository,
    @service(WorkspaceService) private workspaces: WorkspaceService,
  ) {}

  async environment(
    workspaceId: string,
    environmentId: string,
    userId: string,
  ) {
    await this.workspaces.requireMember(workspaceId, userId);
    const environment = await this.environments.findOne({
      where: {
        id: environmentId,
        workspaceId,
        deletedAt: {eq: null as unknown as Date},
      },
    });

    if (!environment) throw new HttpErrors.NotFound('Environment not found');

    return environment;
  }

  async list(
    workspaceId: string,
    environmentId: string,
    userId: string,
    query: string,
    type?: string,
    status?: string,
    offset = 0,
  ) {
    await this.environment(workspaceId, environmentId, userId);

    const ids = (await this.knowledge.execute(
      `SELECT id FROM knowledge.environment_knowledge
       WHERE environment_id = $1
         AND ($2 = '' OR title ILIKE $3 ESCAPE '\\' OR content ILIKE $3 ESCAPE '\\')
         AND ($4::text IS NULL OR type = $4)
         AND ($5::text IS NULL OR verification_status = $5 OR
           ($5 = 'stale' AND verification_status <> 'retired' AND
            COALESCE(last_verified_at, updated_at) < now() - interval '30 days'))
       ORDER BY updated_at DESC, id LIMIT 50 OFFSET $6`,
      [
        environmentId,
        query,
        this.pattern(query),
        type ?? null,
        status ?? null,
        offset,
      ],
    )) as {id: string}[];

    return this.knowledge.find({
      where: {id: {inq: ids.map(item => item.id)}},
      order: ['updatedAt DESC', 'id ASC'],
    });
  }

  async detail(
    workspaceId: string,
    environmentId: string,
    userId: string,
    id: string,
  ) {
    await this.environment(workspaceId, environmentId, userId);
    const record = await this.knowledge.findOne({where: {id, environmentId}});

    if (!record) throw new HttpErrors.NotFound('Knowledge not found');

    return {
      record,
      sources: await this.events.find({
        where: {
          id: {inq: record.sourceEventIds},
          runId: record.sourceRunId,
          type: 'agent.evidence',
        },
      }),
      patches: await this.patches.find({
        where: {knowledgeId: id, environmentId},
        order: ['createdAt DESC'],
        limit: 100,
      }),
    };
  }

  async history(workspaceId: string, environmentId: string, userId: string) {
    await this.environment(workspaceId, environmentId, userId);

    return this.patches.find({
      where: {environmentId},
      order: ['createdAt DESC'],
      limit: 100,
    });
  }

  async runUsage(workspaceId: string, runId: string, userId: string) {
    await this.workspaces.requireMember(workspaceId, userId);
    const run = await this.runs.findOne({where: {id: runId, workspaceId}});

    if (!run) throw new HttpErrors.NotFound('Run not found');

    return this.usage.find({
      where: {runId},
      order: ['createdAt ASC'],
      limit: 200,
    });
  }

  async handle(
    runId: string,
    request: KnowledgeRequest,
    leaseToken: string,
  ): Promise<unknown> {
    const run = await this.runs.findById(runId);

    if (
      run.status !== 'running' ||
      run.cancelRequested ||
      !run.workspaceId ||
      !run.environmentId ||
      !run.agentInput
    )
      throw new Error('Knowledge is unavailable for this run');

    const environment = await this.environments.findOne({
      where: {
        id: run.environmentId,
        workspaceId: run.workspaceId,
        deletedAt: {eq: null as unknown as Date},
      },
    });

    if (!environment) throw new Error('Environment is no longer available');

    const active = (await this.runs.execute(
      'SELECT run_id FROM execution.worker_slot WHERE run_id = $1 AND token = $2 AND expires_at > clock_timestamp()',
      [runId, leaseToken],
    )) as object[];

    if (!active.length) throw new Error('Worker lease is no longer active');

    const origin = new URL(run.agentInput.targetUrl).origin;

    if (request.operation === 'search') {
      const input = knowledgeSearchSchema.parse(request.input);
      const records = (await this.knowledge.execute(
        `SELECT id FROM knowledge.environment_knowledge
         WHERE environment_id = $1 AND scope_origin = $2 AND verification_status <> 'retired'
           AND ($3::text IS NULL OR type = $3)
         ORDER BY (SELECT count(*) FROM regexp_split_to_table(lower($4), '[^[:alnum:]_]+') term
                   WHERE length(term) >= 3 AND strpos(lower(title || ' ' || content), term) > 0) DESC,
           CASE WHEN verification_status = 'verified' THEN 0 ELSE 1 END,
           confidence DESC, updated_at DESC
         LIMIT $5`,
        [environment.id, origin, input.type ?? null, input.query, this.limit],
      )) as {id: string}[];
      const selected: Record<string, unknown>[] = [];
      let size = 0;

      for (const item of records) {
        const record = await this.knowledge.findById(item.id);
        const snapshot = {
          ...record.toJSON(),
          stale:
            Date.now() -
              new Date(record.lastVerifiedAt ?? record.updatedAt).getTime() >
            30 * 24 * 60 * 60 * 1000,
        };
        const length = JSON.stringify(snapshot).length;

        if (size + length > this.maxCharacters) continue;

        await this.usage.execute(
          `INSERT INTO knowledge.run_knowledge(run_id, knowledge_id, version, snapshot) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`,
          [runId, record.id, record.version, JSON.stringify(snapshot)],
        );
        selected.push(snapshot);
        size += length;
      }

      return {
        records: selected,
        notice:
          'Historical hints only. Recheck stale or unverified records. Sources are not evidence for the current verdict.',
      };
    }

    const proposal = knowledgePatchSchema.parse(request.input);
    const transaction = await this.knowledge.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );
    const options = {transaction};

    try {
      await this.knowledge.execute(
        "SELECT set_config('statement_timeout', '5000', true), set_config('lock_timeout', '3000', true)",
        [],
        options,
      );

      // Serialize proposals for the environment, including competing creates.
      await this.knowledge.execute(
        'SELECT id FROM auth.environment WHERE id = $1 FOR UPDATE',
        [environment.id],
        options,
      );
      const currentRun = await this.runs.findById(runId, undefined, options);

      if (currentRun.status !== 'running' || currentRun.cancelRequested)
        throw new Error('Run is no longer active');

      const previousPatch = await this.patches.findOne(
        {where: {sourceRunId: runId, requestId: proposal.requestId}},
        options,
      );

      if (previousPatch) {
        if (
          JSON.stringify(knowledgePatchSchema.parse(previousPatch.proposal)) !==
          JSON.stringify(proposal)
        )
          throw new Error('requestId was already used for another proposal');

        await transaction.commit();
        return previousPatch;
      }

      const evidence = await this.events.find(
        {
          where: {
            id: {inq: proposal.sourceEventIds},
            runId,
            type: 'agent.evidence',
          },
        },
        options,
      );

      if (
        new Set(evidence.map(event => event.id)).size !==
        new Set(proposal.sourceEventIds).size
      )
        throw new Error('Knowledge requires existing evidence from this run');

      for (const event of evidence) {
        const url = /^URL: (https?:\/\/[^\s]+)/.exec(
          String(event.payload.observation),
        )?.[1];

        if (!url || new URL(url).origin !== origin)
          throw new Error(
            'Cite browser snapshots from this run and target origin for environment knowledge',
          );
      }

      const matchingIds = proposal.knowledgeId
        ? []
        : ((await this.knowledge.execute(
            "SELECT id FROM knowledge.environment_knowledge WHERE environment_id = $1 AND scope_origin = $2 AND lower(title) = lower($3) AND verification_status <> 'retired'",
            [environment.id, origin, proposal.title],
            options,
          )) as {id: string}[]);
      const recordId = proposal.knowledgeId ?? matchingIds[0]?.id;
      let record: EnvironmentKnowledge | null = recordId
        ? await this.knowledge.findOne(
            {
              where: {
                id: recordId,
                environmentId: environment.id,
                scopeOrigin: origin,
              },
            },
            options,
          )
        : null;
      const previous = record ? {...record.toJSON()} : undefined;
      let status: KnowledgePatchStatus = 'accepted';
      const now = new Date();

      if (proposal.operation === 'create') {
        if (record) status = 'conflict';
        else
          record = await this.knowledge.create(
            {
              environmentId: environment.id,
              scopeOrigin: origin,
              type: proposal.type,
              title: proposal.title,
              content: proposal.content,
              confidence: proposal.confidence,
              verificationStatus: 'unverified',
              version: 1,
              sourceRunId: runId,
              sourceEventIds: proposal.sourceEventIds,
              createdAt: now,
              updatedAt: now,
            },
            options,
          );
      } else {
        if (!record)
          throw new Error(
            'Knowledge not found in this environment and target origin',
          );

        if (
          record.version !== proposal.baseVersion ||
          record.verificationStatus === 'retired'
        )
          status = 'conflict';
        else if (proposal.operation === 'verify') {
          if (
            record.sourceRunId === runId ||
            record.content !== proposal.content ||
            record.type !== proposal.type ||
            record.title !== proposal.title
          )
            throw new Error(
              'Verify requires unchanged knowledge and evidence from a different run',
            );

          const confirmed = await this.patches.findOne(
            {
              where: {
                knowledgeId: record.id,
                sourceRunId: runId,
                operation: 'verify',
                status: 'accepted',
              },
            },
            options,
          );

          if (confirmed)
            throw new Error('This run has already confirmed this knowledge');

          await this.knowledge.updateById(
            record.id,
            {
              verificationStatus: 'verified',
              lastVerifiedAt: now,
              updatedAt: now,
              version: record.version + 1,
            },
            options,
          );
        } else {
          status = 'pending';
        }
      }

      const patch = await this.patches.create(
        {
          environmentId: environment.id,
          knowledgeId: record!.id,
          sourceRunId: runId,
          requestId: proposal.requestId,
          operation: proposal.operation,
          status,
          baseVersion: proposal.baseVersion,
          reason: proposal.reason,
          sourceEventIds: proposal.sourceEventIds,
          proposal,
          previous,
          createdAt: now,
        },
        options,
      );
      const lease = (await this.runs.execute(
        'SELECT run_id FROM execution.worker_slot WHERE run_id = $1 AND token = $2 AND expires_at > clock_timestamp()',
        [runId, leaseToken],
        options,
      )) as object[];

      if (!lease.length)
        throw new Error('Worker lease expired before the patch was stored');

      await transaction.commit();

      return patch;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async decide(
    workspaceId: string,
    environmentId: string,
    userId: string,
    id: string,
    accept: boolean,
  ) {
    await this.environment(workspaceId, environmentId, userId);
    await this.workspaces.requireMember(workspaceId, userId, true);
    const transaction = await this.knowledge.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );
    const options = {transaction};

    try {
      await this.knowledge.execute(
        'SELECT id FROM auth.environment WHERE id = $1 FOR UPDATE',
        [environmentId],
        options,
      );
      const patch = await this.patches.findOne(
        {where: {id, environmentId}},
        options,
      );

      if (!patch) throw new HttpErrors.NotFound('Patch not found');
      if (patch.status !== 'pending')
        throw new HttpErrors.Conflict('Patch is no longer pending');

      const record = await this.knowledge.findById(
        patch.knowledgeId!,
        undefined,
        options,
      );
      const proposal = knowledgePatchSchema.parse(patch.proposal);
      let status: KnowledgePatchStatus = accept ? 'accepted' : 'rejected';
      const now = new Date();

      const duplicateTitle =
        accept && proposal.operation === 'update'
          ? ((await this.knowledge.execute(
              "SELECT id FROM knowledge.environment_knowledge WHERE environment_id = $1 AND scope_origin = $2 AND lower(title) = lower($3) AND verification_status <> 'retired' AND id <> $4",
              [environmentId, record.scopeOrigin, proposal.title, record.id],
              options,
            )) as {id: string}[])
          : [];

      if (
        accept &&
        (record.version !== patch.baseVersion || duplicateTitle.length)
      )
        status = 'conflict';
      else if (accept) {
        await this.knowledge.updateById(
          record.id,
          {
            ...(proposal.operation === 'retire'
              ? {verificationStatus: 'retired'}
              : {
                  type: proposal.type,
                  title: proposal.title,
                  content: proposal.content,
                  confidence: proposal.confidence,
                  verificationStatus: 'unverified',
                  lastVerifiedAt: null,
                }),
            sourceRunId: patch.sourceRunId,
            sourceEventIds: patch.sourceEventIds,
            version: record.version + 1,
            updatedAt: now,
          },
          options,
        );
      }

      await this.patches.updateById(
        id,
        {status, decidedBy: userId, decidedAt: now},
        options,
      );
      await transaction.commit();

      return {status};
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private pattern(query: string) {
    return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  }
}
