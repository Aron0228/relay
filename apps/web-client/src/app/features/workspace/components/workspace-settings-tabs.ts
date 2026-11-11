import { SegmentedControl } from '../../../shared/segmented-control';
import { Component, input, output } from '@angular/core';

export const WORKSPACE_SETTINGS_TAB = {
  General: 'general',
  Members: 'members',
  Environments: 'environments',
  Github: 'github',
  Knowledge: 'knowledge',
} as const;
export type WorkspaceSettingsTab =
  (typeof WORKSPACE_SETTINGS_TAB)[keyof typeof WORKSPACE_SETTINGS_TAB];

@Component({
  selector: 'app-workspace-settings-tabs',
  imports: [SegmentedControl],
  template:
    '<app-segmented-control label="Workspace settings" [tabs]="true" idPrefix="workspace-settings" [items]="tabs" [selected]="selected()" (changed)="select($event)" />',
})
export class WorkspaceSettingsTabs {
  readonly selected = input.required<WorkspaceSettingsTab>();
  readonly changed = output<WorkspaceSettingsTab>();
  protected readonly tabs = [
    { id: WORKSPACE_SETTINGS_TAB.General, label: 'General' },
    { id: WORKSPACE_SETTINGS_TAB.Members, label: 'Members' },
    { id: WORKSPACE_SETTINGS_TAB.Environments, label: 'Environments' },
    { id: WORKSPACE_SETTINGS_TAB.Github, label: 'GitHub' },
    { id: WORKSPACE_SETTINGS_TAB.Knowledge, label: 'Knowledge' },
  ];

  protected select(value: string) {
    this.changed.emit(value as WorkspaceSettingsTab);
  }
}
