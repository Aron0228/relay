import {
  LucideDynamicIcon,
  LucideTextAlignStart,
  LucideSparkle,
  LucideSettings,
  LucideBot,
  LucidePlay,
  LucideCircleDot,
  LucideGitPullRequest,
  LucidePanelLeft,
  LucideSearch,
  LucideMenu,
  LucideX,
} from '@lucide/angular';
import { Component, ElementRef, viewChild, computed, inject, signal } from '@angular/core';

import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom } from 'rxjs';
import { WorkspaceService } from './workspace.service';
import { WorkspacePicker } from './components/workspace-picker';
import { SessionService } from '../auth/session.service';

const NAVIGATION = [
  {
    label: 'Workspace',
    items: [
      { name: 'Overview', path: '/overview', icon: LucideTextAlignStart },
      { name: 'Assistant', path: '/assistant', icon: LucideSparkle },
      { name: 'Workspace Settings', path: '/workspace-settings', icon: LucideSettings },
    ],
  },
  {
    label: 'Testing',
    items: [
      { name: 'Workers', path: '/workers', icon: LucideBot },
      { name: 'Runs', path: '/runs', icon: LucidePlay },
      { name: 'Issues', path: '/issues', icon: LucideCircleDot },
      { name: 'Pull Requests', path: '/pull-requests', icon: LucideGitPullRequest },
    ],
  },
] as const;

@Component({
  imports: [LucideDynamicIcon, RouterLink, RouterOutlet, WorkspacePicker],
  selector: 'app-workspace-shell',
  templateUrl: './workspace-shell.html',
  styleUrl: './workspace-shell.css',
})
export class WorkspaceShell {
  protected readonly icons = {
    menu: LucideMenu,
    search: LucideSearch,
    panelLeft: LucidePanelLeft,
    close: LucideX,
  };

  protected readonly workspaces = inject(WorkspaceService);

  constructor() {
    void this.workspaces.ensureLoaded();
  }

  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);
  private readonly navigationEnd = toSignal(
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)),
  );
  protected readonly profile = this.sessions.profile;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly collapsed = signal(false);
  protected readonly mobileOpen = signal(false);
  protected readonly searching = signal(false);
  protected readonly query = signal('');
  protected readonly selected = computed(() => {
    this.navigationEnd();
    let route = this.router.routerState.snapshot.root;

    while (route.firstChild) route = route.firstChild;

    return String(route.data['pageTitle'] ?? 'Overview');
  });
  protected readonly accountOpen = signal(false);
  protected readonly name = computed(() => String(this.profile()?.['name'] || 'GitHub account'));
  protected readonly email = computed(() =>
    String(this.profile()?.['email'] || 'Signed in with GitHub'),
  );
  protected readonly groups = computed(() =>
    NAVIGATION.map((group) => ({
      label: group.label,
      items: group.items.filter((item) =>
        item.name.toLowerCase().includes(this.query().toLowerCase()),
      ),
    })),
  );

  private readonly sidebar = viewChild.required<ElementRef<HTMLElement>>('sidebar');
  private readonly menuToggle = viewChild.required<ElementRef<HTMLButtonElement>>('menuToggle');

  protected openMenu(): void {
    this.mobileOpen.set(true);

    queueMicrotask(() => this.sidebar().nativeElement.focus());
  }

  protected closeMenu(): void {
    this.mobileOpen.set(false);

    this.menuToggle().nativeElement.focus();
  }

  protected menuKey(event: KeyboardEvent): void {
    if (!this.mobileOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeMenu();
    }

    if (event.key === 'Tab') {
      const controls = this.sidebar().nativeElement.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input',
      );
      const visible = [...controls].filter((control) => control.getClientRects().length > 0);
      const first = visible[0];
      const last = visible[visible.length - 1];
      const focused = document.activeElement;

      if (event.shiftKey && (focused === first || focused === this.sidebar().nativeElement)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  protected toggleSidebar(): void {
    this.collapsed.update((value) => !value);
  }

  protected toggleAccount(): void {
    this.accountOpen.update((value) => !value);
  }

  protected select(): void {
    if (this.mobileOpen()) this.closeMenu();
  }

  protected async logout(): Promise<void> {
    this.busy.set(true);
    this.error.set('');

    try {
      await firstValueFrom(this.sessions.logout());
      this.sessions.clear();
      this.workspaces.clear();
      this.sessions.error.set('');

      await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
    } catch {
      this.error.set('Could not sign out. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected search(): void {
    this.collapsed.set(false);
    this.searching.update((value) => !value);
    this.query.set('');
  }
}
