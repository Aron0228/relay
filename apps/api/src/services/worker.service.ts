import {BindingScope, inject, lifeCycleObserver} from '@loopback/core';
import {IsolationLevel, repository} from '@loopback/repository';
import {HttpErrors, Response} from '@loopback/rest';
import {AgentInput, AgentResult, AGENT_VERDICT} from '../ai/types';
import {approvedUrl, allowedOrigins, positiveInteger} from '../ai/config';
import {AGENT_PROMPT_VERSION} from '../ai/system-prompt';
import {Job, Queue, Worker} from 'bullmq';
import Redis from 'ioredis';
import {execFile, fork} from 'node:child_process';
import {promisify} from 'node:util';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {access, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {isRunFinished, Run, RUN_STATUS} from '../models';
import {
  RunEventRepository,
  RunRepository,
  RunResultRepository,
} from '../repositories';
import {
  WorkerMessage,
  WorkerResult,
  WorkerScriptName,
  WORKER_SCRIPT,
} from '../workers/protocol';

const executeFile = promisify(execFile);

export const WORKER_SERVICE_BINDING_KEY = 'services.WorkerService';
export const WORKER_SERVICE_OPTIONS_BINDING_KEY =
  'services.WorkerService.options';

export interface WorkerServiceOptions {
  enabled?: boolean;
}

interface RunJob {
  runId: string;
}

@lifeCycleObserver('worker', {scope: BindingScope.SINGLETON})
export class WorkerService {
  private readonly queueName = process.env.WORKER_QUEUE_NAME ?? 'relay-browser';
  private readonly concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);
  private readonly timeoutMs =
    Number(process.env.WORKER_TIMEOUT_SECONDS ?? 120) * 1000;
  private readonly videoDirectory = path.resolve(
    process.env.WORKER_VIDEO_DIR ||
      path.join(__dirname, '../../storage/worker-videos'),
  );
  private readonly exampleUrl =
    process.env.WORKER_EXAMPLE_URL ?? 'https://demo.playwright.dev/todomvc';
  private readonly actionDelayMs = Number(
    process.env.WORKER_ACTION_DELAY_MS ?? 1000,
  );
  private readonly conversions = new Map<string, Promise<string>>();
  private conversionQueue: Promise<unknown> = Promise.resolve();
  private readonly cancellations = new Map<string, () => void>();
  private readonly streams = new Set<() => void>();
  private readonly cancelChannel = `${this.queueName}:cancel`;
  private queue?: Queue<RunJob>;
  private worker?: Worker<RunJob>;
  private publisher?: Redis;
  private subscriber?: Redis;
  private initializing?: Promise<void>;
  private stopping = false;

  constructor(
    @repository(RunRepository) private runs: RunRepository,
    @repository(RunEventRepository) private events: RunEventRepository,
    @repository(RunResultRepository) private results: RunResultRepository,
    @inject(WORKER_SERVICE_OPTIONS_BINDING_KEY, {optional: true})
    private options: WorkerServiceOptions = {},
  ) {
    for (const [name, value] of Object.entries({
      WORKER_CONCURRENCY: this.concurrency,
      WORKER_TIMEOUT_SECONDS: this.timeoutMs / 1000,
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
      }
    }

    if (!Number.isSafeInteger(this.actionDelayMs) || this.actionDelayMs < 0) {
      throw new Error('WORKER_ACTION_DELAY_MS must be a non-negative integer');
    }
  }

  async start(): Promise<void> {
    if (this.options.enabled ?? process.env.WORKER_ENABLED !== 'false') {
      await this.initialize();
    }
  }

  async create(
    scriptName: WorkerScriptName,
    userId?: string,
    agentInput?: AgentInput,
    context?: {workspaceId: string; environmentId: string},
  ): Promise<{run: Run; viewToken: string}> {
    if (this.stopping) {
      throw new HttpErrors.ServiceUnavailable(
        'Worker infrastructure is stopping',
      );
    }

    if (!Object.values(WORKER_SCRIPT).includes(scriptName)) {
      throw new HttpErrors.BadRequest('Unknown worker script');
    }

    if (scriptName === WORKER_SCRIPT.Agent) {
      if (!agentInput?.prompt.trim() || agentInput.prompt.length > 4000) {
        throw new HttpErrors.BadRequest(
          'An agent prompt of 1 to 4000 characters is required',
        );
      }

      try {
        agentInput = {
          ...agentInput,
          targetUrl: approvedUrl(agentInput.targetUrl, allowedOrigins()),
        };
      } catch {
        throw new HttpErrors.BadRequest(
          'The target URL must use an approved origin',
        );
      }
    }

    await this.initialize();

    const viewToken = randomBytes(32).toString('hex');
    const run = await this.runs.create({
      id: randomUUID(),
      userId,
      scriptName,
      agentInput,
      workspaceId: context?.workspaceId,
      environmentId: context?.environmentId,
      status: RUN_STATUS.Queued,
      viewTokenHash: this.hash(viewToken),
      cancelRequested: false,
    });

    try {
      await this.event(run.id, 'run.queued', {scriptName});
      await this.queue!.add(
        scriptName,
        {runId: run.id},
        {
          jobId: run.id,
          attempts: 1,
          removeOnComplete: {count: 1000},
          removeOnFail: {count: 1000},
        },
      );
    } catch (error) {
      await this.finish(run.id, {
        status: RUN_STATUS.Failed,
        error: (error as Error).message,
      });
      throw new HttpErrors.ServiceUnavailable('Could not queue the run');
    }

    return {run, viewToken};
  }

  async listOwned(
    userId: string,
    scope: string,
    query: string,
    before?: string,
    limit = 25,
    workspaceId?: string,
  ) {
    const cursor = before ? await this.getOwned(before, userId) : undefined;

    if (
      cursor &&
      cursor.workspaceId !== (workspaceId ?? null) &&
      (cursor.workspaceId || workspaceId)
    ) {
      throw new HttpErrors.NotFound('Cursor not found');
    }
    const direction = scope === 'queued' ? 'ASC' : 'DESC';
    const comparison = scope === 'queued' ? '>' : '<';
    const rows = (await this.runs.execute(
      `SELECT id FROM execution.run
       WHERE (($7::uuid IS NULL AND workspace_id IS NULL AND user_id = $1) OR (workspace_id = $7::uuid AND EXISTS (SELECT 1 FROM auth.workspace_member m JOIN auth.workspace w ON w.id = m.workspace_id WHERE m.workspace_id = execution.run.workspace_id AND m.user_id = $1 AND w.deleted_at IS NULL)))
         AND ($2 = 'all' OR ($2 = 'active' AND status = 'running') OR ($2 = 'queued' AND status = 'queued'))
         AND (COALESCE(agent_input->>'prompt', script_name) ILIKE $3 OR id::text ILIKE $3)
         AND ($4::timestamptz IS NULL OR (created_at, id) ${comparison} ($4::timestamptz, $5::uuid))
       ORDER BY created_at ${direction}, id ${direction} LIMIT $6`,
      [
        userId,
        scope,
        `%${query.replace(/[\\%_]/g, '\\$&')}%`,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        limit + 1,
        workspaceId ?? null,
      ],
    )) as {id: string}[];
    const hasMore = rows.length > limit;
    const ids = rows.slice(0, limit).map(row => row.id);
    const items = ids.length
      ? await this.runs.find({
          where: {id: {inq: ids}},
          order: [`createdAt ${direction}`, `id ${direction}`],
        })
      : [];

    return {items, nextCursor: hasMore ? items[items.length - 1].id : null};
  }

  async getOwned(id: string, userId: string): Promise<Run> {
    const run = await this.runs.findOne({where: {id}});
    const memberships = run?.workspaceId
      ? ((await this.runs.execute(
          'SELECT m.id FROM auth.workspace_member m JOIN auth.workspace w ON w.id = m.workspace_id WHERE m.workspace_id = $1 AND m.user_id = $2 AND w.deleted_at IS NULL',
          [run.workspaceId, userId],
        )) as {id: string}[])
      : [];

    if (
      run &&
      (run.workspaceId ? !memberships.length : run.userId !== userId)
    ) {
      throw new HttpErrors.NotFound('Run not found');
    }

    if (!run) {
      throw new HttpErrors.NotFound('Run not found');
    }

    return run;
  }

  async getViewable(id: string, token?: string): Promise<Run> {
    const run = await this.runs.findOne({where: {id}});

    if (
      !run ||
      !!run.workspaceId ||
      !token ||
      !timingSafeEqual(
        Buffer.from(run.viewTokenHash, 'hex'),
        Buffer.from(this.hash(token), 'hex'),
      )
    ) {
      throw new HttpErrors.NotFound('Run not found');
    }

    return run;
  }

  async cancel(id: string): Promise<void> {
    const {count} = await this.runs.updateAll(
      {cancelRequested: true},
      {id, status: {inq: [RUN_STATUS.Queued, RUN_STATUS.Running]}},
    );

    if (!count) {
      return;
    }

    await this.event(id, 'run.cancel_requested', {});
    await this.initialize();
    await this.publisher!.publish(this.cancelChannel, id);

    const run = await this.runs.findById(id);

    if (run.status === RUN_STATUS.Queued) {
      await this.finish(id, {status: RUN_STATUS.Cancelled}, true);
    }
  }

  async getResult(id: string) {
    return this.results.findOne({where: {runId: id}});
  }

  async listEvents(id: string, after = 0) {
    return this.events.find({
      where: {runId: id, sequence: {gt: after}},
      order: ['sequence ASC'],
      limit: 1000,
    });
  }

  async activity(
    id: string,
    response: Response,
    after = 0,
    userId?: string,
  ): Promise<void> {
    let closed = false;
    const close = () => {
      if (closed) {
        return;
      }

      closed = true;
      this.streams.delete(close);
      response.end();
    };

    response.on('close', close);
    this.streams.add(close);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    try {
      while (!closed) {
        if (userId) {
          try {
            await this.getOwned(id, userId);
          } catch {
            break;
          }
        }

        const events = await this.listEvents(id, after);

        for (const event of events) {
          if (closed) {
            break;
          }

          const ready = response.write(
            `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          );
          after = event.sequence;

          if (!ready) {
            await new Promise<void>(resolve => {
              const resume = () => {
                response.off('drain', resume);
                response.off('close', resume);
                resolve();
              };

              response.once('drain', resume);
              response.once('close', resume);
            });
          }
        }

        if (
          !events.length &&
          isRunFinished((await this.runs.findById(id)).status)
        ) {
          break;
        }

        if (!closed) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
    } finally {
      close();
    }
  }

  videoPath(id: string): string {
    return path.join(this.videoDirectory, id, 'session.webm');
  }

  async playbackPath(id: string): Promise<string> {
    const file = path.join(path.dirname(this.videoPath(id)), 'playback.mp4');

    try {
      await access(file);

      return file;
    } catch {
      const existing = this.conversions.get(id);

      if (existing) return existing;
    }

    const conversion = this.conversionQueue
      .catch(() => {})
      .then(async () => {
        const temporary = file.replace('.mp4', '.tmp.mp4');

        try {
          await executeFile(
            process.env.WORKER_FFMPEG_PATH ?? 'ffmpeg',
            [
              '-nostdin',
              '-y',
              '-i',
              this.videoPath(id),
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-pix_fmt',
              'yuv420p',
              '-movflags',
              '+faststart',
              '-an',
              temporary,
            ],
            {timeout: 60000},
          );
          await rename(temporary, file);

          return file;
        } catch {
          await rm(temporary, {force: true});
          throw new HttpErrors.ServiceUnavailable(
            'Recording playback requires FFmpeg with H.264 support',
          );
        }
      })
      .finally(() => this.conversions.delete(id));
    this.conversions.set(id, conversion);
    this.conversionQueue = conversion;

    return conversion;
  }

  async stream(run: Run, response: Response, userId?: string): Promise<void> {
    await this.initialize();

    const subscriber = new Redis(this.redisOptions());
    const channel = this.frameChannel(run.id);
    let closed = false;

    const close = () => {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(heartbeat);
      this.streams.delete(close);
      subscriber.disconnect();
      response.end();
    };

    const write = (data: string) => {
      if (data === 'end') {
        close();
      } else if (!closed && !response.writableNeedDrain) {
        const frame = Buffer.from(data, 'base64');

        response.write(
          `--relay-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
        );
        response.write(frame);
        response.write('\r\n');
      }
    };

    const heartbeat = setInterval(() => {
      (userId ? this.getOwned(run.id, userId) : this.runs.findById(run.id))
        .then(current => {
          if (isRunFinished(current.status)) {
            close();
          }
        })
        .catch(close);
    }, 2000);

    response.on('close', close);
    subscriber.on('error', close);
    subscriber.on('message', (_channel, data) => write(data));
    this.streams.add(close);

    try {
      await subscriber.subscribe(channel);
      response.setHeader(
        'Content-Type',
        'multipart/x-mixed-replace; boundary=relay-frame',
      );
      response.setHeader('X-Accel-Buffering', 'no');
      response.flushHeaders();

      const latest = await this.publisher!.get(this.frameKey(run.id));

      if (latest) {
        write(latest);
      }
    } catch (error) {
      close();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;

    for (const cancel of this.cancellations.values()) {
      cancel();
    }

    await this.worker?.close();

    for (const close of this.streams) {
      close();
    }

    await this.queue?.close();
    this.subscriber?.disconnect();
    this.publisher?.disconnect();
  }

  private initialize(): Promise<void> {
    this.initializing ??= this.connect();

    return this.initializing;
  }

  private async connect(): Promise<void> {
    const connection = this.redisOptions();

    this.publisher = new Redis(connection);
    this.publisher.on('error', error =>
      console.error('Worker Redis error:', error.message),
    );
    this.subscriber = new Redis(connection);
    this.subscriber.on('error', error =>
      console.error('Worker subscription error:', error.message),
    );
    this.subscriber.on('message', (_channel, id) => {
      this.cancellations.get(id)?.();
    });

    await this.publisher.ping();
    await this.subscriber.subscribe(this.cancelChannel);

    this.queue = new Queue<RunJob>(this.queueName, {connection});
    this.worker = new Worker<RunJob>(this.queueName, job => this.execute(job), {
      connection: {...connection, maxRetriesPerRequest: null},
      concurrency: this.concurrency,
      maxStalledCount: 0,
    });
    this.worker.on('error', error =>
      console.error('Worker queue error:', error.message),
    );
    this.worker.on('failed', (job, error) => {
      if (job) {
        this.finish(job.data.runId, {
          status: RUN_STATUS.Failed,
          error: error.message,
        }).catch(failure => console.error(failure));
      }
    });

    await this.worker.waitUntilReady();
  }

  private async execute(job: Job<RunJob>): Promise<void> {
    const id = job.data.runId;
    const {count} = await this.runs.updateAll(
      {status: RUN_STATUS.Running, startedAt: new Date()},
      {id, status: RUN_STATUS.Queued},
    );

    if (!count) {
      return;
    }

    const run = await this.runs.findById(id);
    let exampleUrl = this.exampleUrl;

    if (run.workspaceId) {
      const targets = (await this.runs.execute(
        'SELECT e.id, e.base_url AS "baseUrl" FROM auth.environment e JOIN auth.workspace w ON w.id = e.workspace_id WHERE e.id = $1 AND w.id = $2 AND e.deleted_at IS NULL AND w.deleted_at IS NULL',
        [run.environmentId, run.workspaceId],
      )) as {id: string; baseUrl: string}[];

      if (!targets.length) {
        await this.finish(run.id, {
          status: RUN_STATUS.Cancelled,
          error: 'Workspace or environment is no longer active',
        });

        return;
      }

      exampleUrl = targets[0].baseUrl;
    }

    const child = fork(
      path.join(__dirname, '../workers/browser-worker.js'),
      [],
      {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      },
    );
    let result: WorkerResult | undefined;
    let journal = Promise.resolve();
    let frames = Promise.resolve();
    let publishingFrame = false;
    let timedOut = false;
    let forceStop: ReturnType<typeof setTimeout> | undefined;

    const terminate = () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      if (child.connected) {
        child.send({type: 'cancel'});
      }

      forceStop ??= setTimeout(() => child.kill('SIGKILL'), 10000);
    };

    this.cancellations.set(id, terminate);

    const timeout = setTimeout(
      () => {
        timedOut = true;
        terminate();
      },
      run.agentInput
        ? positiveInteger('AI_RUN_TIMEOUT_SECONDS', 180) * 1000
        : this.timeoutMs,
    );

    child.on('message', (message: WorkerMessage) => {
      if (message.type === 'event') {
        journal = journal.then(() =>
          this.event(id, message.event, message.payload),
        );
        journal.catch(() => terminate());
      } else if (message.type === 'frame' && !publishingFrame) {
        publishingFrame = true;
        frames = this.publisher!.pipeline()
          .set(this.frameKey(id), message.data, 'EX', 30)
          .publish(this.frameChannel(id), message.data)
          .exec()
          .then(() => {})
          .catch(error => console.error('Frame publish failed:', error.message))
          .finally(() => {
            publishingFrame = false;
          });
      } else if (message.type === 'result') {
        result = message.result;
      }
    });

    const exited = new Promise<void>(resolve => {
      child.once('error', error => {
        result = {status: RUN_STATUS.Failed, error: error.message};
        resolve();
      });
      child.once('exit', (code, signal) => {
        if (!result) {
          result = {
            status: RUN_STATUS.Failed,
            error: `Worker exited without a result (${signal ?? code})`,
          };
        }

        resolve();
      });
    });

    try {
      await this.runs.updateById(id, {workerPid: child.pid});
      await this.event(id, 'worker.spawned', {pid: child.pid});
      child.send({
        type: 'start',
        input: {
          runId: id,
          scriptName: run.scriptName as WorkerScriptName,
          agentInput: run.agentInput,
          videoDirectory: path.dirname(this.videoPath(id)),
          exampleUrl,
          actionDelayMs: this.actionDelayMs,
        },
      });

      const starting = await this.runs.findById(id);

      if (starting.cancelRequested || this.stopping) {
        terminate();
      }

      await exited;
      await journal;
      await frames;

      const current = await this.runs.findById(id);

      if (timedOut) {
        result = {
          ...result!,
          status: RUN_STATUS.Failed,
          error: 'Worker execution timed out',
        };
      } else if (current.cancelRequested || this.stopping) {
        result = {...result!, status: RUN_STATUS.Cancelled, error: undefined};
      }

      await this.event(id, 'worker.exited', {pid: child.pid});
      await this.finish(id, result!);

      if (result!.status === RUN_STATUS.Failed) {
        throw new Error(result!.error ?? 'Browser execution failed');
      }
    } catch (error) {
      terminate();
      await exited;
      await journal.catch(() => {});
      await this.finish(id, {
        status: RUN_STATUS.Failed,
        error: (error as Error).message,
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      this.cancellations.delete(id);

      if (forceStop) {
        clearTimeout(forceStop);
      }
    }
  }

  private async finish(
    id: string,
    result: WorkerResult,
    queuedOnly = false,
  ): Promise<void> {
    let videoFile = result.videoFile;

    if (!videoFile) {
      try {
        await access(this.videoPath(id));
        videoFile = `${id}/session.webm`;
      } catch {
        videoFile = undefined;
      }
    }

    const transaction = await this.runs.beginTransaction(
      IsolationLevel.READ_COMMITTED,
    );
    const options = {transaction};

    let count = 0;

    try {
      const updated = await this.runs.updateAll(
        {
          status: result.status,
          endedAt: new Date(),
          error: result.error ?? null,
          videoFile: videoFile ?? null,
        },
        {
          id,
          status: {
            inq: queuedOnly
              ? [RUN_STATUS.Queued]
              : [RUN_STATUS.Queued, RUN_STATUS.Running],
          },
        },
        options,
      );

      count = updated.count;

      if (count) {
        const run = await this.runs.findById(id, undefined, options);

        if (run.agentInput) {
          const agentResult: AgentResult = result.agentResult ?? {
            verdict: AGENT_VERDICT.Inconclusive,
            summary: result.error ?? `Run ${result.status}`,
            confidence: 0,
            steps: [],
            observations: [],
            stopReason:
              result.status === RUN_STATUS.Cancelled
                ? 'cancelled'
                : 'provider_error',
            turns: 0,
            toolCalls: 0,
            model: process.env.AI_MODEL ?? 'qwen3:8b',
            promptVersion: AGENT_PROMPT_VERSION,
          };

          if (
            result.status === RUN_STATUS.Cancelled ||
            result.error === 'Worker execution timed out'
          ) {
            agentResult.verdict = AGENT_VERDICT.Inconclusive;
            agentResult.confidence = 0;
            agentResult.stopReason =
              result.status === RUN_STATUS.Cancelled ? 'cancelled' : 'timeout';
            agentResult.summary = result.error ?? 'Run cancelled';
          }

          await this.results.create(
            {
              runId: id,
              status: agentResult.verdict,
              confidence: agentResult.confidence,
              result: agentResult,
            },
            options,
          );
        }

        await this.events.create(
          {
            runId: id,
            type: `run.${result.status}`,
            payload: {error: result.error, videoFile},
          },
          options,
        );
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    if (count) {
      await this.publisher?.del(this.frameKey(id));
      await this.publisher?.publish(this.frameChannel(id), 'end');
    }
  }

  private async event(
    id: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events.create({runId: id, type, payload});
  }

  private redisOptions() {
    return {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
    };
  }

  private frameChannel(id: string): string {
    return `${this.queueName}:frames:${id}`;
  }

  private frameKey(id: string): string {
    return `${this.queueName}:frame:${id}`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
