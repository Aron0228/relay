import { Routes } from '@angular/router';
import { sessionGuard } from '../auth/auth.guards';

export const routes: Routes = [
  {
    path: '',
    canActivate: [sessionGuard],
    canActivateChild: [sessionGuard],
    loadComponent: () => import('./workspace-shell').then((module) => module.WorkspaceShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
      {
        path: 'overview',
        loadChildren: () => import('../overview/overview.routes').then((module) => module.routes),
      },
      {
        path: 'assistant',
        loadChildren: () => import('../assistant/assistant.routes').then((module) => module.routes),
      },
      {
        path: 'workspace-settings',
        loadChildren: () =>
          import('../workspace-settings/workspace-settings.routes').then((module) => module.routes),
      },
      {
        path: 'workers',
        loadChildren: () => import('../workers/workers.routes').then((module) => module.routes),
      },
      {
        path: 'runs',
        loadChildren: () => import('../runs/runs.routes').then((module) => module.routes),
      },
      {
        path: 'issues',
        loadChildren: () => import('../issues/issues.routes').then((module) => module.routes),
      },
      {
        path: 'pull-requests',
        loadChildren: () =>
          import('../pull-requests/pull-requests.routes').then((module) => module.routes),
      },
    ],
  },
];
