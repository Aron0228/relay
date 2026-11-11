import { AppButton } from '../../../shared/app-button';
import { ContentStack } from '../../../shared/layout';
import { Disclosure } from '../../../shared/disclosure';
import { KnowledgeVerificationCard } from '../../workspace/components/knowledge-verification';
import { KnowledgeVerification as Verification } from '../../workspace/knowledge.models';
import { Component, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { WorkspaceService } from '../../workspace/workspace.service';

interface PatchUsage {
  id: string;
  snapshot: { id: string; scopePath: string; proposal: { title: string; content: string } };
}
interface KnowledgeUsage {
  id: string;
  version: number;
  createdAt: string;
  snapshot: {
    title: string;
    content: string;
    verificationStatus: string;
    stale: boolean;
    referenceOnly?: boolean;
  };
}

@Component({
  selector: 'app-run-knowledge',
  imports: [DatePipe, AppButton, ContentStack, Disclosure, KnowledgeVerificationCard],
  template: `
    <app-content-stack>
      <div>
        <button appButton (click)="load()" [disabled]="busy()">
          {{ busy() ? 'Loading…' : 'Show knowledge supplied to this run' }}
        </button>
      </div>
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      @if (loaded()) {
        @for (item of items(); track item.id) {
          <app-disclosure [title]="item.snapshot.title + ' · Version ' + item.version"
            ><p>{{ item.snapshot.content }}</p>
            <small
              >{{
                item.snapshot.referenceOnly
                  ? 'Reference from another environment or origin · '
                  : ''
              }}{{ item.snapshot.verificationStatus
              }}{{ item.snapshot.stale ? ' · May be outdated' : '' }} · Retrieved
              {{ item.createdAt | date: 'medium' }}</small
            ></app-disclosure
          >
        } @empty {
          <p>No stored knowledge was supplied to this run.</p>
        }
        <h3>Candidate patches supplied</h3>
        @for (patch of patches(); track patch.id) {
          <app-disclosure [title]="patch.snapshot.proposal.title + ' · ' + patch.snapshot.scopePath"
            ><p>{{ patch.snapshot.proposal.content }}</p></app-disclosure
          >
        } @empty {
          <p>No candidate patches were supplied.</p>
        }
        <h3>Patch checks from this run</h3>
        @for (check of verifications(); track check.id) {
          <app-knowledge-verification [verification]="check" [showPatchId]="true" />
        } @empty {
          <p>No patch checks were reported.</p>
        }
      }
    </app-content-stack>
  `,
  styles:
    ':host { display: block; margin-top: 24px; } p, h3 { margin: 0; } p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; } h3 { font-size: 16px; } small { color: var(--color-muted); }',
})
export class RunKnowledge {
  readonly workspaceId = input.required<string>();
  readonly runId = input.required<string>();
  private readonly workspaces = inject(WorkspaceService);
  protected readonly items = signal<KnowledgeUsage[]>([]);
  protected readonly patches = signal<PatchUsage[]>([]);
  protected readonly verifications = signal<Verification[]>([]);
  protected readonly busy = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');

  protected async load() {
    this.busy.set(true);
    this.error.set('');
    try {
      const path = `/workspaces/${this.workspaceId()}/runs/${this.runId()}`;
      const [knowledge, patches] = await Promise.all([
        this.workspaces.request<KnowledgeUsage[]>('GET', `${path}/knowledge`),
        this.workspaces.request<{ patches: PatchUsage[]; verifications: Verification[] }>(
          'GET',
          `${path}/knowledge-patches`,
        ),
      ]);
      this.items.set(knowledge);
      this.patches.set(patches.patches);
      this.verifications.set(patches.verifications);
      this.loaded.set(true);
    } catch {
      this.error.set('Could not load the knowledge supplied to this run.');
    } finally {
      this.busy.set(false);
    }
  }
}
