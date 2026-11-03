import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { LucideDynamicIcon, LucideChevronRight, LucideExternalLink } from '@lucide/angular';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MarkdownContent } from '../../shared/markdown-content';
import { WorkspaceService } from '../workspace/workspace.service';
import { RunStatusBadge } from '../execution/components/run-status';
import { IssueStatus, issueOutcomeLabel } from './components/issue-status';
import { IssueDetail } from './issue.models';
import { IssueService } from './issue.service';

@Component({
  selector: 'app-issue-detail',
  imports: [RouterLink, DatePipe, IssueStatus, RunStatusBadge, LucideDynamicIcon, MarkdownContent],
  styleUrl: './issues.css',
  template: `
    @if (error()) {
      <p class="error" role="alert">{{ error() }} <button (click)="load()">Retry</button></p>
    }
    @if (issue(); as item) {
      <header class="detail-heading">
        <div>
          <h2>Issue #{{ item.number }}</h2>
          <p class="muted">{{ item.repository }}</p>
        </div>
        <div class="heading-actions">
          <app-issue-status [status]="item.task.status" [outcome]="item.task.outcome" />
          <button class="primary-button" (click)="openGithub()">
            <svg [lucideIcon]="externalLink" [size]="16" aria-hidden="true"></svg>View on GitHub
          </button>
          @if (!item.task.endedAt) {
            <button [disabled]="stopping()" (click)="cancel()">
              {{ stopping() ? 'Stopping…' : 'Stop investigation' }}
            </button>
          }
        </div>
      </header>
      <div class="tabs" role="tablist" aria-label="Issue details">
        <button
          role="tab"
          [attr.aria-selected]="tab() === 'overview'"
          [class.selected]="tab() === 'overview'"
          (click)="tab.set('overview')"
        >
          Overview
        </button>
        <button
          role="tab"
          [attr.aria-selected]="tab() === 'runs'"
          [class.selected]="tab() === 'runs'"
          (click)="tab.set('runs')"
        >
          Runs
        </button>
      </div>
      <section class="panel tab-panel" role="tabpanel">
        @if (tab() === 'overview') {
          <section class="issue-summary">
            <h3 class="issue-title">{{ item.title }}</h3>
            <div class="description">
              <app-markdown-content
                [content]="item.description || 'No description provided.'"
                [baseUrl]="item.url"
              />
            </div>
          </section>
          <div class="result-block">
            <h3>Verdict</h3>
            <p>
              {{
                item.task.outcome ? outcomeLabel(item.task.outcome) : 'Investigation in progress'
              }}
            </p>
            <p>{{ item.task.result?.summary || 'Waiting for the next stage.' }}</p>
          </div>
          @if (item.task.result?.preconditions?.length) {
            <div class="result-block">
              <h3>Preconditions</h3>
              <ul>
                @for (condition of item.task.result!.preconditions; track $index) {
                  <li>{{ condition }}</li>
                }
              </ul>
            </div>
          }
          @if (item.task.result?.steps?.length) {
            <div class="result-block">
              <h3>Checked steps</h3>
              <ol>
                @for (step of item.task.result!.steps; track $index) {
                  <li>{{ step.action }}</li>
                }
              </ol>
            </div>
          }
          @if (item.task.result?.expectedBehavior) {
            <div class="behavior-grid">
              <div>
                <h3>Expected behavior</h3>
                <p>{{ item.task.result?.expectedBehavior }}</p>
              </div>
              <div>
                <h3>Actual behavior</h3>
                <p>{{ item.task.result?.actualBehavior }}</p>
              </div>
            </div>
          }
        } @else {
          @for (group of item.runGroups; track group.investigation.id) {
            <section class="run-group">
              <header class="run-group-heading">
                <time [attr.datetime]="group.investigation.createdAt">{{
                  group.investigation.createdAt | date: 'medium'
                }}</time>
                <button (click)="showOverview(group.investigation.id)">View result</button>
              </header>
              <div class="stage-list">
                @for (run of group.runs; track run.id) {
                  <a class="issue-row stage-row" [routerLink]="['/runs', run.id]">
                    <div class="row-info">
                      <strong>{{ run.title }}</strong
                      ><span class="muted"
                        >{{ run.createdAt | date: 'shortTime' }} ·
                        {{ outcomeLabel(run.result?.verdict) }}</span
                      >
                    </div>
                    <app-run-status [status]="run.status" /><svg
                      [lucideIcon]="chevron"
                      [size]="16"
                      aria-hidden="true"
                    ></svg>
                  </a>
                } @empty {
                  <p class="empty">No stage runs yet.</p>
                }
              </div>
            </section>
          } @empty {
            <p class="empty">No runs yet.</p>
          }
        }
      </section>
    } @else if (!error()) {
      <p class="muted">Loading issue…</p>
    }
  `,
})
export class IssueDetailPage implements OnInit {
  protected readonly chevron = LucideChevronRight;
  protected readonly externalLink = LucideExternalLink;
  protected readonly outcomeLabel = issueOutcomeLabel;
  private readonly api = inject(IssueService);
  private readonly route = inject(ActivatedRoute);
  private readonly workspaces = inject(WorkspaceService);
  private readonly destroy = inject(DestroyRef);
  protected readonly issue = signal<IssueDetail | null>(null);
  protected readonly tab = signal('overview');
  protected readonly error = signal('');
  protected readonly stopping = signal(false);
  private readonly id = this.route.snapshot.paramMap.get('id')!;
  private taskId = this.route.snapshot.queryParamMap.get('taskId') ?? undefined;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private revision = 0;

  constructor() {
    this.destroy.onDestroy(() => {
      this.closed = true;
      clearTimeout(this.timer);
    });
  }
  ngOnInit() {
    void this.load();
  }

  protected async load() {
    const revision = ++this.revision;
    clearTimeout(this.timer);
    this.error.set('');
    try {
      const issue = await this.api.get(this.id, this.taskId);
      if (this.closed || revision !== this.revision) return;
      if (issue.workspaceId !== this.workspaces.active()?.id)
        this.workspaces.activate(issue.workspaceId);
      this.issue.set(issue);
    } catch {
      if (!this.closed && revision === this.revision)
        this.error.set('Could not load this issue or you no longer have access.');
    } finally {
      if (!this.closed && revision === this.revision)
        this.timer = setTimeout(() => {
          void this.load();
        }, 3000);
    }
  }

  protected showOverview(taskId: string) {
    this.taskId = taskId;
    this.tab.set('overview');
    void this.load();
  }

  protected openGithub() {
    const url = this.issue()?.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  protected async cancel() {
    const task = this.issue()?.task;
    if (!task) return;
    this.stopping.set(true);
    try {
      await this.api.cancel(task.id);
      await this.load();
    } catch {
      this.error.set('Could not stop the investigation.');
    } finally {
      this.stopping.set(false);
    }
  }
}
