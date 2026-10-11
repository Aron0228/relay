import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Pull Requests · Relay',
    data: { pageTitle: 'Pull Requests' },
    loadComponent: () => import('./pull-requests').then((module) => module.PullRequestsPage),
  },
];
