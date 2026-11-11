import { Component, input, output } from '@angular/core';
import { DatePipe, PercentPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AppButton } from '../../../shared/app-button';
import { ActionRow, ContentStack } from '../../../shared/layout';
import { KnowledgeVerification } from '../knowledge.models';

@Component({
  selector: 'app-knowledge-verification',
  imports: [DatePipe, PercentPipe, RouterLink, AppButton, ActionRow, ContentStack],
  template: `
    <app-content-stack [gap]="12">
      <strong>{{ verification().result }}</strong>
      <span
        >{{ verification().createdAt | date: 'medium' }} · Confidence
        {{ verification().confidence | percent }}</span
      >
      <p>{{ verification().reason }}</p>
      @for (url of verification().observedUrls; track url) {
        <span>{{ url }}</span>
      }
      @if (showPatchId()) {
        <span>Patch {{ verification().patchId }}</span>
      }
      @if (showActions()) {
        <app-action-row>
          <a [routerLink]="['/runs', verification().runId]">View checking run</a>
          <button appButton (click)="observationsRequested.emit()">Show observations</button>
        </app-action-row>
      }
      <ng-content />
    </app-content-stack>
  `,
  styles: `
    :host {
      display: block;
      border: 1px solid var(--color-border);
      border-radius: 10px;
      padding: 16px;
      min-width: 0;
    }
    p {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.6;
    }
    span {
      color: var(--color-muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    a {
      color: var(--color-primary);
    }
  `,
})
export class KnowledgeVerificationCard {
  readonly verification = input.required<KnowledgeVerification>();
  readonly showActions = input(false);
  readonly showPatchId = input(false);
  readonly observationsRequested = output<void>();
}
