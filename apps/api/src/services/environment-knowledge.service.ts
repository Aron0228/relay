import {BindingScope, injectable, service} from '@loopback/core';
import {repository} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {
  EnvironmentRepository,
  EnvironmentKnowledgeRepository,
  KnowledgePatchRepository,
  RunKnowledgeRepository,
  RunRepository,
  RunEventRepository,
} from '../repositories';
import {
  KnowledgeRequest,
  knowledgePatchSchema,
  knowledgeSearchSchema,
  knowledgeVerificationSchema,
} from '../ai/knowledge-tools';
import {positiveInteger} from '../ai/config';
import {WorkspaceService} from './workspace.service';
import {KnowledgePatchService} from './knowledge-patch.service';

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
    @service(KnowledgePatchService) private patchFlow: KnowledgePatchService,
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

  async history(
    workspaceId: string,
    environmentId: string,
    userId: string,
    offset = 0,
    status?: string,
    result?: string,
  ) {
    await this.environment(workspaceId, environmentId, userId);

    return this.patchFlow.history(environmentId, offset, status, result);
  }

  async patchDetail(
    workspaceId: string,
    environmentId: string,
    userId: string,
    id: string,
    offset = 0,
  ) {
    await this.environment(workspaceId, environmentId, userId);

    return this.patchFlow.detail(environmentId, id, offset);
  }

  async verificationDetail(
    workspaceId: string,
    environmentId: string,
    userId: string,
    patchId: string,
    id: string,
  ) {
    await this.environment(workspaceId, environmentId, userId);

    return this.patchFlow.verificationDetail(environmentId, patchId, id);
  }

  async runPatches(workspaceId: string, runId: string, userId: string) {
    await this.runUsage(workspaceId, runId, userId);

    return this.patchFlow.runUsage(runId);
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

    if (request.operation === 'verification') {
      return this.patchFlow.verify(
        run,
        knowledgeVerificationSchema.parse(request.input),
        leaseToken,
      );
    }
    if (request.operation === 'patch') {
      return this.patchFlow.submit(
        run,
        environment,
        knowledgePatchSchema.parse(request.input),
        leaseToken,
      );
    }

    const input = knowledgeSearchSchema.parse(request.input);
    const currentUrl = new URL(input.currentUrl ?? run.agentInput.targetUrl);
    const origin = new URL(run.agentInput.targetUrl).origin;

    if (currentUrl.origin !== origin)
      throw new Error('Knowledge searches must use the observed target origin');
    if (request.operation === 'patches')
      return this.patchFlow.search(run, currentUrl, input.type);

    if (request.operation === 'search') {
      const target = await this.patchFlow.target(environment);
      const targetOrigin = target.baseUrl
        ? new URL(target.baseUrl).origin
        : origin;
      const records = (await this.knowledge.execute(
        `SELECT id FROM knowledge.environment_knowledge
         WHERE ((environment_id = $1 AND scope_origin = $2) OR (environment_id = $6 AND scope_origin = $7)) AND verification_status <> 'retired'
           AND ($3::text IS NULL OR type = $3)
         ORDER BY (SELECT count(*) FROM regexp_split_to_table(lower($4), '[^[:alnum:]_]+') term
                   WHERE length(term) >= 3 AND strpos(lower(title || ' ' || content), term) > 0) DESC,
           CASE WHEN verification_status = 'verified' THEN 0 ELSE 1 END,
           confidence DESC, updated_at DESC
         LIMIT $5`,
        [
          environment.id,
          origin,
          input.type ?? null,
          input.query,
          this.limit,
          target.id,
          targetOrigin,
        ],
      )) as {id: string}[];
      const selected: Record<string, unknown>[] = [];
      let size = 0;

      for (const item of records) {
        const record = await this.knowledge.findById(item.id);
        const snapshot = {
          ...record.toJSON(),
          referenceOnly:
            record.environmentId !== environment.id ||
            record.scopeOrigin !== origin,
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

    return this.patchFlow.decide(environmentId, id, userId, accept);
  }

  private pattern(query: string) {
    return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  }
}
