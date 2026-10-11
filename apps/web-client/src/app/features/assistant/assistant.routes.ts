import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Assistant · Relay',
    data: { pageTitle: 'Assistant' },
    loadComponent: () => import('./assistant').then((module) => module.AssistantPage),
  },
];
