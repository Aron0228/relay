import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';

declare const API_BASE_URL: string;

@Component({
  selector: 'app-start-run',
  imports: [FormsModule],
  template: `
    <details>
      <summary>New run</summary>
      <form (ngSubmit)="start()">
        <label
          >Test goal<textarea
            name="prompt"
            [(ngModel)]="prompt"
            required
            maxlength="4000"
            rows="3"
            placeholder="Issue description"
          ></textarea>
        </label>
        <label>Target URL<input name="url" [(ngModel)]="url" type="url" required /></label>
        @if (error()) {
          <p role="alert">{{ error() }}</p>
        }
        <button type="submit" [disabled]="busy() || !prompt.trim()">
          {{ busy() ? 'Queuing…' : 'Start test' }}
        </button>
      </form>
    </details>
  `,
  styles: `
    :host {
      display: block;
    }
    summary {
      cursor: pointer;
      padding: 10px 14px;
      background: var(--color-selected);
      border-radius: 8px;
      font-size: 13px;
      white-space: nowrap;
    }
    form {
      display: grid;
      gap: 14px;
      padding: 20px;
      border: 1px solid var(--color-border);
      border-radius: 10px;
      background: var(--color-surface);
      margin-top: 10px;
      min-width: min(360px, 100%);
    }
    label {
      display: grid;
      gap: 8px;
      font-size: 12px;
    }
    input,
    textarea {
      font: inherit;
      color: var(--color-text);
      background: var(--color-content);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: 10px;
    }
    button {
      cursor: pointer;
      border: 0;
      border-radius: 6px;
      padding: 10px;
      background: var(--color-primary);
      color: var(--color-on-primary);
    }
    p {
      color: var(--color-error);
      font-size: 12px;
    }
  `,
})
export class StartRun {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly created = output<void>();
  protected prompt = '';
  protected url = 'https://academybugs.com/';
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async start() {
    this.busy.set(true);
    this.error.set('');

    try {
      const run = await firstValueFrom(
        this.http.post<{ id: string }>(
          `${API_BASE_URL}/runs/agent`,
          { prompt: this.prompt, targetUrl: this.url },
          { withCredentials: true },
        ),
      );
      this.created.emit();

      await this.router.navigate(['/workers', run.id]);
    } catch {
      this.error.set(
        'Could not start the test. Check the URL is approved and the worker is available.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
