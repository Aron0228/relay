import {BindingScope, injectable} from '@loopback/core';
import {IsolationLevel, repository, Transaction} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {
  EnvironmentRepository,
  EnvironmentKnowledgeRepository,
  KnowledgePatchRepository,
  KnowledgeVerificationRepository,
  RunPatchRepository,
  RunRepository,
  RunEventRepository,
  GithubRepositoryRepository,
  TaskRepository,
} from '../repositories';
import {
  Environment,
  KnowledgePatch,
  KnowledgeVerification,
  Run,
} from '../models';
import {
  KnowledgeProposal,
  KnowledgeVerificationInput,
  KnowledgeVerificationSummary,
  knowledgePatchSchema,
} from '../ai/knowledge-tools';
import {
  commonKnowledgePath,
  coversKnowledgePath,
  knowledgePath,
} from '../ai/knowledge-scope';
import {positiveInteger} from '../ai/config';

export const KNOWLEDGE_PATCH_SERVICE_BINDING_KEY =
  'services.KnowledgePatchService';

@injectable({scope: BindingScope.SINGLETON})
export class KnowledgePatchService {
  private readonly limit = Math.min(
    10,
    positiveInteger('AI_KNOWLEDGE_MAX_PATCHES', 5),
  );
  private readonly maxCharacters = Math.min(
    12000,
    Math.max(0, positiveInteger('AI_MAX_OBSERVATION_CHARACTERS', 12000) - 1024),
    positiveInteger('AI_KNOWLEDGE_PATCH_CHARACTERS', 6000),
  );
  private readonly autoApply = process.env.AI_KNOWLEDGE_AUTO_APPLY !== 'false';

  constructor(
    @repository(EnvironmentRepository)
    private environments: EnvironmentRepository,
    @repository(EnvironmentKnowledgeRepository)
    private knowledge: EnvironmentKnowledgeRepository,
    @repository(KnowledgePatchRepository)
    private patches: KnowledgePatchRepository,
    @repository(KnowledgeVerificationRepository)
    private verifications: KnowledgeVerificationRepository,
    @repository(RunPatchRepository) private usage: RunPatchRepository,
    @repository(RunRepository) private runs: RunRepository,
    @repository(RunEventRepository) private events: RunEventRepository,
    @repository(GithubRepositoryRepository)
    private repositories: GithubRepositoryRepository,
    @repository(TaskRepository) private tasks: TaskRepository,
  ) {}

  async target(environment: Environment): Promise<Environment> {
    if (!environment.repositoryId) return environment;

    const connectedRepository = await this.repositories.findOne({
      where: {
        id: environment.repositoryId,
        workspaceId: environment.workspaceId,
        disconnectedAt: {eq: null as unknown as Date},
      },
    });
    if (!connectedRepository?.defaultEnvironmentId) return environment;

    return (
      (await this.environments.findOne({
        where: {
          id: connectedRepository.defaultEnvironmentId,
          repositoryId: connectedRepository.id,
          workspaceId: environment.workspaceId,
          deletedAt: {eq: null as unknown as Date},
        },
      })) ?? environment
    );
  }

  async search(run: Run, currentUrl: URL, type?: string) {
    const rows = (await this.patches.execute(
      `SELECT p.id FROM knowledge.knowledge_patch p
       WHERE p.environment_id = $1 AND p.scope_origin = $2 AND p.status = 'pending'
         AND p.source_run_id <> $3 AND ($4::text IS NULL OR p.proposal->>'type' = $4)
         AND COALESCE((SELECT v.result FROM knowledge.knowledge_verification v WHERE v.patch_id=p.id ORDER BY v.sequence DESC LIMIT 1), '') <> 'confirmed'
         AND (p.scope_path = '/' OR p.scope_path = $5
           OR left($5, length(p.scope_path) + 1) = p.scope_path || '/')
       ORDER BY (SELECT count(*) FROM knowledge.knowledge_verification v WHERE v.patch_id = p.id), p.created_at, p.id
       LIMIT $6`,
      [
        run.environmentId,
        currentUrl.origin,
        run.id,
        type ?? null,
        knowledgePath(currentUrl.pathname),
        this.limit,
      ],
    )) as {id: string}[];
    const selected: object[] = [];
    let size = 0;

    for (const row of rows) {
      const patch = await this.patches.findById(row.id);
      const latest = await this.latest(patch.id);
      const proposal = knowledgePatchSchema.parse(patch.proposal);
      const snapshot = {
        id: patch.id,
        environmentId: patch.environmentId,
        knowledgeId: patch.knowledgeId,
        operation: patch.operation,
        baseVersion: patch.baseVersion,
        scopeOrigin: patch.scopeOrigin,
        scopePath: patch.scopePath,
        sourceEnvironmentId: patch.sourceEnvironmentId,
        sourceUrl: patch.sourceUrl,
        sourceRunId: patch.sourceRunId,
        sourcePullRequestId: patch.sourcePullRequestId,
        proposal: {
          type: proposal.type,
          title: proposal.title,
          content: proposal.content,
        },
        reason: patch.reason.slice(0, 500),
        latestVerification: latest
          ? {
              result: latest.result,
              reason: latest.reason.slice(0, 500),
              createdAt: latest.createdAt,
            }
          : undefined,
      };
      const length = JSON.stringify(snapshot).length;

      if (size + length > this.maxCharacters) continue;

      await this.usage.execute(
        'INSERT INTO knowledge.run_patch(run_id, patch_id, snapshot) VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING',
        [run.id, patch.id, JSON.stringify(snapshot)],
      );
      selected.push(snapshot);
      size += length;
    }

    return {
      patches: selected,
      notice:
        "Unconfirmed hypotheses only. Check them opportunistically on this route, using this run's observations. Deployment delay may mean inconclusive.",
    };
  }

  async submit(
    run: Run,
    source: Environment,
    proposal: KnowledgeProposal,
    token: string,
  ) {
    const target = await this.target(source);
    const transaction = await this.patches.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );
    const options = {transaction};

    try {
      await this.lock(target.id, transaction);
      await this.requireLease(run.id, token, transaction);
      const repeated = await this.patches.findOne(
        {where: {sourceRunId: run.id, requestId: proposal.requestId}},
        options,
      );

      if (repeated) {
        if (
          JSON.stringify(knowledgePatchSchema.parse(repeated.proposal)) !==
          JSON.stringify(proposal)
        )
          throw new Error('requestId was already used for another proposal');

        await transaction.commit();
        return repeated;
      }

      const urls = await this.evidence(
        run,
        proposal.sourceEventIds,
        transaction,
      );
      const scopePath = proposal.scopePath
        ? knowledgePath(proposal.scopePath)
        : commonKnowledgePath(urls);

      if (urls.some(url => !coversKnowledgePath(scopePath, url.pathname)))
        throw new Error(
          'The proposed scopePath must cover its cited browser observations',
        );

      const scopeOrigin = target.baseUrl
        ? new URL(target.baseUrl).origin
        : new URL(run.agentInput!.targetUrl).origin;
      const matching = proposal.knowledgeId
        ? []
        : ((await this.knowledge.execute(
            "SELECT id FROM knowledge.environment_knowledge WHERE environment_id=$1 AND scope_origin=$2 AND lower(title)=lower($3) AND verification_status <> 'retired'",
            [target.id, scopeOrigin, proposal.title],
            options,
          )) as {id: string}[]);
      const id = proposal.knowledgeId ?? matching[0]?.id;
      const record = id
        ? await this.knowledge.findOne(
            {where: {id, environmentId: target.id, scopeOrigin}},
            options,
          )
        : null;
      let status: KnowledgePatch['status'] = 'pending';
      const now = new Date();

      if (proposal.operation === 'create') {
        if (record) status = 'conflict';
      } else {
        if (!record)
          throw new Error('Knowledge not found in the target environment');
        if (
          record.version !== proposal.baseVersion ||
          record.verificationStatus === 'retired'
        )
          status = 'conflict';
        else if (proposal.operation === 'verify') {
          if (
            source.id !== target.id ||
            new URL(run.agentInput!.targetUrl).origin !== record.scopeOrigin ||
            record.sourceRunId === run.id ||
            record.content !== proposal.content ||
            record.title !== proposal.title ||
            record.type !== proposal.type ||
            urls.some(
              url => !coversKnowledgePath(record.scopePath, url.pathname),
            )
          )
            throw new Error(
              'Verify requires unchanged knowledge independently observed on its target route and environment',
            );

          const previousConfirmation = await this.patches.findOne(
            {
              where: {
                sourceRunId: run.id,
                knowledgeId: record.id,
                operation: 'verify',
                status: 'accepted',
              },
            },
            options,
          );
          if (previousConfirmation)
            throw new Error('This run has already confirmed this knowledge');

          await this.knowledge.updateById(
            record.id,
            {
              verificationStatus: 'verified',
              lastVerifiedAt: now,
              version: record.version + 1,
              updatedAt: now,
            },
            options,
          );
          status = 'accepted';
        }
      }

      const task = run.taskId
        ? await this.tasks.findById(run.taskId, undefined, options)
        : undefined;
      const patch = await this.patches.create(
        {
          environmentId: target.id,
          sourceEnvironmentId: source.id,
          sourceUrl: run.agentInput!.targetUrl,
          sourcePullRequestId: task?.pullRequestId,
          scopeOrigin,
          scopePath,
          knowledgeId: record?.id,
          sourceRunId: run.id,
          requestId: proposal.requestId,
          operation: proposal.operation,
          status,
          baseVersion: proposal.baseVersion,
          reason: proposal.reason,
          sourceEventIds: proposal.sourceEventIds,
          proposal,
          previous: record ? {...record.toJSON()} : undefined,
          createdAt: now,
        },
        options,
      );
      if (proposal.operation === 'verify' && status === 'accepted') {
        const verification = await this.verifications.create(
          {
            patchId: patch.id,
            knowledgeId: record!.id,
            runId: run.id,
            requestId: proposal.requestId,
            baseVersion: proposal.baseVersion,
            result: 'confirmed',
            confidence: proposal.confidence,
            reason: proposal.reason,
            sourceEventIds: proposal.sourceEventIds,
            observedUrls: urls.map(url => url.toString()),
            createdAt: now,
          },
          options,
        );
        await this.patches.updateById(
          patch.id,
          {appliedVerificationId: verification.id, decidedAt: now},
          options,
        );
        patch.appliedVerificationId = verification.id;
      }

      await this.requireLease(run.id, token, transaction);
      await transaction.commit();

      return patch;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async verify(
    run: Run,
    input: KnowledgeVerificationInput,
    token: string,
  ): Promise<KnowledgeVerificationSummary> {
    const transaction = await this.patches.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );
    const options = {transaction};

    try {
      await this.lock(run.environmentId!, transaction);
      await this.requireLease(run.id, token, transaction);
      const repeated = await this.verifications.findOne(
        {where: {runId: run.id, requestId: input.requestId}},
        options,
      );

      if (repeated) {
        if (
          repeated.patchId !== input.patchId ||
          repeated.result !== input.result ||
          repeated.confidence !== input.confidence ||
          repeated.reason !== input.reason ||
          JSON.stringify(repeated.sourceEventIds) !==
            JSON.stringify(input.sourceEventIds)
        )
          throw new Error(
            'requestId was already used for another verification',
          );

        const patch = await this.patches.findById(
          repeated.patchId,
          undefined,
          options,
        );
        await transaction.commit();
        return this.summary(repeated, patch.status);
      }

      const patch = await this.patches.findOne(
        {where: {id: input.patchId, environmentId: run.environmentId!}},
        options,
      );
      const supplied = await this.usage.findOne(
        {where: {runId: run.id, patchId: input.patchId}},
        options,
      );

      if (
        !patch ||
        !supplied ||
        patch.scopeOrigin !== new URL(run.agentInput!.targetUrl).origin
      )
        throw new Error(
          'Only patches supplied for this target environment can be verified',
        );
      if (patch.status !== 'pending')
        throw new Error('Patch is no longer pending');
      if (patch.sourceRunId === run.id)
        throw new Error('A patch needs verification from a different run');

      const urls = await this.evidence(run, input.sourceEventIds, transaction);
      if (
        input.result !== 'inconclusive' &&
        urls.some(url => !coversKnowledgePath(patch.scopePath, url.pathname))
      )
        throw new Error(
          'Conclusive verification requires observations from the affected route',
        );

      const verification = await this.verifications.create(
        {
          patchId: patch.id,
          knowledgeId: patch.knowledgeId,
          runId: run.id,
          requestId: input.requestId,
          baseVersion: patch.baseVersion,
          result: input.result,
          confidence: input.confidence,
          reason: input.reason,
          sourceEventIds: input.sourceEventIds,
          observedUrls: urls.map(url => url.toString()),
          createdAt: new Date(),
        },
        options,
      );
      let status: KnowledgePatch['status'] = patch.status;

      if (input.result === 'confirmed' && this.autoApply)
        status = await this.apply(patch, verification, transaction);

      await this.requireLease(run.id, token, transaction);
      await transaction.commit();

      return this.summary(verification, status);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async decide(
    environmentId: string,
    patchId: string,
    userId: string,
    accept: boolean,
  ) {
    const transaction = await this.patches.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );
    const options = {transaction};

    try {
      await this.lock(environmentId, transaction);
      const patch = await this.patches.findOne(
        {where: {id: patchId, environmentId}},
        options,
      );

      if (!patch) throw new HttpErrors.NotFound('Patch not found');
      if (patch.status !== 'pending')
        throw new HttpErrors.Conflict('Patch is no longer pending');

      let status: KnowledgePatch['status'] = 'rejected';

      if (accept) {
        const verification = await this.latest(patch.id, transaction);
        if (verification?.result !== 'confirmed')
          throw new HttpErrors.Conflict(
            'This patch needs confirmation in the target environment before it can be applied',
          );

        status = await this.apply(patch, verification, transaction);
      }

      await this.patches.updateById(
        patch.id,
        {status, decidedBy: userId, decidedAt: new Date()},
        options,
      );
      await transaction.commit();

      return {status};
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async history(
    environmentId: string,
    offset = 0,
    status?: string,
    result?: string,
  ) {
    const ids = (await this.patches.execute(
      `SELECT p.id FROM knowledge.knowledge_patch p
       LEFT JOIN LATERAL (SELECT result FROM knowledge.knowledge_verification v WHERE v.patch_id=p.id ORDER BY v.sequence DESC LIMIT 1) latest ON true
       WHERE p.environment_id=$1 AND ($2::text IS NULL OR p.status=$2)
         AND ($3::text IS NULL OR latest.result=$3 OR ($3='unverified' AND latest.result IS NULL))
       ORDER BY p.created_at DESC, p.id LIMIT 50 OFFSET $4`,
      [environmentId, status ?? null, result ?? null, offset],
    )) as {id: string}[];

    return Promise.all(
      ids.map(async row => {
        const patch = await this.patches.findById(row.id);
        return {
          ...patch.toJSON(),
          latestVerification: await this.latest(row.id),
        };
      }),
    );
  }

  async detail(environmentId: string, id: string, offset = 0) {
    const patch = await this.patches.findOne({where: {id, environmentId}});
    if (!patch) throw new HttpErrors.NotFound('Patch not found');

    return {
      patch,
      latestVerification: await this.latest(id),
      verifications: await this.verifications.find({
        where: {patchId: id},
        order: ['sequence DESC'],
        limit: 50,
        skip: offset,
      }),
      sources: await this.events.find({
        where: {
          runId: patch.sourceRunId,
          id: {inq: patch.sourceEventIds},
          type: 'agent.evidence',
        },
      }),
    };
  }

  async verificationDetail(environmentId: string, patchId: string, id: string) {
    const patch = await this.patches.findOne({
      where: {id: patchId, environmentId},
    });
    const verification = patch
      ? await this.verifications.findOne({where: {id, patchId}})
      : null;

    if (!verification) throw new HttpErrors.NotFound('Verification not found');

    return {
      verification,
      sources: verification.sourceEventIds.length
        ? await this.events.find({
            where: {
              runId: verification.runId,
              id: {inq: verification.sourceEventIds},
              type: 'agent.evidence',
            },
          })
        : [],
    };
  }

  async runUsage(runId: string) {
    return {
      patches: await this.usage.find({
        where: {runId},
        order: ['createdAt ASC'],
        limit: 200,
      }),
      verifications: await this.verifications.find({
        where: {runId},
        order: ['createdAt ASC'],
        limit: 200,
      }),
    };
  }

  private async apply(
    patch: KnowledgePatch,
    verification: KnowledgeVerification,
    transaction: Transaction,
  ): Promise<KnowledgePatch['status']> {
    const options = {transaction};
    const proposal = knowledgePatchSchema.parse(patch.proposal);
    const record = patch.knowledgeId
      ? await this.knowledge.findById(patch.knowledgeId, undefined, options)
      : null;
    const duplicate = (await this.knowledge.execute(
      "SELECT id FROM knowledge.environment_knowledge WHERE environment_id=$1 AND scope_origin=$2 AND lower(title)=lower($3) AND verification_status <> 'retired' AND ($4::uuid IS NULL OR id <> $4)",
      [
        patch.environmentId,
        patch.scopeOrigin,
        proposal.title,
        record?.id ?? null,
      ],
      options,
    )) as {id: string}[];
    const conflict =
      proposal.operation === 'create'
        ? Boolean(record || duplicate.length)
        : !record ||
          record.version !== patch.baseVersion ||
          record.verificationStatus === 'retired' ||
          (proposal.operation !== 'retire' && duplicate.length > 0);

    if (conflict) {
      await this.patches.updateById(
        patch.id,
        {status: 'conflict', decidedAt: new Date()},
        options,
      );
      return 'conflict';
    }

    const now = new Date();
    const data = {
      type: proposal.operation === 'retire' ? record!.type : proposal.type,
      title: proposal.operation === 'retire' ? record!.title : proposal.title,
      content:
        proposal.operation === 'retire' ? record!.content : proposal.content,
      confidence: verification.confidence,
      scopePath:
        proposal.operation === 'retire' ? record!.scopePath : patch.scopePath,
      verificationStatus:
        proposal.operation === 'retire'
          ? ('retired' as const)
          : ('verified' as const),
      sourceRunId: verification.runId,
      sourceEventIds: verification.sourceEventIds,
      lastVerifiedAt: now,
      updatedAt: now,
    };
    const saved = record
      ? (await this.knowledge.updateById(
          record.id,
          {...data, version: record.version + 1},
          options,
        ),
        record)
      : await this.knowledge.create(
          {
            ...data,
            environmentId: patch.environmentId,
            scopeOrigin: patch.scopeOrigin!,
            version: 1,
            createdAt: now,
          },
          options,
        );

    await this.patches.updateById(
      patch.id,
      {
        knowledgeId: saved.id,
        status: 'accepted',
        appliedVerificationId: verification.id,
        decidedAt: now,
      },
      options,
    );
    await this.verifications.updateById(
      verification.id,
      {knowledgeId: saved.id},
      options,
    );

    return 'accepted';
  }

  private async evidence(
    run: Run,
    ids: string[],
    transaction: Transaction,
  ): Promise<URL[]> {
    const events = ids.length
      ? await this.events.find(
          {where: {id: {inq: ids}, runId: run.id, type: 'agent.evidence'}},
          {transaction},
        )
      : [];

    if (new Set(events.map(event => event.id)).size !== new Set(ids).size)
      throw new Error(
        'Knowledge requires existing browser evidence from this run',
      );

    return events.map(event => {
      const value = /^URL: (https?:\/\/[^\s]+)/.exec(
        String(event.payload.observation),
      )?.[1];
      if (!value)
        throw new Error('Cite browser snapshots that include the observed URL');
      const url = new URL(value);
      if (url.origin !== new URL(run.agentInput!.targetUrl).origin)
        throw new Error("Evidence must come from this run's target origin");

      return url;
    });
  }

  private latest(patchId: string, transaction?: Transaction) {
    return this.verifications.findOne(
      {where: {patchId}, order: ['sequence DESC']},
      {transaction},
    );
  }

  private async lock(environmentId: string, transaction: Transaction) {
    await this.patches.execute(
      "SELECT set_config('statement_timeout','5000',true), set_config('lock_timeout','3000',true)",
      [],
      {transaction},
    );
    await this.patches.execute(
      'SELECT id FROM auth.environment WHERE id=$1 FOR UPDATE',
      [environmentId],
      {transaction},
    );
  }

  private async requireLease(
    runId: string,
    token: string,
    transaction: Transaction,
  ) {
    const rows = (await this.runs.execute(
      `SELECT r.id FROM execution.run r JOIN execution.worker_slot s ON s.run_id=r.id
       WHERE r.id=$1 AND r.status='running' AND NOT r.cancel_requested AND s.token=$2 AND s.expires_at > clock_timestamp()`,
      [runId, token],
      {transaction},
    )) as object[];

    if (!rows.length)
      throw new Error('Run or worker lease is no longer active');
  }

  private summary(
    verification: KnowledgeVerification,
    patchStatus: KnowledgePatch['status'],
  ): KnowledgeVerificationSummary {
    return {
      id: verification.id,
      patchId: verification.patchId,
      result: verification.result,
      confidence: verification.confidence,
      reason: verification.reason,
      sourceEventIds: verification.sourceEventIds,
      observedUrls: verification.observedUrls,
      patchStatus,
    };
  }
}
