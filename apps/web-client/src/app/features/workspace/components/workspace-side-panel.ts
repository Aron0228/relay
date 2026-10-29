import { LucideDynamicIcon, LucideX } from '@lucide/angular';
import { Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';

@Component({
  selector: 'app-workspace-side-panel',
  imports: [LucideDynamicIcon],
  template: `
    <dialog (cancel)="$event.preventDefault(); closed.emit()" [attr.aria-label]="title()">
      <header>
        <h2>{{ title() }}</h2>
        <button type="button" aria-label="Close panel" (click)="closed.emit()">
          <svg [lucideIcon]="closeIcon" [size]="20" aria-hidden="true"></svg>
        </button>
      </header>
      <div class="body"><ng-content /></div>
    </dialog>
  `,
  styles: `
    dialog {
      box-sizing: border-box;
      position: fixed;
      inset: 0 0 0 auto;
      margin: 0;
      width: min(440px, 100%);
      height: 100dvh;
      max-height: 100dvh;
      max-width: 100%;
      padding: 0;
      border: 0;
      border-left: 1px solid var(--color-border);
      background: var(--color-surface);
      color: var(--color-text);
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 45%);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 24px;
      border-bottom: 1px solid var(--color-border);
    }
    h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 550;
    }
    button {
      display: grid;
      place-items: center;
      padding: 0;
      cursor: pointer;
      background: var(--color-content);
      color: var(--color-text);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      width: 32px;
      height: 32px;
      font-size: 24px;
    }
    button:hover {
      color: var(--color-primary);
    }
    .body {
      padding: 24px;
    }
  `,
})
export class WorkspaceSidePanel {
  protected readonly closeIcon = LucideX;
  readonly title = input.required<string>();
  readonly closed = output<void>();
  private readonly element = inject(ElementRef<HTMLElement>);

  constructor() {
    afterNextRender(() => this.element.nativeElement.querySelector('dialog')!.showModal());
  }
}
