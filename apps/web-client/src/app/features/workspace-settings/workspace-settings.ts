import { Component } from '@angular/core';
import { WorkspaceManager } from '../workspace/components/workspace-manager';

@Component({
  selector: 'app-workspace-settings',
  imports: [WorkspaceManager],
  template: '<app-workspace-manager [settings]="true" />',
})
export class WorkspaceSettingsPage {}
