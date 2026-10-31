import {inject, service} from '@loopback/core';
import {get, HttpErrors, param, Response, RestBindings} from '@loopback/rest';
import {GithubConnectionService} from '../services/github-connection.service';

export class GithubInstallationCallbackController {
  constructor(
    @service(GithubConnectionService)
    private connections: GithubConnectionService,
    @inject(RestBindings.Http.RESPONSE) private response: Response,
  ) {}

  @get('/api/github/installations/callback')
  async callback(
    @param.query.string('state') state = '',
    @param.query.number('installation_id') installationId = 0,
    @param.query.string('setup_action') action = 'install',
  ): Promise<Response> {
    this.response.setHeader('Cache-Control', 'no-store');
    this.response.setHeader('Referrer-Policy', 'no-referrer');
    this.response.setHeader('X-Content-Type-Options', 'nosniff');
    this.response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'",
    );

    if (
      !Number.isSafeInteger(installationId) ||
      installationId <= 0 ||
      !['install', 'update'].includes(action)
    )
      throw new HttpErrors.BadRequest('Invalid GitHub installation callback');

    if (state)
      await this.connections.completeInstallation(
        state,
        installationId,
        action,
      );

    const title = state
      ? 'GitHub installation connected'
      : 'GitHub installation setup completed';
    const message =
      state || action === 'update'
        ? 'You can close this tab and return to the workspace.'
        : 'Return to the workspace GitHub settings and choose Connect installation to link this installation.';

    const document = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
    <style>
      body {font: 16px system-ui; background: #101112; color: #f5f5f5; padding: 32px; line-height: 1.6;}
      main {max-width: 640px; margin: 48px auto;}
    </style>
  </head>
  <body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;

    return this.response.type('html').send(document);
  }
}
