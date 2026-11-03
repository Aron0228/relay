import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: ':id',
    title: 'Issue · Relay',
    data: { pageTitle: 'Issues' },
    loadComponent: () => import('./issue-detail').then((module) => module.IssueDetailPage),
  },
  {
    path: '',
    title: 'Issues · Relay',
    data: { pageTitle: 'Issues' },
    loadComponent: () => import('./issues').then((module) => module.IssuesPage),
  },
];
