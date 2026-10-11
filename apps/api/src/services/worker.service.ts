import {BindingScope, inject, lifeCycleObserver} from '@loopback/core';
import {repository} from '@loopback/repository';
import {HttpErrors, Response} from '@loopback/rest';
import {Job, Queue, Worker} from 'bullmq';
import Redis from 'ioredis';
import {fork} from 'node:child_process';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {isRunFinished, Run, RUN_STATUS} from '../models';
import {RunEventRepository, RunRepository} from '../repositories';
import {
  WorkerMessage,
  WorkerResult,
  WorkerScriptName,
  WORKER_SCRIPT,
} from '../workers/protocol';

export const WORKER_SERVICE_BINDING_KEY = 'services.WorkerService';
export const WORKER_SERVICE_OPTIONS_BINDING_KEY = 'services.WorkerService.options';

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
  ): Promise<{run: Run; viewToken: string}> {
    if (this.stopping) {
      throw new HttpErrors.ServiceUnavailable(
        'Worker infrastructure is stopping',
      );
    }

    if (!Object.values(WORKER_SCRIPT).includes(scriptName)) {
      throw new HttpErrors.BadRequest('Unknown worker script');
    }

    await this.initialize();

    const viewToken = randomBytes(32).toString('hex');
    const run = await this.runs.create({
      id: randomUUID(),
      userId,
      scriptName,
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

  async getOwned(id: string, userId: string): Promise<Run> {
    const run = await this.runs.findOne({where: {id, userId}});

    if (!run) {
      throw new HttpErrors.NotFound('Run not found');
    }

    return run;
  }

  async getViewable(id: string, token?: string): Promise<Run> {
    const run = await this.runs.findOne({where: {id}});

    if (
      !run ||
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

    const queued = await this.runs.updateAll(
      {status: RUN_STATUS.Cancelled, endedAt: new Date()},
      {id, status: RUN_STATUS.Queued},
    );

    if (queued.count) {
      await this.event(id, 'run.cancelled', {});
      await this.publisher!.publish(this.frameChannel(id), 'end');
    }
  }

  async listEvents(id: string) {
    return this.events.find({
      where: {runId: id},
      order: ['sequence ASC'],
      limit: 1000,
    });
  }

  videoPath(id: string): string {
    return path.join(this.videoDirectory, id, 'session.webm');
  }

  async stream(run: Run, response: Response): Promise<void> {
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
      this.runs
        .findById(run.id)
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

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, this.timeoutMs);

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
          videoDirectory: path.dirname(this.videoPath(id)),
          exampleUrl: this.exampleUrl,
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

  private async finish(id: string, result: WorkerResult): Promise<void> {
    let videoFile = result.videoFile;

    if (!videoFile) {
      try {
        await access(this.videoPath(id));
        videoFile = `${id}/session.webm`;
      } catch {
        videoFile = undefined;
      }
    }

    const {count} = await this.runs.updateAll(
      {
        status: result.status,
        endedAt: new Date(),
        error: result.error ?? null,
        videoFile: videoFile ?? null,
      },
      {id, status: {inq: [RUN_STATUS.Queued, RUN_STATUS.Running]}},
    );

    if (count) {
      await this.event(id, `run.${result.status}`, {
        error: result.error,
        videoFile,
      });
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
