import { Component, input } from '@angular/core';
import { Disclosure } from '../../../shared/disclosure';
import { ContentStack } from '../../../shared/layout';
import { KnowledgeEvidence } from '../knowledge.models';

@Component({
  selector: 'app-knowledge-evidence',
  host: { '[style.display]': "sources().length ? 'block' : 'none'" },
  imports: [Disclosure, ContentStack],
  template: `
    <app-content-stack [gap]="12">
      @for (source of sources(); track source.id) {
        <app-disclosure [title]="source.id">
          <pre>{{ source.payload.observation }}</pre>
        </app-disclosure>
      }
    </app-content-stack>
  `,
  styles:
    'pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 350px; overflow: auto; font-size: 12px; line-height: 1.6; }',
})
export class KnowledgeEvidenceList {
  readonly sources = input.required<KnowledgeEvidence[]>();
}
