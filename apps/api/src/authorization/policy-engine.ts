import {AuthorizationDecision} from '@loopback/authorization';
import {IAM_POLICIES} from './policies';
import {IAM_EFFECT, IAM_ROLE, IamPolicy, IamRequest, IamRole} from './types';

export class IamPolicyEngine {
  constructor(private readonly policies: readonly IamPolicy[] = IAM_POLICIES) {}

  evaluate(request: IamRequest): AuthorizationDecision {
    const {subject, action, resource} = request;

    if (
      !subject.id ||
      !resource.id ||
      (resource.workspaceId &&
        (subject.workspaceId !== resource.workspaceId || !subject.role))
    ) {
      return AuthorizationDecision.DENY;
    }

    const roles: IamRole[] = subject.role ? [subject.role] : [];

    if (subject.isOwner) roles.push(IAM_ROLE.Owner);

    let allowed = false;

    for (const policy of this.policies) {
      if (
        policy.resourceType !== resource.type ||
        !policy.actions.includes(action) ||
        (policy.roles && !policy.roles.some(role => roles.includes(role))) ||
        (policy.condition && !policy.condition(request))
      ) {
        continue;
      }

      if (policy.effect === IAM_EFFECT.Deny) return AuthorizationDecision.DENY;

      allowed = true;
    }

    return allowed ? AuthorizationDecision.ALLOW : AuthorizationDecision.DENY;
  }
}
