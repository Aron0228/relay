import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: ':id',
    title: 'Workers · Relay',
    data: { pageTitle: 'Workers', liveView: true },
    loadComponent: () => import('../execution/run-detail').then((module) => module.RunDetail),
  },
  {
    path: '',
    title: 'Workers · Relay',
    data: { pageTitle: 'Workers' },
    loadComponent: () => import('./workers').then((module) => module.WorkersPage),
  },
];
