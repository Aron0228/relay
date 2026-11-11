import { Component, input, output } from '@angular/core';
import { AppButton } from './app-button';

export interface Segment {
  id: string;
  label: string;
}

@Component({
  selector: 'app-segmented-control',
  imports: [AppButton],
  template: `
    <div [attr.role]="tabs() ? 'tablist' : 'group'" [attr.aria-label]="label()">
      @for (item of items(); track item.id) {
        <button
          appButton
          [attr.role]="tabs() ? 'tab' : null"
          [attr.aria-selected]="tabs() ? selected() === item.id : null"
          [attr.aria-pressed]="tabs() ? null : selected() === item.id"
          [attr.id]="idPrefix() ? idPrefix() + '-tab-' + item.id : null"
          [attr.aria-controls]="idPrefix() ? idPrefix() + '-' + item.id : null"
          [tabIndex]="!tabs() || selected() === item.id ? 0 : -1"
          [class.selected]="selected() === item.id"
          (click)="changed.emit(item.id)"
          (keydown)="key($event)"
        >
          {{ item.label }}
        </button>
      }
    </div>
  `,
  styles: `
    div {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    div[role='tablist'] {
      gap: 4px;
    }
    button.selected {
      background: var(--color-selected);
      font-weight: 550;
    }
    @media (max-width: 500px) {
      div[role='tablist'] {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `,
})
export class SegmentedControl {
  readonly items = input.required<readonly Segment[]>();
  readonly selected = input.required<string>();
  readonly label = input.required<string>();
  readonly tabs = input(false);
  readonly idPrefix = input('');
  readonly changed = output<string>();

  protected key(event: KeyboardEvent) {
    if (!this.tabs()) return;

    const current = this.items().findIndex((item) => item.id === this.selected());
    let next: number;

    if (event.key === 'ArrowRight') next = (current + 1) % this.items().length;
    else if (event.key === 'ArrowLeft')
      next = (current + this.items().length - 1) % this.items().length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = this.items().length - 1;
    else return;

    event.preventDefault();
    this.changed.emit(this.items()[next].id);
    const buttons = (
      event.currentTarget as HTMLElement
    ).parentElement!.querySelectorAll<HTMLButtonElement>('button');
    buttons[next].focus();
  }
}
