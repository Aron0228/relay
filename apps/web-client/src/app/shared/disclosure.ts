import { Component, input, output } from '@angular/core';

@Component({
  selector: 'app-disclosure',
  template: `
    <details (toggle)="toggle($event)">
      <summary>
        <strong>{{ title() }}</strong>
        @if (subtitle()) {
          <span>{{ subtitle() }}</span>
        }
      </summary>
      <div class="body"><ng-content /></div>
    </details>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    details {
      border: 1px solid var(--color-border);
      border-radius: 10px;
      padding: 16px;
    }
    summary {
      cursor: pointer;
      overflow-wrap: anywhere;
    }
    span {
      display: block;
      margin-top: 8px;
      color: var(--color-muted);
      font-size: 13px;
    }
    .body {
      margin-top: 16px;
      display: grid;
      gap: 16px;
      min-width: 0;
    }
  `,
})
export class Disclosure {
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly opened = output<boolean>();

  protected toggle(event: Event) {
    if (event.target === event.currentTarget)
      this.opened.emit((event.target as HTMLDetailsElement).open);
  }
}
