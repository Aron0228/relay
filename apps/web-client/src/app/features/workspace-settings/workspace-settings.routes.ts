import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Workspace Settings · Relay',
    data: { pageTitle: 'Workspace Settings' },
    loadComponent: () =>
      import('./workspace-settings').then((module) => module.WorkspaceSettingsPage),
  },
];
