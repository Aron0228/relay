import {BindingScope, inject, lifeCycleObserver, service} from '@loopback/core';
import {IsolationLevel, repository} from '@loopback/repository';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {reproductionInput} from '../ai/reproduction-input';
import {Run, RUN_STAGE, TASK_STATUS} from '../models';
import {
  EnvironmentRepository,
  GithubIssueRepository,
  RunEventRepository,
  RunRepository,
  RunResultRepository,
  StageRequestRepository,
  TaskRepository,
} from '../repositories';
import {
  WORKER_SERVICE_OPTIONS_BINDING_KEY,
  WorkerService,
  WorkerServiceOptions,
} from './worker.service';
import {ReproductionResultService} from './reproduction-result.service';
import {IssuePipelineState} from './issue-pipeline-state';

export const ISSUE_STAGE_SERVICE_BINDING_KEY = 'services.IssueStageService';

@lifeCycleObserver('issue-stages', {scope: BindingScope.SINGLETON})
export class IssueStageService {
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private stopped = false;

  constructor(
    @repository(TaskRepository) private tasks: TaskRepository,
    @repository(StageRequestRepository)
    private requests: StageRequestRepository,
    @repository(RunRepository) private runs: RunRepository,
    @repository(RunResultRepository) private results: RunResultRepository,
    @repository(RunEventRepository) private events: RunEventRepository,
    @repository(GithubIssueRepository) private issues: GithubIssueRepository,
    @repository(EnvironmentRepository)
    private environments: EnvironmentRepository,
    @service(WorkerService) private workers: WorkerService,
    @service(ReproductionResultService)
    private completion: ReproductionResultService,
    @inject(WORKER_SERVICE_OPTIONS_BINDING_KEY, {optional: true})
    private options: WorkerServiceOptions = {},
  ) {}

  start(): void {
    const enabled =
      process.env.ISSUE_PIPELINE_ENABLED ??
      (process.env.NODE_ENV === 'test' ? 'false' : 'true');

    if (this.options.enabled === false || enabled === 'false') return;

    const tick = () => {
      this.pending ??= this.dispatch()
        .catch(() => console.error('Issue stage dispatch will retry'))
        .finally(() => {
          this.pending = undefined;
        });
    };
    this.timer = setInterval(tick, 2000);
    this.timer.unref();
    tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.pending;
  }

  private async dispatch(): Promise<void> {
    const requests = await this.requests.find({
      where: {consumedAt: {eq: null as unknown as Date}},
      order: ['createdAt ASC', 'id ASC'],
      limit: 50,
    });

    for (const request of requests) {
      if (this.stopped) break;

      try {
        const run = await this.prepare(request.id, request.taskId);
        if (!run) continue;

        await this.workers.enqueueRecordedRun(run.id);
        await this.requests.updateById(request.id, {consumedAt: new Date()});
      } catch {
        console.error(`Issue stage ${request.id} will retry`);
      }
    }
  }

  private async prepare(id: string, taskId: string): Promise<Run | undefined> {
    const transaction = await this.tasks.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );
    const options = {transaction};

    try {
      await this.tasks.execute(
        "SELECT set_config('statement_timeout', '5000', true), set_config('idle_in_transaction_session_timeout', '10000', true)",
        [],
        options,
      );
      await this.tasks.execute(
        'SELECT id FROM execution.task WHERE id = $1 FOR UPDATE',
        [taskId],
        options,
      );
      const task = await this.tasks.findById(taskId, undefined, options);
      const request = await this.requests.findById(id, undefined, options);

      if (
        request.consumedAt ||
        task.cancelRequested ||
        (task.status !== TASK_STATUS.Queued &&
          task.status !== TASK_STATUS.Running)
      ) {
        await this.requests.updateById(id, {consumedAt: new Date()}, options);
        await transaction.commit();
        return undefined;
      }

      const verificationRuns = await this.runs.find(
        {
          where: {taskId, stage: RUN_STAGE.StepVerification},
          order: ['createdAt ASC', 'id ASC'],
          limit: 1,
        },
        options,
      );
      const previous = verificationRuns[0];

      if (previous && previous.id !== request.runId) {
        if (previous.status !== 'queued' && previous.status !== 'running') {
          const previousResult = await this.results.findOne(
            {where: {runId: previous.id}},
            options,
          );
          if (previousResult)
            await this.completion.complete(
              previous,
              {status: previous.status, error: previous.error ?? undefined},
              previousResult.result,
              transaction,
            );
        }
        await this.requests.updateById(id, {consumedAt: new Date()}, options);
        await transaction.commit();
        return undefined;
      }

      if (request.stage !== RUN_STAGE.StepVerification) {
        request.stage = RUN_STAGE.StepVerification;
        await this.requests.updateById(id, {stage: request.stage}, options);
      }

      if (request.runId) {
        const existing = await this.runs.findById(
          request.runId,
          undefined,
          options,
        );
        await transaction.commit();
        return existing;
      }

      const state: IssuePipelineState = task.result ?? {};
      const source = await this.results.findOne(
        {where: {runId: state.confirmedRunId ?? request.sourceRunId}},
        options,
      );
      if (!source?.result.reproduction) {
        await this.tasks.updateById(
          taskId,
          {
            status: TASK_STATUS.Failed,
            outcome: 'inconclusive',
            endedAt: new Date(),
            result: {
              ...state,
              verdict: 'inconclusive',
              verification: 'inconclusive',
              nextStage: null,
              summary: 'The stored verification source is unavailable.',
            },
          },
          options,
        );
        await this.requests.updateById(id, {consumedAt: new Date()}, options);
        await transaction.commit();
        return undefined;
      }

      const details = source.result.reproduction;
      const steps = details.steps;

      const attempts = await this.runs.find(
        {
          where: {taskId, stage: request.stage},
          order: ['attempt DESC'],
          limit: 1,
        },
        options,
      );
      const environment = await this.environments.findById(
        task.environmentId,
        undefined,
        options,
      );
      const sourceRun = await this.runs.findById(
        source.runId,
        undefined,
        options,
      );
      if (
        new URL(sourceRun.agentInput!.targetUrl).toString() !==
        new URL(environment.baseUrl).toString()
      ) {
        await this.tasks.updateById(
          taskId,
          {
            status: TASK_STATUS.Completed,
            outcome: 'inconclusive',
            endedAt: new Date(),
            result: {
              ...state,
              verdict: 'inconclusive',
              verification: 'inconclusive',
              nextStage: null,
              summary:
                'The target environment URL changed between investigation stages.',
            },
          },
          options,
        );
        await this.requests.updateById(id, {consumedAt: new Date()}, options);
        await transaction.commit();
        return undefined;
      }

      const issue = await this.issues.findById(
        task.issueId,
        undefined,
        options,
      );
      const agentInput = reproductionInput(task, issue, environment);
      agentInput.verification = {
        kind: request.stage,
        sourceRunId: source.runId,
        claim: state.provisionalVerdict ?? 'inconclusive',
        preconditions: details.preconditions,
        steps,
        expectedBehavior: details.expectedBehavior,
        actualBehavior: details.actualBehavior,
      };
      const run = await this.runs.create(
        {
          id: randomUUID(),
          taskId,
          workspaceId: task.workspaceId,
          environmentId: task.environmentId,
          userId: task.requestedBy,
          scriptName: 'agent',
          stage: request.stage,
          attempt: (attempts[0]?.attempt ?? 0) + 1,
          agentInput,
          viewTokenHash: createHash('sha256')
            .update(randomBytes(32))
            .digest('hex'),
        },
        options,
      );
      await this.events.create(
        {
          runId: run.id,
          type: 'run.queued',
          payload: {
            taskId,
            stage: run.stage,
            attempt: run.attempt,
          },
        },
        options,
      );
      await this.requests.updateById(id, {runId: run.id}, options);
      await transaction.commit();

      return run;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
