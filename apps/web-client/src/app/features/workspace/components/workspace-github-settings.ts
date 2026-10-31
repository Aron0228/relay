import { Component, HostListener, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Environment, WorkspaceService } from '../workspace.service';
import { WorkspaceSidePanel } from './workspace-side-panel';

interface Installation {
  id: string;
  githubId: number;
  accountLogin: string;
}
interface Repository {
  id: string;
  githubId: number;
  installationId: string;
  fullName: string;
  defaultEnvironmentId: string;
}
interface AvailableInstallation {
  githubId: number;
  accountLogin: string;
}
interface AvailableRepository {
  githubId: number;
  fullName: string;
}
interface Connection {
  installations: Installation[];
  repositories: Repository[];
}

@Component({
  selector: 'app-workspace-github-settings',
  imports: [FormsModule, WorkspaceSidePanel],
  styleUrl: './workspace-manager.css',
  styles: `
    :host {
      margin-top: 0;
    }
    select {
      width: 100%;
    }
    .connections {
      margin-top: 28px;
    }
    .section-heading,
    .github-actions {
      flex-wrap: wrap;
    }
    @media (max-width: 650px) {
      .row {
        flex-wrap: wrap;
      }
    }
  `,
  template: `
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    <div class="section-heading">
      <div>
        <h2>GitHub</h2>
        <p>Connect repositories to an approved test environment.</p>
      </div>
      @if (workspaces.admin()) {
        <div class="row-actions github-actions">
          <button [disabled]="busy()" (click)="openGithub()">Install GitHub App</button>
          <button [disabled]="busy()" (click)="refresh()">Refresh</button>
          <button class="primary" [disabled]="busy()" (click)="openConnection()">
            Connect installation
          </button>
        </div>
      }
    </div>
    <div class="item-list">
      @for (installation of connection().installations; track installation.id) {
        <div class="row">
          <div class="identity">
            <strong>{{ installation.accountLogin }}</strong
            ><span>Installation #{{ installation.githubId }}</span>
          </div>
          @if (workspaces.admin()) {
            <div class="row-actions github-actions">
              <button [disabled]="busy()" (click)="openGithub(installation.id)">
                Manage on GitHub
              </button>
              <button
                class="danger"
                [disabled]="busy()"
                (click)="disconnect('installations', installation.id)"
              >
                Disconnect
              </button>
            </div>
          }
        </div>
      } @empty {
        <p class="empty">No GitHub installation connected.</p>
      }
    </div>
    <div class="section-heading connections">
      <div>
        <h2>Repositories</h2>
        <p>Choose the environment used to test each repository.</p>
      </div>
      @if (workspaces.admin()) {
        <button
          [disabled]="busy() || !connection().installations.length || !environments().length"
          (click)="openRepository()"
        >
          Add repository
        </button>
      }
    </div>
    @if (workspaces.admin() && !environments().length) {
      <p>Create an environment in the Environments tab first.</p>
    }
    <div class="item-list">
      @for (repository of connection().repositories; track repository.id) {
        <div class="row environment-row">
          <div class="identity">
            <strong>{{ repository.fullName }}</strong
            ><span>{{ environmentName(repository.defaultEnvironmentId) }}</span>
          </div>
          @if (workspaces.admin()) {
            <div class="row-actions">
              <button [disabled]="busy()" (click)="openRepository(repository)">Edit</button
              ><button
                class="danger"
                [disabled]="busy()"
                (click)="disconnect('repositories', repository.id)"
              >
                Remove
              </button>
            </div>
          }
        </div>
      } @empty {
        <p class="empty">No repository configured.</p>
      }
    </div>
    @if (panel()) {
      <app-workspace-side-panel
        [title]="panel() === 'connection' ? 'Connect GitHub installation' : 'Repository settings'"
        (closed)="close()"
      >
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        @if (panel() === 'connection') {
          <form (ngSubmit)="connect()">
            <button type="button" [disabled]="busy()" (click)="openGithub()">
              Install GitHub App
            </button>
            <p>
              Install the GitHub App on GitHub first. Personal account owners and organization
              owners can connect their installations.
            </p>
            <label
              >Installation<select name="installation" [(ngModel)]="githubInstallationId">
                <option [ngValue]="0" disabled>Choose installation</option>
                @for (item of availableInstallations(); track item.githubId) {
                  <option [ngValue]="item.githubId">
                    {{ item.accountLogin }} (#{{ item.githubId }})
                  </option>
                }
              </select></label
            >
            @if (!busy() && !availableInstallations().length) {
              <p>No installation you can manage was found.</p>
            }
            <button type="button" [disabled]="busy()" (click)="refreshAvailable()">
              Refresh installations
            </button>
            <div class="form-actions">
              <button class="primary" [disabled]="busy() || !githubInstallationId">Connect</button>
            </div>
          </form>
        } @else {
          <form (ngSubmit)="save()">
            <label
              >Installation<select
                name="installationId"
                [(ngModel)]="installationId"
                (ngModelChange)="loadRepositories()"
              >
                <option value="" disabled>Choose installation</option>
                @for (item of connection().installations; track item.id) {
                  <option [value]="item.id">{{ item.accountLogin }}</option>
                }
              </select></label
            >
            <label
              >Repository<select name="repository" [(ngModel)]="githubRepositoryId">
                <option [ngValue]="0" disabled>Choose repository</option>
                @for (item of availableRepositories(); track item.githubId) {
                  <option [ngValue]="item.githubId">{{ item.fullName }}</option>
                }
              </select></label
            >
            <label
              >Approved environment<select name="environment" [(ngModel)]="environmentId">
                <option value="" disabled>Choose environment</option>
                @for (item of environments(); track item.id) {
                  <option [value]="item.id">{{ item.name }} — {{ item.baseUrl }}</option>
                }
              </select></label
            >
            <div class="form-actions">
              <button
                class="primary"
                [disabled]="busy() || !installationId || !githubRepositoryId || !environmentId"
              >
                Save repository
              </button>
            </div>
          </form>
        }
      </app-workspace-side-panel>
    }
  `,
})
export class WorkspaceGithubSettings implements OnInit {
  protected readonly workspaces = inject(WorkspaceService);
  protected readonly connection = signal<Connection>({ installations: [], repositories: [] });
  protected readonly environments = signal<Environment[]>([]);
  protected readonly availableInstallations = signal<AvailableInstallation[]>([]);
  protected readonly availableRepositories = signal<AvailableRepository[]>([]);
  protected readonly panel = signal<'connection' | 'repository' | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private waitingForGithub = false;
  protected githubInstallationId = 0;
  protected installationId = '';
  protected githubRepositoryId = 0;
  protected environmentId = '';

  ngOnInit() {
    void this.perform(() => this.load());
  }

  private path() {
    return `/workspaces/${this.workspaces.active()!.id}/github`;
  }

  private async load() {
    const [connection, environments] = await Promise.all([
      this.workspaces.request<Connection>('GET', this.path()),
      this.workspaces.environments(),
    ]);
    this.connection.set(connection);
    this.environments.set(environments);
  }

  private async perform(action: () => Promise<unknown>) {
    this.busy.set(true);
    this.error.set('');

    try {
      await action();
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse
          ? (error.error?.error?.message ?? 'GitHub connection failed. Please try again.')
          : 'GitHub connection failed. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  @HostListener('window:focus')
  protected returnedFromGithub() {
    if (this.waitingForGithub && !this.busy()) {
      this.waitingForGithub = false;
      this.refresh();
    }
  }

  protected refresh() {
    void this.perform(async () => {
      await this.load();
      if (this.panel() === 'connection') {
        this.availableInstallations.set(
          await this.workspaces.request<AvailableInstallation[]>(
            'GET',
            `${this.path()}/available-installations`,
          ),
        );
      }
    });
  }

  protected openGithub(installationId?: string) {
    const popup = window.open('', '_blank');

    if (!popup) {
      this.error.set('Allow pop-ups to open the GitHub installation settings.');
      return;
    }

    popup.opener = null;
    void this.perform(async () => {
      try {
        const path = installationId
          ? `${this.path()}/installations/${installationId}/settings-url`
          : `${this.path()}/installation-url`;
        const { url } = await this.workspaces.request<{ url: string }>('GET', path);
        this.waitingForGithub = true;
        popup.location.replace(url);
      } catch (error) {
        popup.close();
        throw error;
      }
    });
  }

  protected close() {
    if (!this.busy()) this.panel.set(null);
  }
  protected environmentName(id: string) {
    return this.environments().find((item) => item.id === id)?.name ?? 'Environment unavailable';
  }
  protected openConnection() {
    this.githubInstallationId = 0;
    this.panel.set('connection');
    this.refreshAvailable();
  }
  protected refreshAvailable() {
    void this.perform(async () =>
      this.availableInstallations.set(
        await this.workspaces.request<AvailableInstallation[]>(
          'GET',
          `${this.path()}/available-installations`,
        ),
      ),
    );
  }
  protected connect() {
    void this.perform(async () => {
      await this.workspaces.request('POST', `${this.path()}/installations`, {
        githubId: this.githubInstallationId,
      });
      await this.load();
      this.panel.set(null);
    });
  }

  protected openRepository(repository?: Repository) {
    this.installationId =
      repository?.installationId ?? this.connection().installations[0]?.id ?? '';
    this.githubRepositoryId = repository?.githubId ?? 0;
    this.environmentId = repository?.defaultEnvironmentId ?? '';
    this.panel.set('repository');
    this.loadRepositories(repository?.githubId);
  }

  protected loadRepositories(selected = 0) {
    this.githubRepositoryId = selected;
    this.availableRepositories.set([]);
    if (!this.installationId) return;
    void this.perform(async () =>
      this.availableRepositories.set(
        await this.workspaces.request<AvailableRepository[]>(
          'GET',
          `${this.path()}/installations/${this.installationId}/repositories`,
        ),
      ),
    );
  }

  protected save() {
    void this.perform(async () => {
      await this.workspaces.request('POST', `${this.path()}/repositories`, {
        installationId: this.installationId,
        githubId: this.githubRepositoryId,
        environmentId: this.environmentId,
      });
      await this.load();
      this.panel.set(null);
    });
  }
  protected disconnect(kind: 'installations' | 'repositories', id: string) {
    if (!confirm('Disconnect this GitHub connection? Previous tasks and runs will be retained.'))
      return;
    void this.perform(async () => {
      await this.workspaces.request('DELETE', `${this.path()}/${kind}/${id}`);
      await this.load();
    });
  }
}
