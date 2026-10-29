import { Component, input, signal, computed, effect, inject } from '@angular/core';

import { WorkspaceService } from '../workspace.service';

@Component({
  selector: 'app-workspace-avatar',
  template: `@if (source()) {
      <img
        [src]="source()"
        crossorigin="use-credentials"
        alt=""
        referrerpolicy="no-referrer"
        (error)="failed.set(true)"
        [hidden]="failed()"
      />
    }
    @if (!source() || failed()) {
      <span aria-hidden="true">{{ name().charAt(0).toUpperCase() }}</span>
    }`,
  styles: `
    :host {
      display: inline-flex;
      width: var(--avatar-size, 32px);
      height: var(--avatar-size, 32px);
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      overflow: hidden;
      background: var(--color-selected);
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class WorkspaceAvatar {
  private readonly workspaces = inject(WorkspaceService);
  protected readonly source = computed(() => this.workspaces.avatarSource(this.url()));

  constructor() {
    effect(() => {
      this.url();
      this.failed.set(false);
    });
  }

  readonly name = input.required<string>();
  readonly url = input<string | null>();
  readonly failed = signal(false);
}
