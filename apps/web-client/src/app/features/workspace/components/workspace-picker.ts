import { Component, ElementRef, HostListener, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideDynamicIcon,
  LucideChevronDown,
  LucideChevronUp,
  LucidePlus,
  LucideCheck,
  LucideLayoutGrid,
} from '@lucide/angular';
import { WorkspaceService } from '../workspace.service';
import { WorkspaceAvatar } from './workspace-avatar';

@Component({
  selector: 'app-workspace-picker',
  imports: [WorkspaceAvatar, RouterLink, LucideDynamicIcon],
  template: `
    <div class="picker">
      <button
        class="trigger"
        type="button"
        [attr.aria-expanded]="open()"
        aria-controls="workspace-switcher"
        aria-label="Switch workspace"
        (click)="open.set(!open())"
      >
        @if (workspaces.active(); as workspace) {
          <app-workspace-avatar [name]="workspace.name" [url]="workspace.avatarUrl" />
          @if (!collapsed()) {
            <span class="info"
              ><strong>{{ workspace.name }}</strong
              ><span>{{
                workspace.isOwner ? 'Owner' : workspace.role === 'admin' ? 'Admin' : 'Member'
              }}</span></span
            ><svg
              [lucideIcon]="open() ? chevronUp : chevronDown"
              [size]="16"
              aria-hidden="true"
            ></svg>
          }
        }
      </button>
      @if (open()) {
        <div class="menu" id="workspace-switcher">
          <p class="label">Switch workspace</p>
          @for (workspace of workspaces.items(); track workspace.id) {
            <button
              class="option"
              [class.active]="workspace.id === workspaces.active()?.id"
              (click)="choose(workspace.id)"
            >
              <app-workspace-avatar [name]="workspace.name" [url]="workspace.avatarUrl" />
              <span class="info"
                ><strong>{{ workspace.name }}</strong
                ><span
                  >{{ workspace.memberCount ?? 1 }}
                  {{ (workspace.memberCount ?? 1) === 1 ? 'member' : 'members' }} ·
                  {{
                    workspace.isOwner ? 'Owner' : workspace.role === 'admin' ? 'Admin' : 'Member'
                  }}</span
                ></span
              >
              @if (workspace.id === workspaces.active()?.id) {
                <svg [lucideIcon]="check" [size]="18" aria-label="Selected"></svg>
              }
            </button>
          }
          <div class="menu-footer">
            <a routerLink="/workspaces" (click)="open.set(false)"
              ><svg [lucideIcon]="grid" [size]="18" aria-hidden="true"></svg>All workspaces</a
            ><a routerLink="/workspaces/new" (click)="open.set(false)"
              ><svg [lucideIcon]="plus" [size]="18" aria-hidden="true"></svg>Create workspace</a
            >
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .picker {
      position: relative;
      margin: 8px 0 24px;
    }
    button,
    a {
      color: var(--color-text);
      font: inherit;
      border: 0;
      text-decoration: none;
      cursor: pointer;
    }
    .trigger {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 6px;
      background: transparent;
      border-radius: 10px;
      text-align: left;
    }
    .trigger:hover {
      background: var(--color-selected);
    }
    .info {
      display: grid;
      gap: 5px;
      flex: 1;
      min-width: 0;
    }
    strong {
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .info > span {
      font-size: 11px;
      color: var(--color-muted);
    }
    .menu {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      width: min(320px, calc(100vw - 40px));
      z-index: 50;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 8px;
      box-shadow: 0 16px 48px #0006;
      max-height: 65svh;
      overflow-y: auto;
    }
    @media (max-width: 700px) {
      .menu {
        box-sizing: border-box;
        width: 100%;
      }
    }
    .label {
      color: var(--color-muted);
      font-size: 11px;
      margin: 8px 10px 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .option {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 10px;
      background: transparent;
      border-radius: 8px;
      width: 100%;
      text-align: left;
    }
    .option:hover,
    .option.active {
      background: var(--color-selected);
    }
    .option.active > svg {
      color: var(--color-primary);
    }
    .menu-footer {
      display: grid;
      border-top: 1px solid var(--color-border);
      margin-top: 8px;
      padding-top: 8px;
    }
    a {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 12px 10px;
      font-size: 13px;
      border-radius: 8px;
    }
    a:hover {
      background: var(--color-selected);
    }
  `,
})
export class WorkspacePicker {
  protected readonly workspaces = inject(WorkspaceService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly collapsed = input(false);
  protected readonly open = signal(false);
  protected readonly chevronDown = LucideChevronDown;
  protected readonly chevronUp = LucideChevronUp;
  protected readonly plus = LucidePlus;
  protected readonly check = LucideCheck;
  protected readonly grid = LucideLayoutGrid;

  @HostListener('document:click', ['$event'])
  outside(event: MouseEvent) {
    if (!this.element.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('keydown.escape')
  close() {
    this.open.set(false);
    this.element.nativeElement.querySelector<HTMLButtonElement>('.trigger')?.focus();
  }

  protected choose(id: string) {
    this.open.set(false);
    void this.workspaces.select(id);
  }
}
