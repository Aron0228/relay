import { Component, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { WorkspaceService } from '../../workspace/workspace.service';

interface KnowledgeUsage {
  id: string;
  version: number;
  createdAt: string;
  snapshot: { title: string; content: string; verificationStatus: string; stale: boolean };
}

@Component({
  selector: 'app-run-knowledge',
  imports: [DatePipe],
  template: `
    <section>
      <button (click)="load()" [disabled]="busy()">
        {{ busy() ? 'Loading…' : 'Show knowledge supplied to this run' }}
      </button>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      @if (loaded()) {
        @for (item of items(); track item.id) {
          <details>
            <summary>{{ item.snapshot.title }} · Version {{ item.version }}</summary>
            <p>{{ item.snapshot.content }}</p>
            <small
              >{{ item.snapshot.verificationStatus
              }}{{ item.snapshot.stale ? ' · May be outdated' : '' }} · Retrieved
              {{ item.createdAt | date: 'medium' }}</small
            >
          </details>
        } @empty {
          <p>No stored knowledge was supplied to this run.</p>
        }
      }
    </section>
  `,
  styles: `
    section {
      margin-top: 24px;
    }
    button {
      cursor: pointer;
      color: var(--color-text);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 12px 16px;
      font: inherit;
    }
    button:hover {
      background: var(--color-selected);
    }
    details {
      padding: 16px;
      margin-top: 12px;
      border: 1px solid var(--color-border);
      border-radius: 8px;
    }
    summary {
      cursor: pointer;
    }
    p {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    small {
      color: var(--color-muted);
    }
  `,
})
export class RunKnowledge {
  readonly workspaceId = input.required<string>();
  readonly runId = input.required<string>();
  private readonly workspaces = inject(WorkspaceService);
  protected readonly items = signal<KnowledgeUsage[]>([]);
  protected readonly busy = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');

  protected async load() {
    this.busy.set(true);
    this.error.set('');
    try {
      this.items.set(
        await this.workspaces.request<KnowledgeUsage[]>(
          'GET',
          `/workspaces/${this.workspaceId()}/runs/${this.runId()}/knowledge`,
        ),
      );
      this.loaded.set(true);
    } catch {
      this.error.set('Could not load the knowledge supplied to this run.');
    } finally {
      this.busy.set(false);
    }
  }
}
