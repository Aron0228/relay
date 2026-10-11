import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';

import { firstValueFrom } from 'rxjs';

declare const API_BASE_URL: string;

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private restoring?: Promise<Record<string, unknown> | null>;
  readonly profile = signal<Record<string, unknown> | null>(null);
  readonly error = signal('');

  restore(): Promise<Record<string, unknown> | null> {
    this.restoring ??= this.loadProfile();

    return this.restoring;
  }

  async refresh(): Promise<Record<string, unknown> | null> {
    this.restoring = this.loadProfile();

    return this.restoring;
  }

  clear(): void {
    this.profile.set(null);
    this.restoring = Promise.resolve(null);
  }

  private async loadProfile(): Promise<Record<string, unknown> | null> {
    try {
      const profile = await firstValueFrom(this.me());

      this.profile.set(profile);
      this.error.set('');

      return profile;
    } catch (error) {
      this.profile.set(null);

      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        this.error.set('Could not load your session. Please try signing in again.');
      }

      return null;
    }
  }

  login(): void {
    window.location.assign(`${API_BASE_URL}/sessions/login?client=web`);
  }

  exchange(exchangeCode: string) {
    return this.http.post(
      `${API_BASE_URL}/sessions/exchange`,
      { exchangeCode },
      { withCredentials: true },
    );
  }

  me() {
    return this.http.get<Record<string, unknown>>(`${API_BASE_URL}/sessions/me`, {
      withCredentials: true,
    });
  }

  logout() {
    return this.http.post(`${API_BASE_URL}/sessions/logout`, {}, { withCredentials: true });
  }
}
