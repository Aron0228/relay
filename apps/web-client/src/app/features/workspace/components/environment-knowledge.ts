import { AppButton } from '../../../shared/app-button';
import { ActionRow, ContentStack, Field, FilterBar, SectionHeading } from '../../../shared/layout';
import { Disclosure } from '../../../shared/disclosure';
import { Pagination } from '../../../shared/pagination';
import { KnowledgeEvidenceList } from './knowledge-evidence';
import { KnowledgeChangeCard } from './knowledge-change';
import { SegmentedControl } from '../../../shared/segmented-control';
import { KnowledgePatches } from './knowledge-patches';
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
  scopePath: string;
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
  knowledgeId?: string;
  operation: string;
  status: string;
  reason: string;
  sourceRunId: string;
  sourceEventIds: string[];
  createdAt: string;
  proposal: { title: string; content: string };
  previous?: { content: string };
  latestVerification?: { result: string };
}

@Component({
  selector: 'app-environment-knowledge',
  imports: [
    AppButton,
    ActionRow,
    ContentStack,
    Field,
    FilterBar,
    SectionHeading,
    Disclosure,
    Pagination,
    KnowledgeEvidenceList,
    KnowledgeChangeCard,
    SegmentedControl,
    KnowledgePatches,
    FormsModule,
    DatePipe,
    PercentPipe,
    RouterLink,
    SelectField,
  ],
  template: `
    <app-content-stack>
      <app-section-heading
        title="Environment knowledge"
        description="Observations saved by previous runs. They may need checking as the site changes."
      />
      <app-filter-bar>
        <app-field controlId="knowledge-environment" label="Environment"
          ><app-select-field
            ><select
              id="knowledge-environment"
              [ngModel]="environmentId()"
              (ngModelChange)="selectEnvironment($event)"
            >
              <option value="">Choose an environment</option>
              @for (environment of environments(); track environment.id) {
                <option [value]="environment.id">{{ environment.name }}</option>
              }
            </select></app-select-field
          ></app-field
        >
        @if (view() === 'knowledge') {
          <app-field controlId="knowledge-search" label="Search"
            ><input
              id="knowledge-search"
              [(ngModel)]="search"
              (keyup.enter)="load()"
              placeholder="Search knowledge"
              maxlength="500"
          /></app-field>
          <app-field controlId="knowledge-type" label="Type"
            ><app-select-field
              ><select id="knowledge-type" [(ngModel)]="type" (ngModelChange)="load()">
                <option value="">All types</option>
                <option value="navigation">Navigation</option>
                <option value="workflow">Workflow</option>
                <option value="precondition">Precondition</option>
                <option value="behavior">Behavior</option>
              </select></app-select-field
            ></app-field
          >
          <app-field controlId="knowledge-status" label="Status"
            ><app-select-field
              ><select id="knowledge-status" [(ngModel)]="status" (ngModelChange)="load()">
                <option value="">All statuses</option>
                <option value="unverified">Unverified</option>
                <option value="verified">Verified</option>
                <option value="retired">Retired</option>
                <option value="stale">Needs rechecking</option>
              </select></app-select-field
            ></app-field
          >
          <button appButton (click)="load()" [disabled]="busy() || !environmentId()">
            Refresh
          </button>
        }
      </app-filter-bar>
      <app-segmented-control
        label="Knowledge view"
        [items]="views"
        [selected]="view()"
        (changed)="selectView($event)"
      />
      @if (view() === 'knowledge') {
        @if (error()) {
          <p role="alert">{{ error() }}</p>
        }
        @if (busy()) {
          <p>Loading knowledge…</p>
        }
        @for (record of records(); track record.id) {
          <app-disclosure
            [title]="record.title"
            [subtitle]="
              record.type +
              ' · ' +
              record.verificationStatus +
              ' · Confidence ' +
              (record.confidence | percent)
            "
          >
            <p class="content">{{ record.content }}</p>
            <p class="muted">
              {{ record.scopeOrigin }}{{ record.scopePath }} · Version {{ record.version }} ·
              Updated {{ record.updatedAt | date: 'medium' }}
            </p>
            <p>
              Last independently checked:
              {{ (record.lastVerifiedAt | date: 'medium') || 'Not yet checked' }}
            </p>
            <a [routerLink]="['/runs', record.sourceRunId]">View source run and observations</a>
            <app-disclosure title="Source observation IDs">
              @for (id of record.sourceEventIds; track id) {
                <code>{{ id }}</code>
              }
            </app-disclosure>
            <app-action-row
              ><button appButton (click)="showSources(record.id)">
                Show source observations
              </button></app-action-row
            >
            <app-knowledge-evidence [sources]="sources()[record.id] || []" />
            <h3>Changes and proposals</h3>
            @for (patch of patchesFor(record.id); track patch.id) {
              <app-knowledge-change [patch]="patch" sourceLabel="View evidence run">
                @if (patch.status === 'pending' && workspaces.admin()) {
                  <app-action-row
                    ><button
                      appButton
                      (click)="decide(patch.id, true)"
                      [disabled]="busy() || patch.latestVerification?.result !== 'confirmed'"
                    >
                      Apply confirmed change</button
                    ><button appButton (click)="decide(patch.id, false)" [disabled]="busy()">
                      Reject
                    </button></app-action-row
                  >
                }
              </app-knowledge-change>
            } @empty {
              <p>No recorded changes.</p>
            }
          </app-disclosure>
        } @empty {
          @if (environmentId() && !busy()) {
            <p>No knowledge matches these filters.</p>
          }
        }
        @if (records().length || offset > 0) {
          <app-pagination
            [hasPrevious]="offset > 0"
            [hasNext]="records().length === 50"
            [busy]="busy()"
            (changed)="page($event)"
          />
        }
      } @else if (environmentId()) {
        <app-knowledge-patches
          [workspaceId]="workspaceId()"
          [environmentId]="environmentId()"
          [environments]="environments()"
          [admin]="workspaces.admin()"
        />
      }
    </app-content-stack>
  `,
  styles: `
    p,
    h3 {
      margin: 0;
    }
    h3 {
      font-size: 16px;
    }
    p {
      line-height: 1.6;
    }
    .muted {
      color: var(--color-muted);
    }
    .content,
    code {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    a {
      color: var(--color-primary);
    }
    input {
      box-sizing: border-box;
      width: 100%;
      font: inherit;
      padding: 11px 14px;
      color: var(--color-text);
      background: var(--color-content);
      border: 1px solid var(--color-border);
      border-radius: 8px;
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
  protected readonly view = signal<'knowledge' | 'patches'>('knowledge');
  protected readonly views = [
    { id: 'knowledge', label: 'Active knowledge' },
    { id: 'patches', label: 'Patches and checks' },
  ];

  protected selectView(view: string) {
    this.view.set(view as 'knowledge' | 'patches');
  }
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
