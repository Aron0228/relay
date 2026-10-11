import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Overview · Relay',
    data: { pageTitle: 'Overview' },
    loadComponent: () => import('./overview').then((module) => module.OverviewPage),
  },
];
