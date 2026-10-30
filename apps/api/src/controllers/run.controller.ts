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
import {WorkspaceService, WorkerService} from '../services';
import {WorkerScriptName, WORKER_SCRIPT} from '../workers/protocol';

export class RunController {
  constructor(
    @service(WorkerService) private workers: WorkerService,
    @service(WorkspaceService) private workspaces: WorkspaceService,
    @inject(RestBindings.Http.RESPONSE) private response: Response,
  ) {}

  @get('/api/runs')
  @authenticate('session')
  async list(
    @inject(SecurityBindings.USER) user: UserProfile,
    @param.query.string('scope', {
      schema: {type: 'string', enum: ['all', 'active', 'queued']},
    })
    scope = 'all',
    @param.query.string('search', {schema: {type: 'string', maxLength: 200}})
    search = '',
    @param.query.string('before', {schema: {type: 'string', format: 'uuid'}})
    before?: string,
    @param.query.string('workspaceId', {
      schema: {type: 'string', format: 'uuid'},
    })
    workspaceId?: string,
  ) {
    if (workspaceId)
      await this.workspaces.requireMember(workspaceId, user[securityId]);
    const page = await this.workers.listOwned(
      user[securityId],
      scope,
      search,
      before,
      25,
      workspaceId,
    );

    this.response.setHeader('Cache-Control', 'no-store');

    return {...page, items: page.items.map(run => this.publicRun(run))};
  }

  @get('/api/runs/{id}/media/stream')
  @authenticate('session')
  async ownedStream(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<Response> {
    const run = await this.workers.getOwned(id, user[securityId]);

    if (isRunFinished(run.status)) {
      throw new HttpErrors.NotFound('The live session has ended');
    }

    this.mediaHeaders();
    await this.workers.stream(run, this.response, user[securityId]);

    return this.response;
  }

  @get('/api/runs/{id}/media/video')
  @authenticate('session')
  async ownedVideo(
    @param.path.string('id', {schema: {format: 'uuid'}}) id: string,
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<Response> {
    const run = await this.workers.getOwned(id, user[securityId]);

    if (!isRunFinished(run.status) || !run.videoFile) {
      throw new HttpErrors.NotFound('Recording is not available');
    }

    const video = await this.workers.playbackPath(id);

    this.mediaHeaders();
    this.response.setHeader('Content-Type', 'video/mp4');
    await new Promise<void>((resolve, reject) => {
      this.response.sendFile(video, error =>
        error ? reject(error) : resolve(),
      );
    });

    return this.response;
  }

  @post('/api/runs', {responses: {'202': {description: 'Run queued'}}})
  @authenticate('session')
  async create(
    @requestBody({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['scriptName', 'workspaceId', 'environmentId'],
            properties: {
              scriptName: {type: 'string', enum: Object.values(WORKER_SCRIPT)},
              workspaceId: {type: 'string', format: 'uuid'},
              environmentId: {type: 'string', format: 'uuid'},
            },
            additionalProperties: false,
          },
        },
      },
    })
    body: {
      scriptName: WorkerScriptName;
      workspaceId: string;
      environmentId: string;
    },
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<object> {
    await this.workspaces.environment(
      body.workspaceId,
      user[securityId],
      body.environmentId,
    );
    const {run} = await this.workers.create(
      body.scriptName,
      user[securityId],
      undefined,
      {workspaceId: body.workspaceId, environmentId: body.environmentId},
    );

    this.response.status(202);
    this.response.setHeader('Cache-Control', 'no-store');

    return {
      ...this.publicRun(run),
      streamUrl: `/api/runs/${run.id}/media/stream`,
      videoUrl: `/api/runs/${run.id}/media/video`,
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
            required: ['prompt', 'workspaceId', 'environmentId'],
            additionalProperties: false,
            properties: {
              prompt: {type: 'string', minLength: 1, maxLength: 4000},
              workspaceId: {type: 'string', format: 'uuid'},
              environmentId: {type: 'string', format: 'uuid'},
              targetUrl: {type: 'string', format: 'uri', maxLength: 2000},
            },
          },
        },
      },
    })
    body: {
      prompt: string;
      targetUrl?: string;
      workspaceId: string;
      environmentId: string;
    },
    @inject(SecurityBindings.USER) user: UserProfile,
  ): Promise<object> {
    const environment = await this.workspaces.environment(
      body.workspaceId,
      user[securityId],
      body.environmentId,
    );

    if (
      body.targetUrl &&
      new URL(body.targetUrl).toString() !== environment.baseUrl
    ) {
      throw new HttpErrors.BadRequest('Use the configured environment URL');
    }

    const {run} = await this.workers.create(
      WORKER_SCRIPT.Agent,
      user[securityId],
      {
        prompt: body.prompt,
        targetUrl: environment.baseUrl,
      },
      {workspaceId: body.workspaceId, environmentId: body.environmentId},
    );

    this.response.status(202);
    this.response.setHeader('Cache-Control', 'no-store');

    return {
      ...this.publicRun(run),
      activityUrl: `/api/runs/${run.id}/activity`,
      resultUrl: `/api/runs/${run.id}/result`,
      streamUrl: `/api/runs/${run.id}/media/stream`,
      videoUrl: `/api/runs/${run.id}/media/video`,
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
    await this.workers.activity(id, this.response, after, user[securityId]);

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
    @param.query.number('after', {schema: {type: 'integer', minimum: 0}})
    after = 0,
  ) {
    await this.workers.getOwned(id, user[securityId]);

    return this.workers.listEvents(id, after);
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
      workspaceId: run.workspaceId,
      environmentId: run.environmentId,
      scriptName: run.scriptName,
      title: run.agentInput?.prompt ?? 'Example browser test',
      targetUrl: run.agentInput?.targetUrl,
      cancelRequested: run.cancelRequested,
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
