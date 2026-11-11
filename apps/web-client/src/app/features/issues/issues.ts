import { Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { LucideDynamicIcon, LucideChevronRight } from '@lucide/angular';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { WorkspaceService } from '../workspace/workspace.service';
import { IssueService } from './issue.service';
import { IssueItem } from './issue.models';
import { IssueStatus } from './components/issue-status';

@Component({
  selector: 'app-issues',
  imports: [RouterLink, IssueStatus, LucideDynamicIcon],
  styleUrl: './issues.css',
  template: `
    <div class="toolbar">
      <input
        [attr.aria-label]="resource === 'issues' ? 'Search issues' : 'Search pull requests'"
        [placeholder]="resource === 'issues' ? 'Search issues…' : 'Search pull requests…'"
        [value]="search()"
        (input)="searchChanged($event)"
      />
      <button (click)="load()" [disabled]="busy()">Refresh</button>
    </div>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    <section class="panel">
      @for (issue of items(); track issue.id) {
        <a class="issue-row" [routerLink]="['/' + resource, issue.id]">
          <span class="muted">#{{ issue.number }}</span>
          <div class="row-info">
            <strong>{{ issue.title }}</strong
            ><span class="muted">{{ issue.repository }}</span>
          </div>
          <app-issue-status [status]="issue.status" [outcome]="issue.outcome" />
          <svg [lucideIcon]="chevron" [size]="16" aria-hidden="true"></svg>
        </a>
      } @empty {
        <p class="empty">{{ busy() ? 'Loading issues…' : 'No investigations found.' }}</p>
      }
    </section>
    @if (cursor()) {
      <button class="load-more" [disabled]="busy()" (click)="load(true)">Load more</button>
    }
  `,
})
export class IssuesPage {
  protected readonly chevron = LucideChevronRight;
  private readonly api = inject(IssueService);
  protected readonly resource = inject(ActivatedRoute).snapshot.data['resource'] ?? 'issues';
  private readonly workspaces = inject(WorkspaceService);
  private readonly destroy = inject(DestroyRef);
  protected readonly items = signal<IssueItem[]>([]);
  protected readonly search = signal('');
  protected readonly cursor = signal<string | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  private debounce?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private closed = false;

  constructor() {
    effect(() => {
      const workspaceId = this.workspaces.active()?.id;
      this.revision++;
      clearTimeout(this.timer);
      untracked(() => {
        this.items.set([]);
        this.cursor.set(null);
        if (workspaceId) void this.load();
      });
    });
    this.destroy.onDestroy(() => {
      this.closed = true;
      clearTimeout(this.timer);
      clearTimeout(this.debounce);
    });
  }

  protected searchChanged(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      void this.load();
    }, 250);
  }

  protected async load(more = false) {
    const revision = ++this.revision;
    clearTimeout(this.timer);
    this.busy.set(true);
    this.error.set('');

    try {
      const page = await this.api.list(
        this.search(),
        more ? (this.cursor() ?? undefined) : undefined,
        this.resource,
      );
      if (this.closed || revision !== this.revision) return;

      this.items.set(
        more
          ? [
              ...this.items(),
              ...page.items.filter(
                (item) => !this.items().some((existing) => existing.id === item.id),
              ),
            ]
          : page.items,
      );
      this.cursor.set(page.nextCursor);
    } catch {
      if (!this.closed && revision === this.revision)
        this.error.set('Could not load issues. Please try again.');
    } finally {
      if (!this.closed && revision === this.revision) {
        this.busy.set(false);
        if (!more)
          this.timer = setTimeout(() => {
            void this.load();
          }, 5000);
      }
    }
  }
}
