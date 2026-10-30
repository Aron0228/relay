import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideDynamicIcon,
  LucidePlus,
  LucideArrowRight,
  LucideUsers,
  LucideCheck,
} from '@lucide/angular';
import { WorkspaceService, WorkspaceInvitation } from './workspace.service';
import { WorkspaceAvatar } from './components/workspace-avatar';

@Component({
  selector: 'app-workspace-list',
  imports: [RouterLink, WorkspaceAvatar, LucideDynamicIcon],
  styleUrl: './workspace-pages.css',
  template: `
    <div class="page-heading">
      <div>
        <h1>Workspaces</h1>
        <p>Choose where you want to work.</p>
      </div>
    </div>
    @if (workspaces.error() || error()) {
      <p class="error" role="alert">
        {{ workspaces.error() || error() }} <button (click)="load()">Retry</button>
      </p>
    }
    <div class="workspace-list">
      @for (workspace of workspaces.items(); track workspace.id) {
        <button class="workspace-card" (click)="workspaces.select(workspace.id)">
          <app-workspace-avatar [name]="workspace.name" [url]="workspace.avatarUrl" />
          <span class="workspace-info"
            ><strong>{{ workspace.name }}</strong
            ><span class="meta"
              ><svg [lucideIcon]="usersIcon" [size]="16" aria-hidden="true"></svg
              >{{ workspace.memberCount ?? 1 }}
              {{ (workspace.memberCount ?? 1) === 1 ? 'member' : 'members' }}</span
            ></span
          >
          <span class="role">{{
            workspace.isOwner ? 'Owner' : workspace.role === 'admin' ? 'Admin' : 'Member'
          }}</span>
          @if (workspace.id === workspaces.active()?.id) {
            <svg [lucideIcon]="checkIcon" [size]="20" class="selected" aria-label="Selected"></svg>
          }
          <svg [lucideIcon]="arrowIcon" [size]="20" aria-hidden="true"></svg>
        </button>
      } @empty {
        @if (workspaces.ready()) {
          <p class="empty">You haven’t joined a workspace yet.</p>
        } @else if (!workspaces.error()) {
          <p>Loading workspaces…</p>
        }
      }
    </div>
    <a class="workspace-card create-card" routerLink="/workspaces/new"
      ><span class="create-icon"
        ><svg [lucideIcon]="plusIcon" [size]="24" aria-hidden="true"></svg></span
      ><span class="workspace-info"
        ><strong>Create workspace</strong
        ><span class="meta">Set up a workspace for your team.</span></span
      ><svg [lucideIcon]="arrowIcon" [size]="20" aria-hidden="true"></svg
    ></a>
    @if (invitations().length) {
      <section class="invitations">
        <h2>Invitations</h2>
        @for (invitation of invitations(); track invitation.id) {
          <div class="invitation">
            <div>
              <strong>{{ invitation.workspaceName }}</strong>
              <p>{{ invitation.email }}</p>
            </div>
            <div class="actions">
              <button class="secondary" [disabled]="busy()" (click)="respond(invitation.id, false)">
                Decline</button
              ><button class="primary" [disabled]="busy()" (click)="respond(invitation.id, true)">
                Join workspace
              </button>
            </div>
          </div>
        }
      </section>
    }
  `,
})
export class WorkspaceList implements OnInit {
  protected readonly workspaces = inject(WorkspaceService);
  protected readonly invitations = signal<WorkspaceInvitation[]>([]);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly plusIcon = LucidePlus;
  protected readonly arrowIcon = LucideArrowRight;
  protected readonly usersIcon = LucideUsers;
  protected readonly checkIcon = LucideCheck;

  ngOnInit() {
    void this.load();
  }

  protected async load() {
    this.error.set('');

    try {
      await this.workspaces.refresh();
      this.invitations.set(
        await this.workspaces.request<WorkspaceInvitation[]>('GET', '/workspace-invitations'),
      );
    } catch {
      this.error.set('Could not load invitations. Please try again.');
    }
  }

  protected async respond(id: string, accept: boolean) {
    this.busy.set(true);

    try {
      await this.workspaces.request('POST', `/workspace-invitations/${id}/response`, { accept });
      await this.load();
    } catch {
      this.error.set('Could not update this invitation. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
