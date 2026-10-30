import { Component, inject, input, OnInit, signal } from '@angular/core';
import { LucideDynamicIcon, LucideInfo } from '@lucide/angular';
import { HttpErrorResponse } from '@angular/common/http';
import { SessionService } from '../../auth/session.service';
import { WorkspaceAvatarUpload } from './workspace-avatar-upload';
import { WorkspaceSettingsTabs, WorkspaceSettingsTab } from './workspace-settings-tabs';
import { WorkspaceSidePanel } from './workspace-side-panel';
import { FormsModule } from '@angular/forms';
import {
  WorkspaceService,
  Environment,
  WorkspaceInvitation,
  WorkspaceMember,
} from '../workspace.service';

@Component({
  selector: 'app-workspace-manager',
  imports: [
    LucideDynamicIcon,
    FormsModule,
    WorkspaceAvatarUpload,
    WorkspaceSettingsTabs,
    WorkspaceSidePanel,
  ],
  styleUrl: './workspace-manager.css',
  template: `
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (settings() && workspaces.active(); as workspace) {
      <app-workspace-settings-tabs [selected]="tab()" (changed)="tab.set($event)" />
      <div class="settings-panel" [attr.aria-busy]="busy()">
        <section
          role="tabpanel"
          id="workspace-settings-general"
          aria-labelledby="workspace-settings-tab-general"
          [hidden]="tab() !== 'general'"
          tabindex="0"
        >
          <div class="section-heading">
            <div>
              <h2>Workspace details</h2>
              <p>Manage your workspace’s name and image.</p>
            </div>
          </div>
          @if (workspaces.admin()) {
            <form class="general-form" (ngSubmit)="submit('saveWorkspace')">
              <div class="setting-row">
                <div>
                  <h3>Workspace image</h3>
                  <p>PNG, JPEG or WebP. Up to 5 MB.</p>
                </div>
                <div class="image-actions">
                  <app-workspace-avatar-upload
                    [name]="name"
                    [url]="workspace.avatarUrl"
                    [description]="false"
                    (selected)="avatarFile = $event"
                  />
                  @if (workspace.avatarUrl) {
                    <button type="button" [disabled]="busy()" (click)="removeAvatar()">
                      Remove image
                    </button>
                  }
                </div>
              </div>
              <div class="setting-row">
                <label for="workspace-name">Workspace name</label>
                <input
                  id="workspace-name"
                  name="name"
                  [(ngModel)]="name"
                  required
                  maxlength="100"
                />
              </div>
              <div class="form-actions">
                <button class="primary" [disabled]="busy()">Save changes</button>
              </div>
            </form>
            <div class="danger-zone">
              <div>
                <h3>Delete workspace</h3>
                <p>Remove access to this workspace. Previous runs are retained.</p>
              </div>
              <button class="danger" [disabled]="busy()" (click)="deleteWorkspace()">
                Delete workspace
              </button>
            </div>
          } @else {
            <div class="read-only">
              <strong>{{ workspace.name }}</strong>
              <p>Workspace details can be changed by an admin.</p>
            </div>
          }
        </section>
        <section
          role="tabpanel"
          id="workspace-settings-members"
          aria-labelledby="workspace-settings-tab-members"
          [hidden]="tab() !== 'members'"
          tabindex="0"
        >
          <div class="section-heading">
            <div>
              <h2>Members</h2>
              <p>People with access to this workspace.</p>
            </div>
            @if (workspaces.admin()) {
              <button class="primary" (click)="openInvitation()">Invite member</button>
            }
          </div>
          <div class="item-list">
            @for (member of members(); track member.userId) {
              <div class="member-row">
                <span class="member-avatar" aria-hidden="true">{{
                  member.username.charAt(0).toUpperCase()
                }}</span>
                <div class="identity">
                  <strong>{{ member.username }}</strong
                  ><span>{{
                    member.isOwner ? 'Owner' : member.role === 'admin' ? 'Admin' : 'Member'
                  }}</span>
                </div>
                @if (workspaces.admin() && !member.isOwner) {
                  <button [disabled]="busy()" (click)="editMember(member)">Edit</button>
                }
              </div>
            }
          </div>
          @if (workspaces.admin()) {
            @if (sent().length) {
              <div class="subsection">
                <h3>Pending invitations</h3>
                @for (invitation of sent(); track invitation.id) {
                  <div class="row">
                    <span>{{ invitation.email }}</span
                    ><button [disabled]="busy()" (click)="revoke(invitation.id)">Revoke</button>
                  </div>
                }
              </div>
            }
          }
          @if (!workspace.isOwner) {
            <div class="leave">
              <button class="danger" [disabled]="busy()" (click)="leave()">Leave workspace</button>
            </div>
          }
        </section>
        <section
          role="tabpanel"
          id="workspace-settings-environments"
          aria-labelledby="workspace-settings-tab-environments"
          [hidden]="tab() !== 'environments'"
          tabindex="0"
        >
          <div class="section-heading">
            <div>
              <h2>Environments</h2>
              <p>Configure the sites that can be tested in this workspace.</p>
            </div>
            @if (workspaces.admin()) {
              <button class="primary" (click)="newEnvironment()">New environment</button>
            }
          </div>
          <div class="item-list">
            @for (environment of environments(); track environment.id) {
              <div class="row environment-row">
                <div class="identity">
                  <strong>{{ environment.name }}</strong
                  ><span>{{ environment.baseUrl }}</span>
                </div>
                @if (workspaces.admin()) {
                  <div class="row-actions">
                    <button [disabled]="busy()" (click)="editEnvironment(environment)">Edit</button
                    ><button
                      class="text-button"
                      [disabled]="busy()"
                      (click)="removeEnvironment(environment.id)"
                    >
                      Delete
                    </button>
                  </div>
                }
              </div>
            } @empty {
              <p class="empty">No environments configured.</p>
            }
          </div>
        </section>
      </div>
      @if (panel()) {
        <app-workspace-side-panel [title]="panelTitle()" (closed)="closePanel()">
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          @if (panel() === 'environment') {
            <form (ngSubmit)="submit('saveEnvironment')" #environmentForm="ngForm">
              <label
                >Name<input
                  name="environmentName"
                  [(ngModel)]="environmentName"
                  required
                  maxlength="100"
              /></label>
              <label
                >Base URL<input
                  name="baseUrl"
                  [(ngModel)]="baseUrl"
                  type="url"
                  required
                  placeholder="https://example.com"
              /></label>
              <div class="form-actions">
                <button class="primary" [disabled]="busy() || environmentForm.invalid">
                  Save environment
                </button>
              </div>
            </form>
          } @else if (panel() === 'invitation') {
            <form (ngSubmit)="submit('invite')" #invitationForm="ngForm">
              <label>
                <span
                  class="email-label"
                  title="Use an email address verified on your GitHub account."
                  >E-mail
                  <svg
                    class="email-hint"
                    [lucideIcon]="infoIcon"
                    [size]="14"
                    aria-hidden="true"
                  ></svg></span
                ><input
                  name="email"
                  aria-description="Use an email address verified on your GitHub account."
                  [(ngModel)]="email"
                  type="email"
                  required
                  email
                  placeholder="name@example.com"
              /></label>
              <div class="form-actions">
                <button class="primary" [disabled]="busy() || invitationForm.invalid">
                  Invite member
                </button>
              </div>
            </form>
          } @else if (selectedMember(); as member) {
            <form (ngSubmit)="saveMember()">
              <label
                >Role<select name="role" [(ngModel)]="memberRole">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select></label
              >
              <p>Choose this member’s permissions within the workspace.</p>
              <div class="form-actions">
                <button class="primary" [disabled]="busy()">Save changes</button>
              </div>
            </form>
            <div class="danger-zone">
              <div>
                <h3>Remove member</h3>
                <p>Remove their access to this workspace.</p>
              </div>
              <button class="danger" [disabled]="busy()" (click)="removeMember(member.userId)">
                Remove member
              </button>
            </div>
          }
        </app-workspace-side-panel>
      }
    }
  `,
})
export class WorkspaceManager implements OnInit {
  protected readonly infoIcon = LucideInfo;
  protected readonly workspaces = inject(WorkspaceService);
  private readonly sessions = inject(SessionService);
  readonly settings = input(false);
  protected readonly tab = signal<WorkspaceSettingsTab>('general');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly sent = signal<WorkspaceInvitation[]>([]);
  protected readonly members = signal<WorkspaceMember[]>([]);
  protected readonly environments = signal<Environment[]>([]);
  protected avatarFile: File | null = null;
  protected readonly panel = signal<'environment' | 'invitation' | 'member' | null>(null);
  protected readonly selectedMember = signal<WorkspaceMember | null>(null);
  protected memberRole: 'admin' | 'member' = 'member';
  protected panelTitle() {
    return this.panel() === 'environment'
      ? this.environmentId
        ? 'Edit environment'
        : 'New environment'
      : this.panel() === 'invitation'
        ? 'Invite member'
        : (this.selectedMember()?.username ?? 'Member');
  }

  protected closePanel() {
    if (!this.busy()) this.panel.set(null);
  }

  protected openInvitation() {
    this.error.set('');
    this.email = '';
    this.panel.set('invitation');
  }

  protected newEnvironment() {
    this.resetEnvironment();
    this.error.set('');
    this.panel.set('environment');
  }

  protected editMember(member: WorkspaceMember) {
    this.error.set('');
    this.selectedMember.set(member);
    this.memberRole = member.role;
    this.panel.set('member');
  }

  protected name = '';
  protected email = '';
  protected environmentId = '';
  protected environmentName = '';
  protected baseUrl = '';

  ngOnInit() {
    void this.perform(() => this.load());
  }

  protected submit(action: 'load' | 'saveWorkspace' | 'invite' | 'saveEnvironment') {
    void this.perform(() => this[action]());
  }

  protected async perform(action: () => Promise<unknown>) {
    this.busy.set(true);
    this.error.set('');

    try {
      await action();
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse
          ? (error.error?.error?.message ?? 'The operation failed. Please try again.')
          : 'The operation failed. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  protected async load() {
    const workspace = this.workspaces.active();

    if (!workspace || !this.settings()) return;

    this.name = workspace.name;
    this.members.set(
      await this.workspaces.request<WorkspaceMember[]>('GET', `${this.path()}/members`),
    );
    this.environments.set(await this.workspaces.environments());
    this.sent.set(
      this.workspaces.admin()
        ? await this.workspaces.request<WorkspaceInvitation[]>('GET', `${this.path()}/invitations`)
        : [],
    );
  }

  private path() {
    return `/workspaces/${this.workspaces.active()!.id}`;
  }

  protected async saveWorkspace() {
    await this.workspaces.request('PATCH', this.path(), {
      name: this.name,
    });
    if (this.avatarFile) {
      await this.workspaces.uploadAvatar(this.workspaces.active()!.id, this.avatarFile);
      this.avatarFile = null;
    }
    await this.workspaces.refresh();
  }

  protected removeAvatar() {
    void this.perform(async () => {
      await this.workspaces.request('DELETE', `${this.path()}/avatar`);
      await this.workspaces.refresh();
    });
  }

  protected async invite() {
    await this.workspaces.request('POST', `${this.path()}/invitations`, { email: this.email });
    this.email = '';
    this.panel.set(null);
    await this.load();
  }

  protected revoke(id: string) {
    void this.perform(async () => {
      await this.workspaces.request('DELETE', `${this.path()}/invitations/${id}`);
      await this.load();
    });
  }

  protected saveMember() {
    const member = this.selectedMember()!;

    void this.perform(async () => {
      await this.workspaces.request('PATCH', `${this.path()}/members/${member.userId}`, {
        role: this.memberRole,
      });
      this.panel.set(null);
      await this.workspaces.refresh();
      await this.load();
    });
  }

  protected removeMember(id: string) {
    if (confirm('Remove this member?'))
      void this.perform(async () => {
        await this.workspaces.request('DELETE', `${this.path()}/members/${id}`);
        this.panel.set(null);
        if (id === String(this.sessions.profile()?.['id'])) {
          this.workspaces.active.set(null);
          await this.workspaces.selectAfterRemoval();
        } else {
          await this.workspaces.refresh();
          await this.load();
        }
      });
  }

  protected leave() {
    const id = String(this.sessions.profile()?.['id']);
    if (confirm('Leave this workspace?'))
      void this.perform(async () => {
        await this.workspaces.request('DELETE', `${this.path()}/members/${id}`);
        this.panel.set(null);
        this.workspaces.active.set(null);
        await this.workspaces.selectAfterRemoval();
      });
  }

  protected deleteWorkspace() {
    if (confirm('Delete this workspace? Existing history will be retained.'))
      void this.perform(async () => {
        await this.workspaces.request('DELETE', this.path());
        this.workspaces.active.set(null);
        await this.workspaces.selectAfterRemoval();
      });
  }

  protected editEnvironment(environment: Environment) {
    this.error.set('');
    this.panel.set('environment');
    this.environmentId = environment.id;
    this.environmentName = environment.name;
    this.baseUrl = environment.baseUrl;
  }

  protected resetEnvironment() {
    this.environmentId = '';
    this.environmentName = '';
    this.baseUrl = '';
  }

  protected async saveEnvironment() {
    await this.workspaces.request(
      this.environmentId ? 'PATCH' : 'POST',
      `${this.path()}/environments${this.environmentId ? '/' + this.environmentId : ''}`,
      { name: this.environmentName, baseUrl: this.baseUrl },
    );
    this.resetEnvironment();
    this.panel.set(null);
    await this.load();
  }

  protected removeEnvironment(id: string) {
    if (confirm('Delete this environment? Previous runs will be retained.'))
      void this.perform(async () => {
        await this.workspaces.request('DELETE', `${this.path()}/environments/${id}`);
        await this.load();
      });
  }
}
