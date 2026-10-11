import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Workers · Relay',
    data: { pageTitle: 'Workers' },
    loadComponent: () => import('./workers').then((module) => module.WorkersPage),
  },
];
