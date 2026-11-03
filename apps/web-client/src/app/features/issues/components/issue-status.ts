import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-issue-status',
  template: `<span
    class="badge"
    [class.confirmed]="outcome() === 'reproduced'"
    [class.working]="!finished()"
    >{{ label() }}</span
  >`,
  styles: `
    .badge {
      display: inline-flex;
      padding: 5px 9px;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      font-size: 11px;
      white-space: nowrap;
      color: var(--color-muted);
    }
    .confirmed {
      color: var(--color-text);
      background: var(--color-selected);
    }
    .working {
      color: var(--color-text);
    }
  `,
})
export class IssueStatus {
  readonly status = input.required<string>();
  readonly outcome = input<string | null>(null);
  protected readonly finished = computed(() =>
    ['completed', 'failed', 'cancelled'].includes(this.status()),
  );
  protected readonly label = computed(() => {
    if (!this.finished()) return this.status() === 'running' ? 'In progress' : 'Queued';
    if (this.status() === 'cancelled') return 'Cancelled';
    if (this.outcome() === 'reproduced') return 'Reproduced';
    if (this.outcome() === 'not_reproduced') return 'Not reproduced';
    return 'Uncertain';
  });
}

export function issueOutcomeLabel(outcome: string | null | undefined): string {
  if (outcome === 'reproduced') return 'Reproduced';
  if (outcome === 'not_reproduced') return 'Not reproduced';
  if (outcome === 'inconclusive') return 'Uncertain';
  return outcome ?? 'Waiting for a result';
}
