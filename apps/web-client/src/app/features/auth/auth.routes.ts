import { Routes } from '@angular/router';
import { guestGuard } from './auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Log in to Relay',
    loadComponent: () => import('./login/login').then((module) => module.Login),
  },
  {
    path: 'callback',
    title: 'Signing in - Relay',
    loadComponent: () => import('./callback/callback').then((module) => module.AuthCallback),
  },
];
