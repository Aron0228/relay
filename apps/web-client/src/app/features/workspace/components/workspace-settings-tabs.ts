import { Component, input, output } from '@angular/core';

export const WORKSPACE_SETTINGS_TAB = {
  General: 'general',
  Members: 'members',
  Environments: 'environments',
  Github: 'github',
} as const;
export type WorkspaceSettingsTab =
  (typeof WORKSPACE_SETTINGS_TAB)[keyof typeof WORKSPACE_SETTINGS_TAB];

@Component({
  selector: 'app-workspace-settings-tabs',
  template: `
    <div role="tablist" aria-label="Workspace settings">
      @for (tab of tabs; track tab.id) {
        <button
          type="button"
          role="tab"
          [id]="'workspace-settings-tab-' + tab.id"
          [attr.aria-controls]="'workspace-settings-' + tab.id"
          [attr.aria-selected]="selected() === tab.id"
          [tabIndex]="selected() === tab.id ? 0 : -1"
          (click)="changed.emit(tab.id)"
          (keydown)="key($event)"
        >
          {{ tab.label }}
        </button>
      }
    </div>
  `,
  styles: `
    [role='tablist'] {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      padding: 0;
    }
    button {
      flex-shrink: 0;
      position: relative;
      padding: 13px 20px;
      border: 1px solid var(--color-border);

      border-radius: 8px;
      background: var(--color-surface);
      color: var(--color-text);
      font: inherit;
      font-size: 14px;
      cursor: pointer;
    }
    button:hover {
      color: var(--color-text);
      background: var(--color-selected);
    }
    button[aria-selected='true'] {
      background: var(--color-selected);
      border-color: var(--color-border);
      color: var(--color-text);
      font-weight: 550;
    }
    button:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: -4px;
    }
    @media (max-width: 500px) {
      [role='tablist'] {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      button {
        padding: 12px 14px;
        font-size: 13px;
      }
    }
  `,
})
export class WorkspaceSettingsTabs {
  readonly selected = input.required<WorkspaceSettingsTab>();
  readonly changed = output<WorkspaceSettingsTab>();
  protected readonly tabs = [
    { id: WORKSPACE_SETTINGS_TAB.General, label: 'General' },
    { id: WORKSPACE_SETTINGS_TAB.Members, label: 'Members' },
    { id: WORKSPACE_SETTINGS_TAB.Environments, label: 'Environments' },
    { id: WORKSPACE_SETTINGS_TAB.Github, label: 'GitHub' },
  ];

  protected key(event: KeyboardEvent) {
    const current = this.tabs.findIndex((tab) => tab.id === this.selected());
    let index: number;

    if (event.key === 'ArrowRight') index = (current + 1) % this.tabs.length;
    else if (event.key === 'ArrowLeft') index = (current + this.tabs.length - 1) % this.tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = this.tabs.length - 1;
    else return;

    event.preventDefault();
    this.changed.emit(this.tabs[index].id);
    const buttons = (
      event.currentTarget as HTMLElement
    ).parentElement!.querySelectorAll<HTMLButtonElement>('button');

    buttons[index].focus();
  }
}
