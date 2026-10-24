import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExecutionService } from '../execution/execution.service';
import { Run } from '../execution/execution.models';
import { RunStatusBadge } from '../execution/components/run-status';
import { RunMedia } from '../execution/components/run-media';
import { StartRun } from '../execution/components/start-run';

@Component({
  selector: 'app-workers',
  imports: [RouterLink, DatePipe, RunStatusBadge, RunMedia, StartRun],
  styleUrl: '../execution/execution.css',
  template: `
    <div class="toolbar">
      <span class="muted">{{ active().length }} active sessions</span><app-start-run />
    </div>
    @if (error()) {
      <p class="error" role="alert">{{ error() }} <button (click)="refresh()">Retry</button></p>
    }
    <div class="grid">
      @for (run of active(); track run.id) {
        <article class="panel worker-card">
          <div class="section-heading">
            <a [routerLink]="['/workers', run.id]"
              ><h3>Worker {{ run.workerPid ?? run.id.slice(0, 8) }}</h3></a
            ><app-run-status [status]="run.status" />
          </div>
          <p>{{ run.title }}</p>
          <app-run-media [run]="run" /><a
            class="button"
            [routerLink]="['/workers', run.id]"
            style="margin-top:12px"
            >Observe session</a
          >
        </article>
      } @empty {
        <div class="panel empty">
          {{
            loading()
              ? 'Loading workers…'
              : 'No active sessions. Workers start when a test is queued.'
          }}
        </div>
      }
    </div>
    <div class="section-heading">
      <h2>Queue</h2>
      <span class="muted">Waiting for a worker</span>
    </div>
    <div class="panel">
      @for (run of queued(); track run.id) {
        <a class="run-row" [routerLink]="['/workers', run.id]"
          ><span class="identifier">#{{ run.id.slice(0, 8) }}</span
          ><span class="info"
            ><strong>{{ run.title }}</strong
            ><time>{{ run.createdAt | date: 'medium' }}</time></span
          ><app-run-status [status]="run.status"
        /></a>
      } @empty {
        <div class="empty">The queue is empty.</div>
      }
    </div>
    @if (queueCursor()) {
      <button class="load-more" (click)="moreQueue()">Load more queued tests</button>
    }
  `,
})
export class WorkersPage implements OnInit {
  private readonly api = inject(ExecutionService);
  private readonly destroy = inject(DestroyRef);
  protected readonly active = signal<Run[]>([]);
  protected readonly queued = signal<Run[]>([]);
  protected readonly queueCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private queuePages = 1;

  constructor() {
    this.destroy.onDestroy(() => {
      this.closed = true;
      clearTimeout(this.timer);
    });
  }

  ngOnInit() {
    void this.refresh();
  }

  protected async refresh() {
    clearTimeout(this.timer);

    try {
      const [active, queued] = await Promise.all([
        this.api.list('active'),
        this.api.list('queued'),
      ]);

      for (let page = 1; page < this.queuePages && queued.nextCursor; page++) {
        const next = await this.api.list('queued', '', queued.nextCursor);
        queued.items.push(...next.items);
        queued.nextCursor = next.nextCursor;
      }

      if (this.closed) return;

      this.active.set(active.items);
      this.queued.set(queued.items);
      this.queueCursor.set(queued.nextCursor);
      this.error.set('');
    } catch {
      if (!this.closed) this.error.set('Could not refresh worker sessions.');
    } finally {
      this.loading.set(false);
      if (!this.closed)
        this.timer = setTimeout(() => {
          void this.refresh();
        }, 4000);
    }
  }

  protected async moreQueue() {
    this.queuePages++;
    await this.refresh();
  }
}
