import { Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SelectField } from '../../../shared/select-field';
import { WorkspaceService, Environment } from '../workspace.service';

interface KnowledgeRecord {
  id: string;
  title: string;
  content: string;
  type: string;
  scopeOrigin: string;
  confidence: number;
  verificationStatus: string;
  lastVerifiedAt?: string;
  updatedAt: string;
  version: number;
  sourceRunId: string;
  sourceEventIds: string[];
}
interface KnowledgePatch {
  id: string;
  knowledgeId: string;
  operation: string;
  status: string;
  reason: string;
  sourceRunId: string;
  sourceEventIds: string[];
  createdAt: string;
  proposal: { title: string; content: string };
  previous?: { content: string };
}

@Component({
  selector: 'app-environment-knowledge',
  imports: [FormsModule, DatePipe, PercentPipe, RouterLink, SelectField],
  template: `
    <header>
      <h2>Environment knowledge</h2>
      <p>Observations saved by previous runs. They may need checking as the site changes.</p>
    </header>
    <div class="filters">
      <label
        >Environment<app-select-field
          ><select [ngModel]="environmentId()" (ngModelChange)="selectEnvironment($event)">
            <option value="">Choose an environment</option>
            @for (environment of environments(); track environment.id) {
              <option [value]="environment.id">{{ environment.name }}</option>
            }
          </select></app-select-field
        ></label
      >
      <label
        >Search<input
          [(ngModel)]="search"
          (keyup.enter)="load()"
          placeholder="Search knowledge"
          maxlength="500"
      /></label>
      <label
        >Type<app-select-field
          ><select [(ngModel)]="type" (ngModelChange)="load()">
            <option value="">All types</option>
            <option value="navigation">Navigation</option>
            <option value="workflow">Workflow</option>
            <option value="precondition">Precondition</option>
            <option value="behavior">Behavior</option>
          </select></app-select-field
        ></label
      >
      <label
        >Status<app-select-field
          ><select [(ngModel)]="status" (ngModelChange)="load()">
            <option value="">All statuses</option>
            <option value="unverified">Unverified</option>
            <option value="verified">Verified</option>
            <option value="retired">Retired</option>
            <option value="stale">Needs rechecking</option>
          </select></app-select-field
        ></label
      >
      <button (click)="load()" [disabled]="busy() || !environmentId()">Refresh</button>
    </div>
    @if (error()) {
      <p role="alert">{{ error() }}</p>
    }
    @if (busy()) {
      <p>Loading knowledge…</p>
    }
    @for (record of records(); track record.id) {
      <details>
        <summary>
          <strong>{{ record.title }}</strong
          ><span
            >{{ record.type }} · {{ record.verificationStatus }} · Confidence
            {{ record.confidence | percent }}</span
          >
        </summary>
        <p class="content">{{ record.content }}</p>
        <p class="muted">
          {{ record.scopeOrigin }} · Version {{ record.version }} · Updated
          {{ record.updatedAt | date: 'medium' }}
        </p>
        <p>
          Last independently checked:
          {{ (record.lastVerifiedAt | date: 'medium') || 'Not yet checked' }}
        </p>
        <a [routerLink]="['/runs', record.sourceRunId]">View source run and observations</a>
        <details>
          <summary>Source observation IDs</summary>
          @for (id of record.sourceEventIds; track id) {
            <code>{{ id }}</code>
          }
        </details>
        <button (click)="showSources(record.id)">Show source observations</button>
        @for (source of sources()[record.id] || []; track source.id) {
          <details>
            <summary>{{ source.id }}</summary>
            <pre>{{ source.payload.observation }}</pre>
          </details>
        }
        <h3>Changes and proposals</h3>
        @for (patch of patchesFor(record.id); track patch.id) {
          <article>
            <strong>{{ patch.operation }} · {{ patch.status }}</strong
            ><span class="muted">{{ patch.createdAt | date: 'medium' }}</span>
            <p>{{ patch.reason }}</p>
            @if (patch.previous?.content && patch.operation === 'update') {
              <p class="content">Previous: {{ patch.previous!.content }}</p>
            }
            <p class="content">{{ patch.proposal.content }}</p>
            <a [routerLink]="['/runs', patch.sourceRunId]">View evidence run</a>
            @if (patch.status === 'pending' && workspaces.admin()) {
              <div class="actions">
                <button (click)="decide(patch.id, true)" [disabled]="busy()">Accept change</button
                ><button (click)="decide(patch.id, false)" [disabled]="busy()">Reject</button>
              </div>
            }
          </article>
        } @empty {
          <p>No recorded changes.</p>
        }
      </details>
    } @empty {
      @if (environmentId() && !busy()) {
        <p>No knowledge matches these filters.</p>
      }
    }
    @if (records().length || offset > 0) {
      <div class="actions">
        <button [disabled]="offset === 0 || busy()" (click)="page(-1)">Previous</button
        ><button [disabled]="records().length < 50 || busy()" (click)="page(1)">Next</button>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    header {
      margin-bottom: 28px;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 20px;
    }
    header p,
    .muted,
    summary span {
      color: var(--color-muted);
    }
    .filters {
      display: flex;
      gap: 16px;
      align-items: end;
      flex-wrap: wrap;
      margin-bottom: 24px;
    }
    label {
      display: grid;
      gap: 8px;
      flex: 1;
      min-width: 150px;
    }
    input,
    select,
    button {
      color: var(--color-text);
      background: var(--color-background);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 11px 14px;
      font: inherit;
    }
    select {
      width: 100%;
    }
    button {
      cursor: pointer;
    }
    button:hover {
      background: var(--color-selected);
    }
    button:disabled {
      opacity: 0.5;
      cursor: default;
    }
    details {
      border: 1px solid var(--color-border);
      border-radius: 10px;
      padding: 18px;
      margin-bottom: 12px;
    }
    summary {
      cursor: pointer;
    }
    summary span,
    article > span {
      display: block;
      margin-top: 8px;
      font-size: 13px;
    }
    pre,
    .content {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.6;
    }
    a {
      color: var(--color-primary);
    }
    article {
      border-top: 1px solid var(--color-border);
      padding: 18px 0;
    }
    code {
      display: block;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    h3 {
      font-size: 16px;
    }
  `,
})
export class EnvironmentKnowledge {
  protected readonly workspaces = inject(WorkspaceService);
  readonly environments = input.required<Environment[]>();
  readonly workspaceId = input.required<string>();
  protected readonly environmentId = signal('');
  protected readonly records = signal<KnowledgeRecord[]>([]);
  protected readonly patches = signal<KnowledgePatch[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected search = '';
  protected type = '';
  protected status = '';
  protected offset = 0;
  protected readonly sources = signal<
    Record<string, { id: string; payload: { observation: string } }[]>
  >({});
  private generation = 0;

  protected async showSources(id: string) {
    try {
      const detail = await this.workspaces.request<{
        sources: { id: string; payload: { observation: string } }[];
      }>(
        'GET',
        `/workspaces/${this.workspaceId()}/environments/${this.environmentId()}/knowledge/${id}`,
      );
      this.sources.update((sources) => ({ ...sources, [id]: detail.sources }));
    } catch {
      this.error.set('Could not load source observations.');
    }
  }

  constructor() {
    effect(() => {
      this.workspaceId();
      const environments = this.environments();
      const current = this.environmentId();

      if (!environments.some((environment) => environment.id === current))
        this.selectEnvironment(environments[0]?.id ?? '');
    });
  }

  protected selectEnvironment(id: string) {
    this.environmentId.set(id);
    this.offset = 0;
    void this.load();
  }

  protected patchesFor(id: string) {
    return this.patches().filter((patch) => patch.knowledgeId === id);
  }

  protected page(direction: number) {
    this.offset += direction * 50;
    void this.load(false);
  }

  protected async load(reset = true) {
    const generation = ++this.generation;
    const environment = this.environmentId();
    this.error.set('');
    this.records.set([]);
    this.patches.set([]);
    this.sources.set({});

    if (!environment) {
      this.busy.set(false);
      return;
    }
    if (reset) this.offset = 0;

    this.busy.set(true);
    const path = `/workspaces/${this.workspaceId()}/environments/${environment}`;
    const params = new URLSearchParams({ offset: String(this.offset) });
    if (this.search.trim()) params.set('search', this.search.trim());
    if (this.type) params.set('type', this.type);
    if (this.status) params.set('status', this.status);

    try {
      const [records, patches] = await Promise.all([
        this.workspaces.request<KnowledgeRecord[]>('GET', `${path}/knowledge?${params}`),
        this.workspaces.request<KnowledgePatch[]>('GET', `${path}/knowledge-patches`),
      ]);
      if (generation !== this.generation) return;

      this.records.set(records);
      this.patches.set(patches);
    } catch {
      if (generation === this.generation)
        this.error.set('Could not load environment knowledge. Try again.');
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }

  protected async decide(id: string, accept: boolean) {
    this.busy.set(true);
    try {
      await this.workspaces.request(
        'PATCH',
        `/workspaces/${this.workspaceId()}/environments/${this.environmentId()}/knowledge-patches/${id}`,
        { accept },
      );
      await this.load(false);
    } catch {
      this.error.set('Could not apply this change. Refresh to check its current version.');
    } finally {
      this.busy.set(false);
    }
  }
}
