import { Component, input, output, signal, OnDestroy } from '@angular/core';
import { LucideDynamicIcon, LucideImagePlus, LucideX } from '@lucide/angular';
import { WorkspaceAvatar } from './workspace-avatar';

@Component({
  selector: 'app-workspace-avatar-upload',
  imports: [WorkspaceAvatar, LucideDynamicIcon],
  template: `
    <div class="upload" [class.compact]="compact()">
      <label class="image" title="Choose workspace image">
        <app-workspace-avatar [name]="name() || 'W'" [url]="preview() || url()" />
        <span class="overlay"
          ><svg [lucideIcon]="imageIcon" [size]="20" aria-hidden="true"></svg
        ></span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Workspace image"
          (change)="choose($event)"
        />
      </label>
      @if (!compact() && description()) {
        <div>
          <strong>Workspace image</strong>
          <p>PNG, JPEG or WebP. Up to 5 MB.</p>
          @if (preview()) {
            <button type="button" (click)="reset()">
              <svg [lucideIcon]="closeIcon" [size]="14" aria-hidden="true"></svg> Clear selection
            </button>
          }
        </div>
      }
    </div>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
  `,
  styles: `
    .upload {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .image {
      position: relative;
      display: block;
      width: 88px;
      height: 88px;
      cursor: pointer;
      border: 1px dashed var(--color-border);
      border-radius: 16px;
      flex-shrink: 0;
    }
    app-workspace-avatar {
      --avatar-size: 86px;
      border-radius: 16px;
      font-size: 28px;
    }
    input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
    }
    .image:focus-within {
      outline: 2px solid var(--color-primary);
      outline-offset: 3px;
    }
    .overlay {
      position: absolute;
      right: -5px;
      bottom: -5px;
      display: grid;
      place-items: center;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 5px;
      background: var(--color-surface);
    }
    p {
      color: var(--color-muted);
      font-size: 13px;
      margin: 6px 0;
    }
    button {
      border: 0;
      background: transparent;
      color: var(--color-text);
      padding: 6px 0;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
    .compact .image {
      width: 40px;
      height: 40px;
      border-style: solid;
      border-radius: 8px;
    }
    .compact app-workspace-avatar {
      --avatar-size: 38px;
      border-radius: 8px;
      font-size: 16px;
    }
    .compact .overlay {
      right: -4px;
      bottom: -4px;
      padding: 2px;
      border-radius: 5px;
    }
    .compact .overlay svg {
      width: 12px;
      height: 12px;
    }
    .error {
      color: var(--color-error);
    }
  `,
})
export class WorkspaceAvatarUpload implements OnDestroy {
  readonly description = input(true);
  readonly compact = input(false);
  readonly name = input('');
  readonly url = input<string | null>();
  readonly selected = output<File | null>();
  protected readonly preview = signal('');
  protected readonly error = signal('');
  protected readonly imageIcon = LucideImagePlus;
  protected readonly closeIcon = LucideX;

  protected choose(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;

    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      this.error.set('Choose a PNG, JPEG or WebP image smaller than 5 MB.');
      return;
    }

    this.reset();
    this.preview.set(URL.createObjectURL(file));
    this.selected.emit(file);
  }

  protected reset() {
    if (this.preview()) URL.revokeObjectURL(this.preview());
    this.preview.set('');
    this.error.set('');
    this.selected.emit(null);
  }

  ngOnDestroy() {
    if (this.preview()) URL.revokeObjectURL(this.preview());
  }
}
