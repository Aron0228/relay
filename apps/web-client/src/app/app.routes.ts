import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then((module) => module.routes),
  },
  {
    path: '',
    loadChildren: () =>
      import('./features/workspace/workspace.routes').then((module) => module.routes),
  },
  { path: '**', redirectTo: 'overview' },
];
