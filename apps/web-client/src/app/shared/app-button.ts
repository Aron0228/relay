import { Component, input } from '@angular/core';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- Keep native button behavior for forms and keyboard access.
  selector: 'button[appButton]',
  host: { '[attr.type]': 'type()' },
  template: '<ng-content />',
  styles: `
    :host {
      cursor: pointer;
      color: var(--color-text);
      background: var(--color-content);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 11px 14px;
      font: inherit;
    }
    :host:hover {
      background: var(--color-selected);
    }
    :host:disabled {
      opacity: 0.5;
      cursor: default;
    }
    :host:focus-visible {
      outline: 2px solid var(--color-focus);
      outline-offset: 2px;
    }
  `,
})
export class AppButton {
  readonly type = input<'button' | 'submit' | 'reset'>('button');
}
