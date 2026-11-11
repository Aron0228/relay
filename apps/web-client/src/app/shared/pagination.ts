import { Component, input, output } from '@angular/core';
import { AppButton } from './app-button';
import { ActionRow } from './layout';

@Component({
  selector: 'app-pagination',
  imports: [AppButton, ActionRow],
  template: `
    <app-action-row>
      <button appButton [disabled]="busy() || !hasPrevious()" (click)="changed.emit(-1)">
        {{ previousLabel() }}
      </button>
      <button appButton [disabled]="busy() || !hasNext()" (click)="changed.emit(1)">
        {{ nextLabel() }}
      </button>
    </app-action-row>
  `,
})
export class Pagination {
  readonly hasPrevious = input.required<boolean>();
  readonly hasNext = input.required<boolean>();
  readonly busy = input(false);
  readonly previousLabel = input('Previous');
  readonly nextLabel = input('Next');
  readonly changed = output<number>();
}
