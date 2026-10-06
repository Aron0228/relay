import {inject, service} from '@loopback/core';
import {authenticate} from '@loopback/authentication';
import {SecurityBindings, UserProfile} from '@loopback/security';
import {
  get,
  HttpErrors,
  param,
  post,
  requestBody,
  Request,
  Response,
  RestBindings,
} from '@loopback/rest';
import {OAuthClientType, OAUTH_CLIENT_TYPE} from '../models';
import {
  LoginRateLimitService,
  OAuthCallbackService,
  SESSION_COOKIE_NAME,
  SessionExchangeService,
  SessionService,
} from '../services';
import {getSessionToken} from '../utils/session-token';

export class SessionController {
  constructor(
    @service(SessionService) private sessionService: SessionService,
    @inject(RestBindings.Http.RESPONSE) private response: Response,
    @service(OAuthCallbackService) private oauthCallback: OAuthCallbackService,
    @service(SessionExchangeService)
    private sessionExchange: SessionExchangeService,
    @service(LoginRateLimitService)
    private loginRateLimit: LoginRateLimitService,
  ) {}

  @authenticate('session')
  @get('/api/sessions/me', {
    responses: {
      '200': {
        description: 'The authenticated user profile',
        content: {'application/json': {schema: {type: 'object'}}},
      },
      '401': {description: 'A valid session is required'},
    },
  })
  me(@inject(SecurityBindings.USER) profile: UserProfile): UserProfile {
    this.response.setHeader('Cache-Control', 'no-store');
    return profile;
  }

  @post('/api/sessions/logout', {
    responses: {'204': {description: 'Session invalidated and cookie cleared'}},
  })
  async logout(
    @inject(RestBindings.Http.REQUEST) request: Request,
  ): Promise<void> {
    this.response.setHeader('Cache-Control', 'no-store');

    const token = getSessionToken(request);

    if (token) await this.sessionService.invalidate(token);

    // Allow logout even after expiry so the browser can always clear its cookie.
    this.response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    this.response.status(204);
  }

  @get('/api/sessions/login', {
    responses: {
      '302': {
        description: 'Redirect to GitHub to authorize the login',
        headers: {Location: {schema: {type: 'string'}}},
      },
      '429': {
        description: 'Too many login attempts; retry after the indicated delay',
      },
      '503': {description: 'Login rate limiting is temporarily unavailable'},
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
    @inject(RestBindings.Http.REQUEST) request: Request,
  ): Promise<void> {
    this.response.setHeader('Cache-Control', 'no-store');

    const retryAfter = await this.loginRateLimit.consume(
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );

    if (retryAfter) {
      this.response.setHeader('Retry-After', String(retryAfter));

      throw new HttpErrors.TooManyRequests(
        'Too many login attempts. Please try again later.',
      );
    }

    const url = await this.sessionService.createOAuthLoginUrl(client);

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
