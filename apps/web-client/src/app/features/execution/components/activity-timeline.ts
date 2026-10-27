import { Component, computed, effect, ElementRef, input, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { LucideDynamicIcon, LucideWrench, LucideSparkles } from '@lucide/angular';
import { RunEvent } from '../execution.models';

@Component({
  selector: 'app-activity-timeline',
  imports: [DatePipe, LucideDynamicIcon],
  template: `
    <div
      #viewport
      class="timeline"
      (scroll)="scroll($event)"
      role="log"
      aria-label="Agent activity"
    >
      @for (item of items(); track item.id) {
        <article
          [class.message]="item.kind === 'message'"
          [class.observation]="item.kind === 'observation'"
          [class.tool]="item.kind === 'tool'"
        >
          <div class="entry-header">
            <svg
              [lucideIcon]="item.kind === 'tool' ? wrench : sparkle"
              [size]="14"
              aria-hidden="true"
            ></svg
            ><span>{{ item.title }}</span
            ><time>{{ item.date | date: 'HH:mm:ss' }}</time>
          </div>
          @if (item.text) {
            <p>{{ item.text }}</p>
          }
          @if (item.details) {
            <details>
              <summary>Details</summary>
              <pre>{{ item.details }}</pre>
            </details>
          }
        </article>
      } @empty {
        <p class="empty">Activity will appear when the agent starts.</p>
      }
    </div>
  `,
  styles: `
    .timeline {
      max-height: 610px;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 20px;
    }
    article {
      min-width: 0;
    }
    .entry-header {
      display: flex;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      color: var(--color-muted);
    }
    time {
      margin-left: auto;
      font-variant-numeric: tabular-nums;
      font-size: 10px;
    }
    p {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 13px;
      line-height: 1.65;
      margin: 9px 0 0;
    }
    .message {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 10px;
      padding: 14px;
    }
    .message .entry-header {
      color: var(--color-text);
    }
    .observation p {
      color: var(--color-muted);
    }
    .tool {
      border-left: 2px solid var(--color-border);
      padding-left: 12px;
    }
    details {
      font-size: 11px;
      margin-top: 8px;
      color: var(--color-muted);
    }
    summary {
      cursor: pointer;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 240px;
      overflow: auto;
      line-height: 1.6;
    }
    .empty {
      color: var(--color-muted);
    }
  `,
})
export class ActivityTimeline {
  readonly events = input.required<RunEvent[]>();
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private follow = true;

  constructor() {
    effect(() => {
      this.events();

      queueMicrotask(() => {
        const element = this.viewport()?.nativeElement;

        if (this.follow && element) element.scrollTop = element.scrollHeight;
      });
    });
  }

  protected scroll(event: Event) {
    const element = event.target as HTMLElement;
    this.follow = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }

  protected readonly wrench = LucideWrench;
  protected readonly sparkle = LucideSparkles;
  protected readonly items = computed(() =>
    this.events().flatMap((event) => {
      const p = event.payload;
      const base = { id: event.id, date: event.createdAt, details: '' };

      if (event.type === 'agent.activity')
        return [
          {
            ...base,
            kind: String(p['kind']),
            title: p['kind'] === 'message' ? 'Relay' : 'Observation',
            text: String(p['text'] ?? ''),
          },
        ];
      if (event.type === 'agent.summary')
        return [{ ...base, kind: 'message', title: 'Relay', text: String(p['text'] ?? '') }];
      if (
        event.type.startsWith('agent.tool_') &&
        p['name'] !== 'reportProgress' &&
        p['name'] !== 'finish'
      ) {
        const state =
          event.type === 'agent.tool_called'
            ? 'Started'
            : event.type === 'agent.tool_failed'
              ? 'Failed'
              : 'Completed';

        return [
          {
            ...base,
            kind: 'tool',
            title: `${state} · ${String(p['name'])}`,
            text: '',
            details: String(p['arguments'] ?? p['output'] ?? ''),
          },
        ];
      }

      return [];
    }),
  );
}
