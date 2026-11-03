import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';
import { consumeIssueUrl, rememberIssueUrl } from './return-url';

export const sessionGuard: CanActivateFn = async (_route, state) => {
  const sessions = inject(SessionService);
  const router = inject(Router);
  const profile = await sessions.restore();

  if (!profile) rememberIssueUrl(state.url);

  return profile ? true : router.createUrlTree(['/auth/login']);
};

export const guestGuard: CanActivateFn = async () => {
  const sessions = inject(SessionService);
  const router = inject(Router);
  const profile = await sessions.restore();

  return profile ? router.parseUrl(consumeIssueUrl() ?? '/workspaces') : true;
};
