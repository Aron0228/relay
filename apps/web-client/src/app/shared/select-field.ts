import { Component, ViewEncapsulation } from '@angular/core';
import { LucideChevronDown, LucideDynamicIcon } from '@lucide/angular';

@Component({
  selector: 'app-select-field',
  imports: [LucideDynamicIcon],
  host: { class: 'select-field' },
  encapsulation: ViewEncapsulation.None,
  template: `
    <ng-content />
    <svg [lucideIcon]="chevron" [size]="18" aria-hidden="true"></svg>
  `,
  styles: `
    app-select-field.select-field {
      position: relative;
      display: block;
      width: 100%;
      min-width: 0;
    }
    app-select-field.select-field > select {
      appearance: none;
      -webkit-appearance: none;
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      padding: 11px 44px 11px 12px;
      border: 1px solid var(--color-border);
      border-radius: 7px;
      background: var(--color-content);
      color: var(--color-text);
      font: inherit;
      cursor: pointer;
      text-overflow: ellipsis;
    }
    app-select-field.select-field > svg {
      position: absolute;
      top: 50%;
      right: 14px;
      transform: translateY(-50%);
      color: var(--color-muted);
      pointer-events: none;
    }
    app-select-field.select-field > select:focus-visible {
      outline: 2px solid var(--color-focus);
      outline-offset: 2px;
    }
    app-select-field.select-field > select:hover:not(:disabled) + svg,
    app-select-field.select-field > select:focus-visible + svg {
      color: var(--color-primary);
    }
    app-select-field.select-field > select:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
    app-select-field.select-field > select:disabled + svg {
      opacity: 0.6;
    }
  `,
})
export class SelectField {
  protected readonly chevron = LucideChevronDown;
}
