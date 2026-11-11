import { Component, input } from '@angular/core';

@Component({
  selector: 'app-content-stack',
  host: { '[style.--stack-gap]': "gap() + 'px'" },
  template: '<ng-content />',
  styles: ':host { display: grid; gap: var(--stack-gap); min-width: 0; }',
})
export class ContentStack {
  readonly gap = input(24);
}

@Component({
  selector: 'app-section-heading',
  template: `
    <header>
      <div>
        @if (level() === 2) {
          <h2>{{ title() }}</h2>
        } @else {
          <h3>{{ title() }}</h3>
        }
        @if (description()) {
          <p>{{ description() }}</p>
        }
      </div>
      <ng-content />
    </header>
  `,
  styles: `
    header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 16px;
    }
    header > div {
      display: grid;
      gap: 8px;
      max-width: 750px;
    }
    h2,
    h3,
    p {
      margin: 0;
    }
    h2 {
      font-size: 20px;
    }
    h3 {
      font-size: 18px;
    }
    p {
      color: var(--color-muted);
      line-height: 1.6;
    }
    @media (max-width: 600px) {
      header {
        flex-direction: column;
      }
    }
  `,
})
export class SectionHeading {
  readonly title = input.required<string>();
  readonly description = input('');
  readonly level = input<2 | 3>(2);
}

@Component({
  selector: 'app-action-row',
  template: '<ng-content />',
  styles: ':host { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }',
})
export class ActionRow {}

@Component({
  selector: 'app-filter-bar',
  template: '<ng-content />',
  styles: ':host { display: flex; align-items: end; flex-wrap: wrap; gap: 16px; min-width: 0; }',
})
export class FilterBar {}

@Component({
  selector: 'app-field',
  template: '<label [attr.for]="controlId()">{{ label() }}</label><ng-content />',
  styles: `
    :host {
      display: grid;
      gap: 8px;
      flex: 1;
      min-width: min(200px, 100%);
    }
    label {
      margin: 0;
    }
  `,
})
export class Field {
  readonly controlId = input.required<string>();
  readonly label = input.required<string>();
}
