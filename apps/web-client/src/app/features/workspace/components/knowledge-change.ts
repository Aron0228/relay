import { Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ContentStack } from '../../../shared/layout';
import { KnowledgeChange } from '../knowledge.models';

@Component({
  selector: 'app-knowledge-change',
  imports: [DatePipe, RouterLink, ContentStack],
  template: `
    <app-content-stack [gap]="12">
      @if (showStatus()) {
        <strong>{{ patch().operation }} · {{ patch().status }}</strong>
      }
      <span>{{ patch().createdAt | date: 'medium' }}</span>
      <p>{{ patch().reason }}</p>
      @if (patch().previous?.content) {
        <h4>Current content at proposal time</h4>
        <p>{{ patch().previous!.content }}</p>
      }
      <h4>Proposed change</h4>
      <p>{{ patch().proposal.content }}</p>
      <a [routerLink]="['/runs', patch().sourceRunId]">{{ sourceLabel() }}</a>
      <ng-content />
    </app-content-stack>
  `,
  styles: `
    p {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.6;
    }
    h4 {
      margin: 0;
      font-size: 15px;
    }
    span {
      color: var(--color-muted);
      font-size: 13px;
    }
    a {
      color: var(--color-primary);
    }
  `,
})
export class KnowledgeChangeCard {
  readonly patch = input.required<KnowledgeChange>();
  readonly showStatus = input(true);
  readonly sourceLabel = input('View source run');
}
