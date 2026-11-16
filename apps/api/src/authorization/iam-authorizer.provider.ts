import {AuthorizationDecision, Authorizer} from '@loopback/authorization';
import {inject, Provider} from '@loopback/core';
import {SecurityBindings, securityId, UserProfile} from '@loopback/security';
import type {IamAuthorizationService} from '../services/iam-authorization.service';
import {IAM_AUTHORIZATION_SERVICE_BINDING_KEY} from './keys';
import {IamAuthorizationMetadata} from './authorize-iam';
import {IAM_ACTION, IAM_RESOURCE_TYPE} from './types';

export class IamAuthorizerProvider implements Provider<Authorizer> {
  constructor(
    @inject(IAM_AUTHORIZATION_SERVICE_BINDING_KEY)
    private authorization: IamAuthorizationService,
  ) {}

  value(): Authorizer<IamAuthorizationMetadata> {
    return async (context, metadata) => {
      const profile = await context.invocationContext.get<UserProfile>(
        SecurityBindings.USER,
        {optional: true},
      );
      const userId = profile?.[securityId];
      const action = Object.values(IAM_ACTION).find(
        value => metadata.scopes?.length === 1 && value === metadata.scopes[0],
      );
      const type = Object.values(IAM_RESOURCE_TYPE).find(
        value => value === metadata.resource,
      );
      const argument =
        context.invocationContext.args[metadata.resourceIdArgument ?? 0];
      const id =
        type === IAM_RESOURCE_TYPE.User
          ? userId
          : metadata.resourceIdProperty
            ? argument?.[metadata.resourceIdProperty]
            : argument;

      if (!userId || !action || !type || typeof id !== 'string') {
        return AuthorizationDecision.DENY;
      }

      await this.authorization.assert(userId, action, {type, id});

      return AuthorizationDecision.ALLOW;
    };
  }
}
