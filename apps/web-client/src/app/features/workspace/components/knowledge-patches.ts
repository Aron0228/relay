import { AppButton } from '../../../shared/app-button';
import { ActionRow, ContentStack, Field, FilterBar, SectionHeading } from '../../../shared/layout';
import { Disclosure } from '../../../shared/disclosure';
import { Pagination } from '../../../shared/pagination';
import { KnowledgeEvidenceList } from './knowledge-evidence';
import { KnowledgeChangeCard } from './knowledge-change';
import { KnowledgeVerificationCard } from './knowledge-verification';
import {
  KnowledgeEvidence as Evidence,
  KnowledgeVerification as Verification,
} from '../knowledge.models';
import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectField } from '../../../shared/select-field';
import { Environment, WorkspaceService } from '../workspace.service';

interface Patch {
  id: string;
  environmentId: string;
  sourceEnvironmentId?: string;
  sourceUrl?: string;
  sourceRunId: string;
  scopeOrigin: string;
  scopePath: string;
  operation: string;
  status: string;
  baseVersion?: number;
  appliedVerificationId?: string;
  reason: string;
  createdAt: string;
  proposal: { title: string; content: string };
  previous?: { content: string };
  latestVerification?: Verification;
}
interface PatchDetail {
  patch: Patch;
  latestVerification?: Verification;
  verifications: Verification[];
  sources: Evidence[];
}

@Component({
  selector: 'app-knowledge-patches',
  imports: [
    FormsModule,
    SelectField,
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
    KnowledgeVerificationCard,
  ],
  template: `
    <app-content-stack>
      <app-section-heading
        [level]="3"
        title="Knowledge patches"
        description="Proposed changes await observations from another run in the target environment. Preview proposals appear under the repository’s default environment."
        ><button appButton (click)="load()" [disabled]="busy()">
          Refresh
        </button></app-section-heading
      >
      <app-filter-bar>
        <app-field controlId="knowledge-patch-status" label="Application status"
          ><app-select-field
            ><select id="knowledge-patch-status" [(ngModel)]="status" (ngModelChange)="load()">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="accepted">Applied / accepted</option>
              <option value="rejected">Rejected</option>
              <option value="conflict">Version conflict</option>
            </select></app-select-field
          ></app-field
        >
        <app-field controlId="knowledge-patch-result" label="Latest check"
          ><app-select-field
            ><select id="knowledge-patch-result" [(ngModel)]="result" (ngModelChange)="load()">
              <option value="">All</option>
              <option value="unverified">Not yet checked</option>
              <option value="confirmed">Confirmed</option>
              <option value="contradicted">Contradicted</option>
              <option value="inconclusive">Inconclusive</option>
            </select></app-select-field
          ></app-field
        >
      </app-filter-bar>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      @if (busy()) {
        <p>Loading patches…</p>
      }
      @for (patch of patches(); track patch.id + '-' + generation) {
        <app-disclosure
          [title]="patch.proposal.title"
          [subtitle]="
            patch.operation +
            ' · ' +
            patch.status +
            ' · ' +
            (patch.latestVerification?.result || 'Not yet checked')
          "
          (opened)="opened($event, patch.id)"
        >
          <p class="scope">{{ patch.scopeOrigin }}{{ patch.scopePath }}</p>
          <app-knowledge-change [patch]="patch" [showStatus]="false" />
          <p>
            From {{ environmentName(patch.sourceEnvironmentId) }} →
            {{ environmentName(patch.environmentId) }}
          </p>
          <p class="scope">
            Observed at {{ patch.sourceUrl
            }}{{ patch.baseVersion ? ' · Based on version ' + patch.baseVersion : '' }}
          </p>
          @if (patch.appliedVerificationId) {
            <p>Applied after independent confirmation in the target environment.</p>
          }
          @if (patch.status === 'pending') {
            <p class="scope">
              A contradictory or inconclusive check keeps the proposal pending for a later run.
            </p>
          }
          @if (admin() && patch.status === 'pending') {
            <app-action-row
              ><button
                appButton
                (click)="decide(patch.id, true)"
                [disabled]="busy() || patch.latestVerification?.result !== 'confirmed'"
              >
                Apply confirmed change</button
              ><button appButton (click)="decide(patch.id, false)" [disabled]="busy()">
                Reject proposal
              </button></app-action-row
            >
          }
          @if (details()[patch.id]; as detail) {
            <app-disclosure title="Original observations"
              ><app-knowledge-evidence [sources]="detail.sources"
            /></app-disclosure>
            <h4>Verification history</h4>
            @for (verification of detail.verifications; track verification.id) {
              <app-knowledge-verification
                [verification]="verification"
                [showActions]="true"
                (observationsRequested)="showEvidence(patch.id, verification.id)"
                ><app-knowledge-evidence [sources]="evidence()[verification.id] || []"
              /></app-knowledge-verification>
            } @empty {
              <p>No independent checks yet.</p>
            }
            <app-pagination
              previousLabel="Newer checks"
              nextLabel="Older checks"
              [hasPrevious]="(historyOffsets[patch.id] || 0) > 0"
              [hasNext]="detail.verifications.length === 50"
              (changed)="history(patch.id, $event)"
            />
          } @else {
            <p>Loading history…</p>
          }
        </app-disclosure>
      } @empty {
        @if (!busy()) {
          <p>No patches match these filters.</p>
        }
      }
      @if (patches().length || offset > 0) {
        <app-pagination
          [hasPrevious]="offset > 0"
          [hasNext]="patches().length === 50"
          [busy]="busy()"
          (changed)="page($event)"
        />
      }
    </app-content-stack>
  `,
  styles:
    'p, h4 { margin: 0; } p { line-height: 1.6; } h4 { font-size: 15px; } .scope { color: var(--color-muted); overflow-wrap: anywhere; }',
})
export class KnowledgePatches {
  readonly workspaceId = input.required<string>();
  readonly environmentId = input.required<string>();
  readonly environments = input.required<Environment[]>();
  readonly admin = input(false);
  private readonly api = inject(WorkspaceService);
  protected readonly patches = signal<Patch[]>([]);
  protected readonly details = signal<Record<string, PatchDetail>>({});
  protected readonly evidence = signal<Record<string, Evidence[]>>({});
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected status = '';
  protected result = '';
  protected offset = 0;
  protected historyOffsets: Record<string, number> = {};
  protected generation = 0;

  constructor() {
    effect(() => {
      this.workspaceId();
      this.environmentId();
      void this.load();
    });
  }

  protected environmentName(id?: string) {
    return (
      this.environments().find((environment) => environment.id === id)?.name ??
      'Previous environment'
    );
  }
  private path() {
    return `/workspaces/${this.workspaceId()}/environments/${this.environmentId()}/knowledge-patches`;
  }

  protected async load(reset = true) {
    const generation = ++this.generation;
    if (reset) this.offset = 0;
    this.busy.set(true);
    this.error.set('');
    this.details.set({});
    this.evidence.set({});
    this.historyOffsets = {};
    const query = new URLSearchParams({ offset: String(this.offset) });
    if (this.status) query.set('status', this.status);
    if (this.result) query.set('result', this.result);

    try {
      const patches = await this.api.request<Patch[]>('GET', `${this.path()}?${query}`);
      if (generation === this.generation) this.patches.set(patches);
    } catch {
      if (generation === this.generation) this.error.set('Could not load knowledge patches.');
    } finally {
      if (generation === this.generation) this.busy.set(false);
    }
  }

  protected page(direction: number) {
    this.offset += direction * 50;
    void this.load(false);
  }
  protected opened(open: boolean, id: string) {
    if (open && !this.details()[id]) void this.loadDetail(id);
  }
  protected history(id: string, direction: number) {
    this.historyOffsets[id] = (this.historyOffsets[id] || 0) + direction * 50;
    void this.loadDetail(id);
  }

  private async loadDetail(id: string) {
    const generation = this.generation;
    try {
      const detail = await this.api.request<PatchDetail>(
        'GET',
        `${this.path()}/${id}?offset=${this.historyOffsets[id] || 0}`,
      );
      if (generation === this.generation)
        this.details.update((items) => ({ ...items, [id]: detail }));
    } catch {
      if (generation === this.generation) this.error.set('Could not load patch history.');
    }
  }

  protected async showEvidence(patchId: string, id: string) {
    const generation = this.generation;
    try {
      const data = await this.api.request<{ sources: Evidence[] }>(
        'GET',
        `${this.path()}/${patchId}/verifications/${id}`,
      );
      if (generation === this.generation)
        this.evidence.update((items) => ({ ...items, [id]: data.sources }));
    } catch {
      if (generation === this.generation)
        this.error.set('Could not load verification observations.');
    }
  }

  protected async decide(id: string, accept: boolean) {
    this.busy.set(true);
    try {
      const response = await this.api.request<{ status: string }>('PATCH', `${this.path()}/${id}`, {
        accept,
      });
      await this.load(false);
      if (response.status === 'conflict')
        this.error.set('The knowledge changed since this proposal. A new proposal is needed.');
    } catch {
      this.error.set(
        'Could not apply this decision. Confirmation and an unchanged base version are required.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
