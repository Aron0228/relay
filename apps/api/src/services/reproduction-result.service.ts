import {BindingScope, injectable} from '@loopback/core';
import {repository, Transaction} from '@loopback/repository';
import {AgentResult, REPRODUCTION_VERDICT} from '../ai/types';
import {REPRODUCTION_PROMPT_VERSION} from '../ai/reproduction-prompt';
import {Run, RUN_STAGE, RUN_STATUS, TASK_OUTCOME, TASK_STATUS} from '../models';
import {
  RunEventRepository,
  StageRequestRepository,
  TaskRepository,
} from '../repositories';
import {WorkerResult} from '../workers/protocol';

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
    const conclusive =
      execution.status === RUN_STATUS.Completed &&
      result.stopReason === 'finished' &&
      (result.verdict === REPRODUCTION_VERDICT.Reproduced ||
        result.verdict === REPRODUCTION_VERDICT.NotReproduced) &&
      details &&
      details.steps.length > 0 &&
      details.sourceEventIds.length > 0 &&
      details.steps.every(step => step.sourceEventIds.length > 0) &&
      evidence.length === references.length;

    if (!conclusive) {
      const invalidClaim = result.verdict !== REPRODUCTION_VERDICT.Inconclusive;
      result = {
        ...result,
        verdict: REPRODUCTION_VERDICT.Inconclusive,
        confidence: 0,
        summary: invalidClaim
          ? (execution.error ??
            "The reproduction claim could not be supported by this run's observed evidence.")
          : result.summary,
        reproduction: details ?? {
          preconditions: [],
          steps: [],
          expectedBehavior:
            run.agentInput?.reproduction?.expectedBehavior ?? 'Not established',
          actualBehavior: 'The investigation did not establish an outcome',
          sourceEventIds: [],
        },
      };
    }

    result.promptVersion = REPRODUCTION_PROMPT_VERSION;
    let nextStage:
      typeof RUN_STAGE.StepVerification | typeof RUN_STAGE.Critic | undefined;

    if (conclusive) {
      nextStage =
        result.verdict === REPRODUCTION_VERDICT.Reproduced
          ? RUN_STAGE.StepVerification
          : RUN_STAGE.Critic;
    }

    if (nextStage) {
      await this.requests.create(
        {taskId: run.taskId!, sourceRunId: run.id, stage: nextStage},
        options,
      );
    }

    await this.tasks.updateAll(
      {
        status: nextStage ? TASK_STATUS.Queued : execution.status,
        outcome: nextStage ? null : TASK_OUTCOME.Inconclusive,
        endedAt: nextStage ? null : new Date(),
        result: {
          reproductionRunId: run.id,
          provisionalVerdict: result.verdict,
          summary: result.summary,
          verification: nextStage ? 'pending' : 'not_requested',
          nextStage: nextStage ?? null,
        },
      },
      {
        id: run.taskId!,
        status: {
          inq: [TASK_STATUS.Pending, TASK_STATUS.Queued, TASK_STATUS.Running],
        },
      },
      options,
    );

    return result;
  }
}
