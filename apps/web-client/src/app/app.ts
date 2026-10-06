import { JsonPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SessionService } from './session.service';

@Component({
  imports: [JsonPipe],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly sessions = inject(SessionService);
  protected readonly profile = signal<Record<string, unknown> | null>(null);
  protected readonly busy = signal(true);
  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    const url = new URL(window.location.href);

    const code = url.searchParams.get('exchange_code');

    if (code) {
      url.searchParams.delete('exchange_code');

      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }

    try {
      if (code) await firstValueFrom(this.sessions.exchange(code));

      this.profile.set(await firstValueFrom(this.sessions.me()));
    } catch (error) {
      if (code || !(error instanceof HttpErrorResponse) || error.status !== 401) {
        this.error.set('Could not sign in. Please try again.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async logout(): Promise<void> {
    this.busy.set(true);
    this.error.set('');

    try {
      await firstValueFrom(this.sessions.logout());

      this.profile.set(null);
    } catch {
      this.error.set('Could not sign out. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
