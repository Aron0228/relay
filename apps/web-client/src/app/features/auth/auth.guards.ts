import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

export const sessionGuard: CanActivateFn = async () => {
  const sessions = inject(SessionService);
  const router = inject(Router);
  const profile = await sessions.restore();

  return profile ? true : router.createUrlTree(['/auth/login']);
};

export const guestGuard: CanActivateFn = async () => {
  const sessions = inject(SessionService);
  const router = inject(Router);
  const profile = await sessions.restore();

  return profile ? router.createUrlTree(['/overview']) : true;
};
