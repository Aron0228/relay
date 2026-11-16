import {AuthorizationDecision} from '@loopback/authorization';
import {describe, expect, it} from 'vitest';
import {IAM_POLICIES} from '../../../authorization/policies';
import {IamPolicyEngine} from '../../../authorization/policy-engine';
import {
  IAM_ACTION,
  IAM_EFFECT,
  IAM_RESOURCE_TYPE,
  IAM_ROLE,
  IamPolicy,
  IamRequest,
} from '../../../authorization/types';

const read: IamRequest = {
  subject: {id: 'finn', workspaceId: 'foo', role: IAM_ROLE.Member},
  action: IAM_ACTION.WorkspaceRead,
  resource: {
    type: IAM_RESOURCE_TYPE.Workspace,
    id: 'foo',
    workspaceId: 'foo',
  },
};

describe('IAM policy engine', () => {
  const engine = new IamPolicyEngine();

  it.each([
    IAM_ACTION.WorkspaceList,
    IAM_ACTION.WorkspaceCreate,
    IAM_ACTION.InvitationList,
    IAM_ACTION.RunList,
  ])('restricts %s to the authenticated user', action => {
    const request: IamRequest = {
      subject: {id: 'foo'},
      action,
      resource: {type: IAM_RESOURCE_TYPE.User, id: 'foo'},
    };

    expect(engine.evaluate(request)).toBe(AuthorizationDecision.ALLOW);
    expect(
      engine.evaluate({...request, resource: {...request.resource, id: 'bar'}}),
    ).toBe(AuthorizationDecision.DENY);
  });

  it('allows only the invitation recipient to respond', () => {
    const request: IamRequest = {
      subject: {id: 'foo'},
      action: IAM_ACTION.InvitationRespond,
      resource: {
        type: IAM_RESOURCE_TYPE.Invitation,
        id: 'bar',
        recipientId: 'foo',
      },
    };

    expect(engine.evaluate(request)).toBe(AuthorizationDecision.ALLOW);
    expect(engine.evaluate({...request, subject: {id: 'baz'}})).toBe(
      AuthorizationDecision.DENY,
    );
  });

  it('allows workspace members to read and denies modification', () => {
    expect(engine.evaluate(read)).toBe(AuthorizationDecision.ALLOW);
    expect(engine.evaluate({...read, action: IAM_ACTION.WorkspaceUpdate})).toBe(
      AuthorizationDecision.DENY,
    );
  });

  it('allows admins and the database-derived owner to update the workspace', () => {
    for (const subject of [
      {...read.subject, role: IAM_ROLE.Admin},
      {...read.subject, isOwner: true},
    ]) {
      expect(
        engine.evaluate({...read, subject, action: IAM_ACTION.WorkspaceUpdate}),
      ).toBe(AuthorizationDecision.ALLOW);
    }
  });

  it('preserves the stored admin-role requirement for workspace management', () => {
    expect(
      engine.evaluate({
        ...read,
        subject: {...read.subject, isOwner: true},
        action: IAM_ACTION.WorkspaceManage,
      }),
    ).toBe(AuthorizationDecision.DENY);
  });

  it('denies cross-workspace access even for an owner', () => {
    expect(
      engine.evaluate({
        ...read,
        subject: {...read.subject, workspaceId: 'bar', isOwner: true},
      }),
    ).toBe(AuthorizationDecision.DENY);
  });

  it('requires membership and an identified subject', () => {
    expect(
      engine.evaluate({...read, subject: {...read.subject, role: undefined}}),
    ).toBe(AuthorizationDecision.DENY);
    expect(engine.evaluate({...read, subject: {...read.subject, id: ''}})).toBe(
      AuthorizationDecision.DENY,
    );
  });

  it('denies unmatched actions, resources and an empty policy set', () => {
    expect(engine.evaluate({...read, action: IAM_ACTION.TaskCancel})).toBe(
      AuthorizationDecision.DENY,
    );
    expect(
      engine.evaluate({
        ...read,
        resource: {...read.resource, type: IAM_RESOURCE_TYPE.Run},
      }),
    ).toBe(AuthorizationDecision.DENY);
    expect(new IamPolicyEngine([]).evaluate(read)).toBe(
      AuthorizationDecision.DENY,
    );
  });

  it.each([
    [IAM_RESOURCE_TYPE.Run, IAM_ACTION.RunCancel],
    [IAM_RESOURCE_TYPE.Task, IAM_ACTION.TaskCancel],
  ] as const)(
    'limits member cancellation of %s to their own request',
    (type, action) => {
      const request: IamRequest = {
        ...read,
        action,
        resource: {...read.resource, type, initiatorId: 'finn'},
      };

      expect(engine.evaluate(request)).toBe(AuthorizationDecision.ALLOW);
      expect(
        engine.evaluate({
          ...request,
          resource: {...request.resource, initiatorId: 'jake'},
        }),
      ).toBe(AuthorizationDecision.DENY);
      expect(
        engine.evaluate({
          ...request,
          subject: {...read.subject, role: IAM_ROLE.Admin},
          resource: {...request.resource, initiatorId: 'jake'},
        }),
      ).toBe(AuthorizationDecision.ALLOW);
    },
  );

  it.each([false, true])(
    'explicit deny wins regardless of policy order (%s)',
    first => {
      const deny: IamPolicy = {
        name: 'bar-restriction',
        effect: IAM_EFFECT.Deny,
        actions: [IAM_ACTION.WorkspaceRead],
        resourceType: IAM_RESOURCE_TYPE.Workspace,
        condition: ({resource}) => resource.id === 'foo',
      };
      const policies = first
        ? [deny, ...IAM_POLICIES]
        : [...IAM_POLICIES, deny];

      expect(new IamPolicyEngine(policies).evaluate(read)).toBe(
        AuthorizationDecision.DENY,
      );
    },
  );
});
