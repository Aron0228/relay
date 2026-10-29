import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { WorkspaceService } from './workspace.service';
import { WorkspaceAvatarUpload } from './components/workspace-avatar-upload';

@Component({
  selector: 'app-workspace-create',
  imports: [FormsModule, RouterLink, WorkspaceAvatarUpload],
  styleUrl: './workspace-pages.css',
  template: `
    <div class="page-heading">
      <div>
        <h1>Create workspace</h1>
        <p>Add a name and an image. Members and environments can be added in settings.</p>
      </div>
    </div>
    <form class="create-form" (ngSubmit)="create()">
      <div class="form-panel">
        <div class="setting-row">
          <label for="workspace-name">Icon &amp; name</label>
          <div class="name-controls">
            <app-workspace-avatar-upload
              [compact]="true"
              [name]="name"
              (selected)="file = $event"
            />
            <input
              id="workspace-name"
              aria-label="Workspace name"
              name="name"
              [(ngModel)]="name"
              maxlength="100"
              placeholder="e.g. Engineering"
              required
              [disabled]="!!createdId"
            />
          </div>
        </div>
      </div>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      <div class="actions">
        <a class="secondary" routerLink="/workspaces">Cancel</a
        ><button class="primary" [disabled]="busy() || !name.trim()">
          {{ busy() ? 'Saving…' : createdId ? 'Retry image upload' : 'Create workspace' }}
        </button>
      </div>
      @if (createdId && !busy()) {
        <button class="secondary" type="button" (click)="finish()">Continue without image</button>
      }
    </form>
  `,
})
export class WorkspaceCreate {
  private readonly workspaces = inject(WorkspaceService);
  private readonly router = inject(Router);
  protected name = '';
  protected file: File | null = null;
  protected createdId = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async create() {
    if (!this.name.trim() || this.busy()) return;

    this.busy.set(true);
    this.error.set('');

    try {
      if (!this.createdId) this.createdId = (await this.workspaces.create(this.name.trim())).id;
      if (this.file) await this.workspaces.uploadAvatar(this.createdId, this.file);
      await this.workspaces.refresh();
      await this.finish();
    } catch {
      this.error.set(
        this.createdId
          ? 'Workspace created, but the image could not be uploaded. Retry or continue without it.'
          : 'Could not create the workspace. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async finish() {
    await this.workspaces.select(this.createdId);
  }
}
