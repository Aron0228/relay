import {BindingScope, injectable, service} from '@loopback/core';
import {repository} from '@loopback/repository';
import {HttpErrors} from '@loopback/rest';
import {
  GithubIssueRepository,
  GithubPullRequestRepository,
  PrContextRepository,
  GithubRepositoryRepository,
  RunRepository,
  RunResultRepository,
  TaskRepository,
} from '../repositories';
import {WorkspaceService} from './workspace.service';

export const ISSUE_QUERY_SERVICE_BINDING_KEY = 'services.IssueQueryService';

@injectable({scope: BindingScope.SINGLETON})
export class IssueQueryService {
  constructor(
    @repository(GithubIssueRepository) private issues: GithubIssueRepository,
    @repository(GithubRepositoryRepository)
    private repositories: GithubRepositoryRepository,
    @repository(TaskRepository) private tasks: TaskRepository,
    @repository(RunRepository) private runs: RunRepository,
    @repository(RunResultRepository) private results: RunResultRepository,
    @service(WorkspaceService) private workspaces: WorkspaceService,
    @repository(GithubPullRequestRepository)
    private pullRequests?: GithubPullRequestRepository,
    @repository(PrContextRepository) private contexts?: PrContextRepository,
  ) {}

  async list(
    workspaceId: string,
    userId: string,
    search: string,
    before?: string,
    pullRequest = false,
  ) {
    await this.workspaces.requireMember(workspaceId, userId);
    const cursor = before
      ? await this.get(before, userId, undefined, pullRequest)
      : undefined;
    if (cursor && cursor.workspaceId !== workspaceId)
      throw new HttpErrors.NotFound('Cursor not found');

    const rows = (await this.tasks.execute(
      `SELECT i.id, i.number, i.url, i.created_at AS "createdAt", r.full_name AS repository,
        t.id AS "taskId", t.issue_title AS title, t.status, t.outcome, t.feedback_status AS "feedbackStatus"
       FROM github.${pullRequest ? 'pull_request' : 'issue'} i JOIN github.repository r ON r.id = i.repository_id
       JOIN LATERAL (SELECT * FROM execution.task WHERE ${pullRequest ? 'pull_request_id' : 'issue_id'} = i.id ORDER BY created_at DESC, id DESC LIMIT 1) t ON true
       WHERE r.workspace_id = $1
         AND (t.issue_title ILIKE $2 OR r.full_name ILIKE $2 OR i.number::text ILIKE $2)
         AND ($3::timestamptz IS NULL OR (i.created_at, i.id) < ($3::timestamptz, $4::uuid))
       ORDER BY i.created_at DESC, i.id DESC LIMIT 26`,
      [
        workspaceId,
        `%${search.replace(/[\\%_]/g, '\\$&')}%`,
        cursor?.createdAt ?? null,
        before ?? null,
      ],
    )) as {id: string}[];

    return {
      items: rows.slice(0, 25),
      nextCursor: rows.length > 25 ? rows[24].id : null,
    };
  }

  async get(id: string, userId: string, taskId?: string, pullRequest = false) {
    const issue = pullRequest
      ? await this.pullRequests!.findById(id)
      : await this.issues.findById(id);
    const source = pullRequest ? {pullRequestId: id} : {issueId: id};
    const linkedRepository = await this.repositories.findById(
      issue.repositoryId,
    );
    await this.workspaces.requireMember(linkedRepository.workspaceId, userId);
    const tasks = await this.tasks.find({
      where: {...source, workspaceId: linkedRepository.workspaceId},
      order: ['createdAt DESC', 'id DESC'],
      limit: 100,
    });
    const task = taskId
      ? await this.tasks.findOne({
          where: {
            id: taskId,
            ...source,
            workspaceId: linkedRepository.workspaceId,
          },
        })
      : tasks[0];
    if (!task) throw new HttpErrors.NotFound('Issue investigation not found');
    const investigationTasks = tasks.some(item => item.id === task.id)
      ? tasks
      : [task, ...tasks];
    const runs = await this.runs.find({
      where: {taskId: {inq: investigationTasks.map(item => item.id)}},
      order: ['createdAt ASC', 'id ASC'],
    });
    const results = runs.length
      ? await this.results.find({
          where: {runId: {inq: runs.map(run => run.id)}},
        })
      : [];

    const publicRuns = runs.map(run => ({
      id: run.id,
      taskId: run.taskId,
      workspaceId: run.workspaceId,
      environmentId: run.environmentId,
      stage: run.stage,
      attempt: run.attempt,
      title: `${run.stage?.replace(/_/g, ' ')} · attempt ${run.attempt}`,
      status: run.status,
      cancelRequested: run.cancelRequested,
      targetUrl: run.agentInput?.targetUrl,
      videoFile: run.videoFile,
      error: run.error,
      createdAt: run.createdAt,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      result: results.find(result => result.runId === run.id)?.result ?? null,
    }));

    const context = pullRequest
      ? await this.contexts!.findOne({where: {taskId: task.id}})
      : null;

    return {
      context: context
        ? {
            id: context.id,
            headSha: context.headSha,
            status: context.status,
            data: context.data,
            sources: context.sources,
            metrics: context.metrics,
            model: context.model,
            promptVersion: context.promptVersion,
            error: context.error,
            createdAt: context.createdAt,
            completedAt: context.completedAt,
          }
        : null,
      targetUrl: task.targetUrl,
      headSha: task.headSha,
      baseSha: task.baseSha,
      id: issue.id,
      number: issue.number,
      url: issue.url,
      createdAt: issue.createdAt,
      workspaceId: linkedRepository.workspaceId,
      repository: linkedRepository.fullName,
      title: task.issueTitle,
      description: task.issueBody,
      task: this.publicTask(task),
      investigations: (tasks.some(item => item.id === task.id)
        ? tasks
        : [task, ...tasks]
      ).map(item => this.publicTask(item)),
      runs: publicRuns.filter(run => run.taskId === task.id),
      runGroups: investigationTasks.map(investigation => ({
        investigation: this.publicTask(investigation),
        runs: publicRuns.filter(run => run.taskId === investigation.id),
      })),
    };
  }

  async authorizeTask(id: string, userId: string) {
    const task = await this.tasks.findById(id);
    await this.workspaces.requireMember(task.workspaceId, userId);
    return task;
  }

  private publicTask(task: Awaited<ReturnType<TaskRepository['findById']>>) {
    return {
      id: task.id,
      targetUrl: task.targetUrl,
      headSha: task.headSha,
      status: task.status,
      outcome: task.outcome,
      result: task.result,
      cancelRequested: task.cancelRequested,
      feedbackStatus: task.feedbackStatus,
      feedbackPhase: task.feedbackPhase,
      feedbackAttempts: task.feedbackAttempts,
      feedbackError: task.feedbackError,
      feedbackCommentId: task.feedbackCommentId,
      feedbackSentAt: task.feedbackSentAt,
      feedbackNextAttemptAt: task.feedbackNextAttemptAt,
      createdAt: task.createdAt,
      queuedAt: task.queuedAt,
      startedAt: task.startedAt,
      endedAt: task.endedAt,
    };
  }
}
