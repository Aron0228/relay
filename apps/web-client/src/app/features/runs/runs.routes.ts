import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Runs · Relay',
    data: { pageTitle: 'Runs' },
    loadComponent: () => import('./runs').then((module) => module.RunsPage),
  },
];
