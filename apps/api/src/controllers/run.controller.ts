import {authenticate} from '@loopback/authentication';
import {inject, service} from '@loopback/core';
import {
  get,
  HttpErrors,
  param,
  post,
  requestBody,
  Response,
  RestBindings,
} from '@loopback/rest';
import {SecurityBindings, securityId, UserProfile} from '@loopback/security';
import {isRunFinished, Run} from '../models';
import {WorkerService} from '../services';
import {WorkerScriptName, WORKER_SCRIPT} from '../workers/protocol';

export class RunController {
  constructor(
    @service(WorkerService) private workers: WorkerService,
    @inject(RestBindings.Http.RESPONSE) private response: Response,
  ) {}

  @post('/api/runs', {responses: {'202': {description: 'Run queued'}}})
  @authenticate('session')
  async create(
    @requestBody({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['scriptName'],
            properties: {
              scriptName: {type: 'string', enum: Object.values(WORKER_SCRIPT)},
            },
            additionalProperties: false,
          },
        },
      },
    })
    body: {scriptName: WorkerScriptName},
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<object> {
    const {run, viewToken} = await this.workers.create(
      body.scriptName,
      user[securityId],
    );

    this.response.status(202);
    this.response.setHeader('Cache-Control', 'no-store');

    return {
      ...this.publicRun(run),
      streamUrl: `/api/runs/${run.id}/stream?token=${viewToken}`,
      videoUrl: `/api/runs/${run.id}/video?token=${viewToken}`,
    };
  }

  @post('/api/runs/agent', {
    responses: {'202': {description: 'Agent run queued'}},
  })
  @authenticate('session')
  async createAgent(
    @requestBody({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['prompt'],
            additionalProperties: false,
            properties: {
              prompt: {type: 'string', minLength: 1, maxLength: 4000},
              targetUrl: {type: 'string', format: 'uri', maxLength: 2000},
            },
          },
        },
      },
    })
    body: {prompt: string; targetUrl?: string},
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<object> {
    const {run, viewToken} = await this.workers.create(
      WORKER_SCRIPT.Agent,
      user[securityId],
      {
        prompt: body.prompt,
        targetUrl: body.targetUrl ?? 'https://academybugs.com/',
      },
    );

    this.response.status(202);
    this.response.setHeader('Cache-Control', 'no-store');

    return {
      ...this.publicRun(run),
      activityUrl: `/api/runs/${run.id}/activity`,
      resultUrl: `/api/runs/${run.id}/result`,
      streamUrl: `/api/runs/${run.id}/stream?token=${viewToken}`,
      videoUrl: `/api/runs/${run.id}/video?token=${viewToken}`,
    };
  }

  @get('/api/runs/{id}/result')
  @authenticate('session')
  async result(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    await this.workers.getOwned(id, user[securityId]);

    return this.workers.getResult(id);
  }

  @get('/api/runs/{id}/activity')
  @authenticate('session')
  async activity(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
    @param.query.number('after', {schema: {type: 'integer', minimum: 0}})
    after = 0,
  ): Promise<Response> {
    await this.workers.getOwned(id, user[securityId]);
    await this.workers.activity(id, this.response, after);

    return this.response;
  }

  @get('/api/runs/{id}')
  @authenticate('session')
  async get(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<object> {
    const run = await this.workers.getOwned(id, user[securityId]);

    return this.publicRun(run);
  }

  @get('/api/runs/{id}/events')
  @authenticate('session')
  async events(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ) {
    await this.workers.getOwned(id, user[securityId]);

    return this.workers.listEvents(id);
  }

  @post('/api/runs/{id}/cancel', {
    responses: {'204': {description: 'Cancellation requested'}},
  })
  @authenticate('session')
  async cancel(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<void> {
    await this.workers.getOwned(id, user[securityId]);
    await this.workers.cancel(id);

    this.response.status(204);
  }

  @get('/api/runs/{id}/stream', {
    responses: {
      '200': {
        description: 'Live browser frames',
        content: {
          'multipart/x-mixed-replace': {
            schema: {type: 'string', format: 'binary'},
          },
        },
      },
      '302': {description: 'Run finished; redirect to recording'},
    },
  })
  async stream(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.query.string('token') token?: string,
  ): Promise<Response> {
    const run = await this.workers.getViewable(id, token);

    this.mediaHeaders();

    if (isRunFinished(run.status)) {
      if (!run.videoFile) {
        throw new HttpErrors.NotFound('No recording is available for this run');
      }

      this.response.redirect(
        302,
        `/api/runs/${id}/video?token=${encodeURIComponent(token!)}`,
      );
    } else {
      await this.workers.stream(run, this.response);
    }

    return this.response;
  }

  @get('/api/runs/{id}/video', {
    responses: {
      '200': {
        description: 'Persisted recording',
        content: {'video/webm': {schema: {type: 'string', format: 'binary'}}},
      },
    },
  })
  async video(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @param.query.string('token') token?: string,
  ): Promise<Response> {
    const run = await this.workers.getViewable(id, token);

    if (!isRunFinished(run.status) || !run.videoFile) {
      throw new HttpErrors.NotFound('Recording is not available yet');
    }

    this.mediaHeaders();
    this.response.setHeader('Content-Type', 'video/webm');
    await new Promise<void>((resolve, reject) =>
      this.response.sendFile(this.workers.videoPath(run.id), error =>
        error ? reject(error) : resolve(),
      ),
    );

    return this.response;
  }

  private publicRun(run: Run): object {
    return {
      id: run.id,
      scriptName: run.scriptName,
      status: run.status,
      workerPid: run.workerPid,
      videoFile: run.videoFile,
      error: run.error,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    };
  }

  private mediaHeaders(): void {
    this.response.setHeader('Cache-Control', 'no-store');
    this.response.setHeader('Referrer-Policy', 'no-referrer');
    this.response.setHeader('X-Content-Type-Options', 'nosniff');
  }
}
