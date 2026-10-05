import {inject, service} from '@loopback/core';
import {get, param, Response, RestBindings} from '@loopback/rest';
import {OAuthClientType, OAUTH_CLIENT_TYPE} from '../models';
import {SessionService} from '../services';

export class SessionController {
  constructor(
    @service(SessionService) private sessionService: SessionService,
    @inject(RestBindings.Http.RESPONSE) private response: Response,
  ) {}

  @get('/api/sessions/login', {
    responses: {
      '302': {
        description: 'Redirect to GitHub to authorize the login',
        headers: {Location: {schema: {type: 'string'}}},
      },
    },
  })
  async login(
    @param.query.string('client', {
      schema: {
        type: 'string',
        enum: Object.values(OAUTH_CLIENT_TYPE),
        default: OAUTH_CLIENT_TYPE.Web,
      },
    })
    client: OAuthClientType = OAUTH_CLIENT_TYPE.Web,
  ): Promise<void> {
    const url = await this.sessionService.createOAuthLoginUrl(client);
    this.response.setHeader('Cache-Control', 'no-store');
    this.response.redirect(302, url);
  }
}
