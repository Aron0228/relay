import {verificationStepError} from '../ai/verification-steps';
import {BindingScope, injectable} from '@loopback/core';
import {repository, Transaction} from '@loopback/repository';
import {
  AgentResult,
  ReproductionVerdict,
  REPRODUCTION_VERDICT as VERDICT,
} from '../ai/types';
import {Run, RUN_STAGE, RUN_STATUS, TASK_STATUS} from '../models';
import {
  RunEventRepository,
  StageRequestRepository,
  TaskRepository,
} from '../repositories';
import {WorkerResult} from '../workers/protocol';
import {IssuePipelineState} from './issue-pipeline-state';

export const REPRODUCTION_RESULT_SERVICE_BINDING_KEY =
  'services.ReproductionResultService';

@injectable({scope: BindingScope.SINGLETON})
export class ReproductionResultService {
  constructor(
    @repository(RunEventRepository) private events: RunEventRepository,
    @repository(StageRequestRepository)
    private requests: StageRequestRepository,
    @repository(TaskRepository) private tasks: TaskRepository,
  ) {}

  async complete(
    run: Run,
    execution: WorkerResult,
    result: AgentResult,
    transaction: Transaction,
  ): Promise<AgentResult> {
    const options = {transaction};
    const task = await this.tasks.findById(run.taskId!, undefined, options);
    if (run.stage === RUN_STAGE.FixVerification) {
      const details = result.reproduction;
      const references = [
        ...new Set([
          ...(details?.sourceEventIds ?? []),
          ...(details?.steps.flatMap(step => step.sourceEventIds) ?? []),
        ]),
      ];
      const evidence = references.length
        ? await this.events.find(
            {
              where: {
                runId: run.id,
                type: 'agent.evidence',
                id: {inq: references},
              },
            },
            options,
          )
        : [];
      const valid =
        !task.cancelRequested &&
        execution.status === RUN_STATUS.Completed &&
        result.stopReason === 'finished' &&
        details?.steps.length &&
        details.sourceEventIds.length &&
        details.steps.every(step => step.sourceEventIds.length) &&
        evidence.length === references.length;
      const outcome =
        valid && (result.verdict === 'fixed' || result.verdict === 'not_fixed')
          ? result.verdict
          : 'inconclusive';
      const summary =
        !valid && result.stopReason === 'finished'
          ? 'The fix could not be verified with a complete scenario and recorded observations.'
          : result.summary;
      result = {
        ...result,
        verdict: outcome,
        summary,
        confidence: outcome === 'inconclusive' ? 0 : result.confidence,
      };
      await this.tasks.updateById(
        task.id,
        {
          status: task.cancelRequested ? 'cancelled' : execution.status,
          outcome,
          endedAt: new Date(),
          result: {
            ...details,
            verdict: outcome,
            summary,
            contextId: run.agentInput?.fixVerification?.contextId,
            headSha: task.headSha,
            targetUrl: task.targetUrl,
          },
        },
        options,
      );

      console.info('[PR verification] Browser result validated', {
        taskId: task.id,
        runId: run.id,
        outcome,
        evidenceValid: Boolean(valid),
        summary,
      });

      return result;
    }

    const state: IssuePipelineState = {...task.result};
    const details = result.reproduction;
    const references = [
      ...new Set([
        ...(details?.sourceEventIds ?? []),
        ...(details?.steps.flatMap(step => step.sourceEventIds) ?? []),
      ]),
    ];
    const evidence = references.length
      ? await this.events.find(
          {
            where: {
              runId: run.id,
              type: 'agent.evidence',
              id: {inq: references},
            },
          },
          options,
        )
      : [];
    const verification = run.agentInput?.verification;
    const claimsConclusion =
      result.verdict === VERDICT.Reproduced ||
      result.verdict === VERDICT.NotReproduced;
    const mappingError = verification
      ? verificationStepError(
          verification,
          details?.steps ?? [],
          claimsConclusion,
        )
      : undefined;
    let validationError: string | undefined;

    if (execution.status !== RUN_STATUS.Completed)
      validationError =
        execution.error ??
        `The browser run ${execution.status} before verification finished.`;
    else if (result.stopReason !== 'finished') validationError = result.summary;
    else if (
      claimsConclusion &&
      (!details?.steps.length ||
        !details.sourceEventIds.length ||
        details.steps.some(step => !step.sourceEventIds.length))
    )
      validationError =
        'The agent did not provide a complete step sequence with recorded observations for each step.';
    else if (evidence.length !== references.length)
      validationError =
        'Some cited observations could not be found in this run. The reported behavior could not be independently verified.';
    else if (mappingError)
      validationError = `The verification report could not be matched to the original steps: ${mappingError}`;

    const conclusive =
      !task.cancelRequested &&
      !validationError &&
      (result.verdict === VERDICT.Reproduced ||
        result.verdict === VERDICT.NotReproduced);
    if (!conclusive) {
      result = {
        ...result,
        verdict: VERDICT.Inconclusive,
        confidence: 0,
        summary: validationError ?? result.summary,
      };
    }

    let nextStage: typeof RUN_STAGE.StepVerification | undefined;
    let outcome: ReproductionVerdict = VERDICT.Inconclusive;
    let reason = result.summary;

    if (run.stage === RUN_STAGE.Reproduction) {
      state.reproductionRunId = run.id;
      state.reproduction = details;
      state.provisionalVerdict = result.verdict as ReproductionVerdict;
      if (conclusive) nextStage = RUN_STAGE.StepVerification;
    } else {
      state.verificationObservation = details?.actualBehavior;
      if (conclusive && result.verdict === state.provisionalVerdict) {
        outcome = result.verdict as ReproductionVerdict;
        state.confirmed = details;
        state.confirmedRunId = run.id;
      } else if (conclusive) {
        reason = `The two runs disagreed: the first reported ${state.provisionalVerdict?.replace(/_/g, ' ')}, while verification reported ${result.verdict.replace(/_/g, ' ')}. ${result.summary}`;
      }
    }

    if (task.cancelRequested || task.status === TASK_STATUS.Cancelled) {
      nextStage = undefined;
      outcome = VERDICT.Inconclusive;
      reason = 'The investigation was cancelled.';
    }

    if (nextStage)
      await this.requests.create(
        {taskId: task.id, sourceRunId: run.id, stage: nextStage},
        options,
      );

    const finalDetails = state.confirmed ?? details;
    await this.tasks.updateAll(
      {
        status: nextStage
          ? TASK_STATUS.Queued
          : task.cancelRequested
            ? TASK_STATUS.Cancelled
            : execution.status,
        outcome: nextStage ? null : outcome,
        endedAt: nextStage ? null : new Date(),
        result: {
          ...state,
          summary: reason,
          verdict: nextStage ? undefined : outcome,
          verification: nextStage
            ? 'pending'
            : outcome === VERDICT.Inconclusive
              ? 'inconclusive'
              : 'verified',
          nextStage: nextStage ?? null,
          preconditions: finalDetails?.preconditions ?? [],
          steps: state.confirmed?.steps ?? [],
          expectedBehavior:
            state.reproduction?.expectedBehavior ??
            finalDetails?.expectedBehavior,
          actualBehavior:
            state.reproduction?.actualBehavior ?? details?.actualBehavior,
        },
      },
      {id: task.id},
      options,
    );

    return result;
  }
}
