import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Issues · Relay',
    data: { pageTitle: 'Issues' },
    loadComponent: () => import('./issues').then((module) => module.IssuesPage),
  },
];
