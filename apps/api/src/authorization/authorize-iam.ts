import {authorize, AuthorizationMetadata} from '@loopback/authorization';
import {IAM_AUTHORIZER_BINDING_KEY} from './keys';
import {IamAction, IamResourceType} from './types';

export interface IamAuthorizationMetadata extends AuthorizationMetadata {
  resourceIdArgument?: number;
  resourceIdProperty?: string;
}

export function authorizeIam(
  action: IamAction,
  resource: IamResourceType,
  resourceIdArgument = 0,
  resourceIdProperty?: string,
) {
  const metadata: IamAuthorizationMetadata = {
    voters: [IAM_AUTHORIZER_BINDING_KEY],
    resource,
    scopes: [action],
    resourceIdArgument,
    resourceIdProperty,
  };

  return authorize(metadata);
}
