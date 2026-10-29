import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../auth/session.service';
import { firstValueFrom } from 'rxjs';

declare const API_BASE_URL: string;

export interface Workspace {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role: 'admin' | 'member';
  isOwner?: boolean;
  memberCount?: number;
}
export interface Environment {
  id: string;
  name: string;
  baseUrl: string;
}
export interface WorkspaceMember {
  userId: string;
  username: string;
  role: 'admin' | 'member';
  isOwner?: boolean;
}
export interface WorkspaceInvitation {
  id: string;
  email: string;
  workspaceName?: string;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private readonly http = inject(HttpClient);
  private readonly sessions = inject(SessionService);
  private loading?: Promise<void>;
  private readonly router = inject(Router);
  readonly items = signal<Workspace[]>([]);
  readonly active = signal<Workspace | null>(null);
  readonly ready = signal(false);
  readonly error = signal('');
  readonly admin = computed(() => this.active()?.role === 'admin');

  request<T>(method: string, path: string, body?: unknown) {
    return firstValueFrom(
      this.http.request<T>(method, `${API_BASE_URL}${path}`, { body, withCredentials: true }),
    );
  }

  private storageKey() {
    return `relay.workspace.${String(this.sessions.profile()?.['id'] ?? 'current')}`;
  }

  private remember(id: string | null) {
    try {
      if (id) localStorage.setItem(this.storageKey(), id);
      else localStorage.removeItem(this.storageKey());
    } catch {
      /* Selection still works if browser storage is unavailable. */
    }
  }

  ensureLoaded() {
    if (this.ready()) return Promise.resolve();

    this.loading ??= this.refresh().finally(() => {
      this.loading = undefined;
    });

    return this.loading;
  }

  async refresh() {
    this.error.set('');

    try {
      const items = await this.request<Workspace[]>('GET', '/workspaces');
      let saved: string | null = null;

      try {
        saved = localStorage.getItem(this.storageKey());
      } catch {
        /* Use the in-memory selection. */
      }

      const selected = this.active()?.id ?? saved;
      const active = items.find((item) => item.id === selected) ?? null;

      this.items.set(items);
      this.active.set(active);
      this.remember(active?.id ?? null);
      this.ready.set(true);
    } catch {
      this.error.set('Could not load workspaces. Please try again.');
    }
  }

  activate(id: string) {
    const workspace = this.items().find((item) => item.id === id);

    if (!workspace) return;

    this.active.set(workspace);
    this.remember(id);
  }

  async select(id: string) {
    this.activate(id);
    await this.router.navigateByUrl('/overview');
  }

  async create(name: string) {
    const workspace = await this.request<Workspace>('POST', '/workspaces', { name });

    this.items.update((items) => [...items, workspace]);
    this.activate(workspace.id);

    return workspace;
  }

  avatarSource(url?: string | null) {
    return url?.startsWith('/api/') ? `${API_BASE_URL}${url.slice(4)}` : url;
  }

  uploadAvatar(id: string, file: File) {
    return firstValueFrom(
      this.http.post<{ avatarUrl: string }>(`${API_BASE_URL}/workspaces/${id}/avatar`, file, {
        withCredentials: true,
        headers: { 'Content-Type': file.type },
      }),
    );
  }

  async selectAfterRemoval() {
    this.active.set(null);
    this.remember(null);
    await this.refresh();
    await this.router.navigateByUrl('/workspaces');
  }

  clear() {
    this.items.set([]);
    this.active.set(null);
    this.ready.set(false);
  }

  environments() {
    return this.request<Environment[]>('GET', `/workspaces/${this.active()!.id}/environments`);
  }
}
