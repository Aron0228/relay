import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExecutionService } from '../execution/execution.service';
import { Run } from '../execution/execution.models';
import { RunStatusBadge } from '../execution/components/run-status';
import { StartRun } from '../execution/components/start-run';

@Component({
  selector: 'app-runs',
  imports: [RouterLink, DatePipe, RunStatusBadge, StartRun],
  styleUrl: '../execution/execution.css',
  template: `
    <div class="toolbar">
      <input
        type="search"
        aria-label="Search runs"
        placeholder="Search by test goal or run ID…"
        (input)="search($event)"
      /><app-start-run />
    </div>
    @if (error()) {
      <p class="error" role="alert">{{ error() }} <button (click)="load()">Retry</button></p>
    }
    <div class="panel">
      @for (run of runs(); track run.id) {
        <a class="run-row" [routerLink]="['/runs', run.id]">
          <span class="identifier">#{{ run.id.slice(0, 8) }}</span
          ><span class="info"
            ><strong>{{ run.title }}</strong
            ><time>{{ run.createdAt | date: 'medium' }}</time></span
          ><app-run-status [status]="run.status" />
        </a>
      } @empty {
        <div class="empty">{{ loading() ? 'Loading runs…' : 'No runs found.' }}</div>
      }
    </div>
    @if (cursor()) {
      <button class="load-more" [disabled]="loading()" (click)="load(true)">Load more</button>
    }
  `,
})
export class RunsPage implements OnInit {
  private readonly api = inject(ExecutionService);
  private readonly destroy = inject(DestroyRef);
  protected readonly runs = signal<Run[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  private query = '';
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;

  constructor() {
    this.destroy.onDestroy(() => {
      clearTimeout(this.timer);
      this.revision++;
    });
  }

  ngOnInit() {
    void this.load();
  }

  protected search(event: Event) {
    this.query = (event.target as HTMLInputElement).value;
    this.revision++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.load();
    }, 250);
  }

  protected async load(more = false) {
    const revision = ++this.revision;
    this.loading.set(true);
    this.error.set('');

    try {
      const page = await this.api.list(
        'all',
        this.query,
        more ? (this.cursor() ?? undefined) : undefined,
      );

      if (revision !== this.revision) return;

      this.runs.update((runs) => (more ? [...runs, ...page.items] : page.items));
      this.cursor.set(page.nextCursor);
    } catch {
      if (revision === this.revision) this.error.set('Could not load runs.');
    } finally {
      if (revision === this.revision) this.loading.set(false);
    }
  }
}
