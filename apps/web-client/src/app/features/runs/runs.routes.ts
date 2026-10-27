import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: ':id',
    title: 'Runs · Relay',
    data: { pageTitle: 'Runs', liveView: false },
    loadComponent: () => import('../execution/run-detail').then((module) => module.RunDetail),
  },
  {
    path: '',
    title: 'Runs · Relay',
    data: { pageTitle: 'Runs' },
    loadComponent: () => import('./runs').then((module) => module.RunsPage),
  },
];
