import {inject, service} from '@loopback/core';
import {
  get,
  param,
  post,
  requestBody,
  Response,
  RestBindings,
} from '@loopback/rest';
import {OAuthClientType, OAUTH_CLIENT_TYPE} from '../models';
import {
  OAuthCallbackService,
  SESSION_COOKIE_NAME,
  SessionExchangeService,
  SessionService,
} from '../services';

export class SessionController {
  constructor(
    @service(SessionService) private sessionService: SessionService,
    @inject(RestBindings.Http.RESPONSE) private response: Response,
    @service(OAuthCallbackService) private oauthCallback: OAuthCallbackService,
    @service(SessionExchangeService)
    private sessionExchange: SessionExchangeService,
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

  @get('/api/sessions/callback', {
    responses: {
      '302': {
        description: 'Redirect to the approved client with an exchange code',
        headers: {Location: {schema: {type: 'string'}}},
      },
    },
  })
  async callback(
    @param.query.string('state') state?: string,
    @param.query.string('code') code?: string,
    @param.query.string('error') error?: string,
  ): Promise<void> {
    this.response.setHeader('Cache-Control', 'no-store');
    this.response.setHeader('Referrer-Policy', 'no-referrer');

    const url = await this.oauthCallback.callback(state, code, error);

    this.response.redirect(302, url);
  }

  @post('/api/sessions/exchange', {
    responses: {
      '200': {
        description: 'Web session cookie or mobile session token',
        content: {
          'application/json': {
            schema: {
              oneOf: [
                {type: 'object', additionalProperties: false},
                {
                  type: 'object',
                  required: ['token'],
                  properties: {token: {type: 'string'}},
                  additionalProperties: false,
                },
              ],
            },
          },
        },
      },
      '401': {
        description: 'Invalid, expired, or already consumed exchange code',
      },
    },
  })
  async exchange(
    @requestBody({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['exchangeCode'],
            properties: {
              exchangeCode: {type: 'string', pattern: '^[A-Za-z0-9_-]{43}$'},
            },
            additionalProperties: false,
          },
        },
      },
    })
    body: {
      exchangeCode: string;
    },
  ): Promise<{token?: string}> {
    this.response.setHeader('Cache-Control', 'no-store');

    const {token, session, clientType} = await this.sessionExchange.exchange(
      body.exchangeCode,
    );

    if (clientType === OAUTH_CLIENT_TYPE.Web) {
      this.response.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        expires: session.absoluteExpiresAt,
      });

      return {};
    }

    return {token};
  }
}
