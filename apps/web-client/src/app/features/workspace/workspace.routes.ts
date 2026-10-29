import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { WorkspaceService } from './workspace.service';
import { sessionGuard } from '../auth/auth.guards';

const workspaceGuard = async () => {
  const workspaces = inject(WorkspaceService);
  const router = inject(Router);

  await workspaces.ensureLoaded();

  return workspaces.active() ? true : router.createUrlTree(['/workspaces']);
};

export const routes: Routes = [
  {
    path: 'workspaces',
    canActivate: [sessionGuard],
    canActivateChild: [sessionGuard],
    loadComponent: () => import('./workspace-home').then((module) => module.WorkspaceHome),
    children: [
      {
        path: '',
        loadComponent: () => import('./workspace-list').then((module) => module.WorkspaceList),
        title: 'Workspaces · Relay',
      },
      {
        path: 'new',
        loadComponent: () => import('./workspace-create').then((module) => module.WorkspaceCreate),
        title: 'Create workspace · Relay',
      },
    ],
  },
  {
    path: '',
    canActivate: [sessionGuard],
    canActivateChild: [sessionGuard, workspaceGuard],
    loadComponent: () => import('./workspace-shell').then((module) => module.WorkspaceShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'workspaces' },
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
