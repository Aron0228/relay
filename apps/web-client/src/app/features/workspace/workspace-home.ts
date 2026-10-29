import { Component, inject } from '@angular/core';
import { Router, RouterOutlet, RouterLink } from '@angular/router';
import { LucideDynamicIcon, LucideChevronLeft } from '@lucide/angular';
import { firstValueFrom } from 'rxjs';
import { SessionService } from '../auth/session.service';
import { WorkspaceService } from './workspace.service';

@Component({
  selector: 'app-workspace-home',
  imports: [RouterOutlet, RouterLink, LucideDynamicIcon],
  template: `
    <div class="frame">
      <header>
        @if (creating || workspaces.active()) {
          <a class="back" [routerLink]="creating ? '/workspaces' : '/overview'"
            ><svg [lucideIcon]="backIcon" [size]="18" aria-hidden="true"></svg>Back</a
          >
        } @else {
          <span class="brand">Relay</span>
        }
        <div class="account">
          <span>{{ sessions.profile()?.['name'] || 'GitHub account' }}</span
          ><button type="button" (click)="logout()">Sign out</button>
        </div>
      </header>
      <main><router-outlet /></main>
      @if (error) {
        <p role="alert">{{ error }}</p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100svh;
      box-sizing: border-box;
      padding: 8px;
      background: var(--color-background);
      color: var(--color-text);
    }
    .frame {
      min-height: calc(100svh - 16px);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      background: var(--color-content);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      min-height: 56px;
      padding: 8px 24px;
    }
    .brand {
      font-size: 14px;
      color: var(--color-muted);
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--color-muted);
      text-decoration: none;
    }
    .back:hover,
    button:hover {
      color: var(--color-text);
    }
    .account {
      display: flex;
      align-items: center;
      gap: 20px;
      font-size: 13px;
      color: var(--color-muted);
    }
    button {
      color: var(--color-muted);
      background: transparent;
      border: 0;
      cursor: pointer;
      font: inherit;
    }
    main {
      max-width: 780px;
      padding: 0 24px 80px;
      margin: 56px auto 0;
    }
    [role='alert'] {
      color: var(--color-error);
      text-align: center;
    }
    @media (max-width: 600px) {
      header {
        padding: 8px 16px;
      }
      main {
        margin-top: 32px;
        padding: 0 20px 48px;
      }
      .account span {
        display: none;
      }
    }
  `,
})
export class WorkspaceHome {
  protected readonly sessions = inject(SessionService);
  protected readonly backIcon = LucideChevronLeft;
  protected get creating() {
    return this.router.url.startsWith('/workspaces/new');
  }
  protected readonly workspaces = inject(WorkspaceService);
  private readonly router = inject(Router);
  protected error = '';

  protected async logout() {
    try {
      await firstValueFrom(this.sessions.logout());
      this.sessions.clear();
      this.workspaces.clear();
      await this.router.navigateByUrl('/auth/login');
    } catch {
      this.error = 'Could not sign out. Please try again.';
    }
  }
}
