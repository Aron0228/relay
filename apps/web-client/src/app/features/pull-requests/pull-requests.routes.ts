import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: ':id',
    title: 'Pull request · Relay',
    data: { pageTitle: 'Pull Requests', resource: 'pull-requests' },
    loadComponent: () => import('../issues/issue-detail').then((module) => module.IssueDetailPage),
  },
  {
    path: '',
    title: 'Pull Requests · Relay',
    data: { pageTitle: 'Pull Requests', resource: 'pull-requests' },
    loadComponent: () => import('../issues/issues').then((module) => module.IssuesPage),
  },
];
