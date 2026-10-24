import { Component, input } from '@angular/core';
import { RunStatus } from '../execution.models';

@Component({
  selector: 'app-run-status',
  template:
    '<span class="badge" [attr.data-status]="status()"><span class="dot"></span>{{ labels[status()] }}</span>',
  styles: `
    .badge {
      display: inline-flex;
      gap: 7px;
      align-items: center;
      padding: 5px 9px;
      border: 1px solid var(--color-border);
      border-radius: 20px;
      font-size: 12px;
      white-space: nowrap;
      color: var(--color-muted);
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    [data-status='running'] {
      color: var(--color-primary-hover);
      background: var(--color-selected);
      border-color: transparent;
    }
    [data-status='failed'] {
      color: var(--color-error);
    }
    [data-status='completed'] {
      color: var(--color-success);
    }
  `,
})
export class RunStatusBadge {
  readonly status = input.required<RunStatus>();
  protected readonly labels = {
    queued: 'Queued',
    running: 'In progress',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
}
