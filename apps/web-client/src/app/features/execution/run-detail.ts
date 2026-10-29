import { Component, DestroyRef, inject, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { WorkspaceService } from '../workspace/workspace.service';
import { ExecutionService } from './execution.service';
import { Run, RunEvent, RunResult, isActive } from './execution.models';
import { RunMedia } from './components/run-media';
import { RunStatusBadge } from './components/run-status';
import { ActivityTimeline } from './components/activity-timeline';

@Component({
  selector: 'app-run-detail',
  imports: [RouterLink, DatePipe, DecimalPipe, RunMedia, RunStatusBadge, ActivityTimeline],
  styleUrl: './execution.css',
  template: `
    @if (error()) {
      <p class="error" role="alert">{{ error() }} <button (click)="load()">Retry</button></p>
    }
    @if (run(); as current) {
      <div class="detail-heading">
        <div class="title">
          <h2>{{ liveView ? 'Session' : 'Run' }} #{{ current.id.slice(0, 8) }}</h2>
          <p>{{ current.title }}</p>
          <span class="muted"
            >{{ current.targetUrl }} · {{ current.createdAt | date: 'medium' }}</span
          >
        </div>
        <div>
          <app-run-status [status]="current.status" />
          @if (active(current)) {
            <button (click)="cancel()" [disabled]="cancelling() || current.cancelRequested">
              {{ current.cancelRequested ? 'Stopping…' : 'Stop run' }}
            </button>
          }
        </div>
      </div>
      @if (liveView && !active(current)) {
        <p class="muted">
          This session has ended.
          <a [routerLink]="['/runs', current.id]">View the completed run</a>
        </p>
      }
      <div class="run-metrics" aria-live="polite">
        <span
          >Failed tool calls: <strong>{{ metrics().failedToolCalls | number }}</strong></span
        >
        <span
          >Tokens used:
          <strong>{{
            metrics().tokens === null ? 'Unavailable' : (metrics().tokens | number)
          }}</strong
          >{{ metrics().partial ? ' (partial)' : '' }}</span
        >
        @if (metrics().tokens !== null) {
          <span class="muted"
            >Input: {{ metrics().input | number }} · Output: {{ metrics().output | number }}</span
          >
        }
      </div>
      <div class="detail-grid">
        <app-run-media [run]="current" />
        <section class="panel">
          <header class="activity-heading">
            <h3>Agent activity</h3>
            <span class="muted">{{
              active(current) ? (connected() ? 'Live' : 'Reconnecting…') : 'Saved activity'
            }}</span>
          </header>
          <div class="activity"><app-activity-timeline [events]="events()" /></div>
        </section>
      </div>
      @if (!liveView && !active(current)) {
        <section class="panel verdict">
          <h3>Verdict: {{ result()?.result?.verdict ?? 'Unavailable' }}</h3>
          <p>
            {{
              result()?.result?.summary ??
                current.error ??
                'No AI verdict was produced for this run.'
            }}
          </p>
        </section>
      }
    } @else if (!error()) {
      <p class="muted">Loading session…</p>
    }
  `,
})
export class RunDetail implements OnInit {
  private readonly workspaces = inject(WorkspaceService);
  private readonly api = inject(ExecutionService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  protected readonly liveView = this.route.snapshot.data['liveView'] === true;
  protected readonly run = signal<Run | null>(null);
  protected readonly result = signal<RunResult | null>(null);
  protected readonly events = signal<RunEvent[]>([]);
  protected readonly metrics = computed(() => {
    const events = this.events();
    const latest = [...events]
      .reverse()
      .find(
        (event) =>
          ['agent.metrics', 'agent.completed'].includes(event.type) && event.payload['tokenUsage'],
      )?.payload;
    const usage = latest?.['tokenUsage'] as
      | {
          totalTokens: number;
          inputTokens: number;
          outputTokens: number;
          reportedRequests: number;
          unreportedRequests: number;
        }
      | undefined;

    return {
      failedToolCalls: Number(
        latest?.['failedToolCalls'] ??
          events.filter((event) => event.type === 'agent.tool_failed').length,
      ),
      tokens: usage?.reportedRequests ? usage.totalTokens : null,
      input: usage?.inputTokens ?? 0,
      output: usage?.outputTokens ?? 0,
      partial: !!usage?.reportedRequests && usage.unreportedRequests > 0,
    };
  });
  protected readonly error = signal('');
  protected readonly connected = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly active = isActive;
  private stop?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private id = this.route.snapshot.paramMap.get('id')!;

  constructor() {
    this.destroy.onDestroy(() => {
      this.closed = true;
      this.stop?.();
      clearTimeout(this.timer);
    });
  }

  ngOnInit() {
    void this.load();
  }

  protected async load() {
    this.stop?.();
    clearTimeout(this.timer);
    this.error.set('');

    try {
      const run = await this.api.get(this.id);

      if (this.closed) return;

      if (run.workspaceId && run.workspaceId !== this.workspaces.active()?.id) {
        const workspace = this.workspaces.items().find((item) => item.id === run.workspaceId);

        if (workspace) {
          this.workspaces.activate(workspace.id);
        }
      }

      this.run.set(run);
      this.stop = this.api.watch(
        this.id,
        Number(this.events().at(-1)?.sequence ?? 0),
        (event) => {
          this.events.update((events) =>
            events.some((item) => item.id === event.id) ? events : [...events, event],
          );

          if (['run.completed', 'run.failed', 'run.cancelled'].includes(event.type))
            void this.refresh();
        },
        (connected) => this.connected.set(connected),
      );

      await this.refresh();
    } catch {
      this.error.set(
        'Could not load this run. It may be unavailable or belong to another account.',
      );
    }
  }

  private async refresh() {
    clearTimeout(this.timer);

    try {
      const run = await this.api.get(this.id);

      if (this.closed) return;

      this.run.set(run);

      if (!isActive(run)) this.result.set(await this.api.result(this.id));
    } catch {
      if (!this.closed) this.error.set('Could not refresh the run.');
    } finally {
      if (!this.closed && this.run() && isActive(this.run()!))
        this.timer = setTimeout(() => {
          void this.refresh();
        }, 2500);
    }
  }

  protected async cancel() {
    this.cancelling.set(true);

    try {
      await this.api.cancel(this.id);
      await this.refresh();
    } catch {
      this.error.set('Could not stop this run. Please try again.');
    } finally {
      this.cancelling.set(false);
    }
  }
}
