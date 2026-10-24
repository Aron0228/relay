import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { LucideDynamicIcon, LucideMonitor } from '@lucide/angular';
import { ExecutionService } from '../execution.service';
import { Run } from '../execution.models';

@Component({
  selector: 'app-run-media',
  imports: [LucideDynamicIcon],
  template: `
    <div class="media">
      @if (run().status === 'running') {
        <img [src]="url()" alt="Live browser session" (error)="failed.set(true)" />
        <span class="live">Live</span>
      } @else if (run().videoFile) {
        <video
          controls
          preload="metadata"
          crossorigin="use-credentials"
          [src]="url()"
          (error)="failed.set(true)"
        >
          Your browser does not support this recording.
        </video>
      } @else {
        <div class="placeholder">
          <svg [lucideIcon]="monitor" [size]="28" aria-hidden="true"></svg
          ><span>{{
            run().status === 'queued' ? 'Waiting for a worker' : 'No recording available'
          }}</span>
        </div>
      }
      @if (failed()) {
        <p class="media-error">
          {{
            run().status === 'running'
              ? 'Live preview unavailable. Activity is still shown below.'
              : 'Could not play this recording.'
          }}
        </p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .media {
      position: relative;
      background: #08090b;
      border: 1px solid var(--color-border);
      border-radius: 12px;
      overflow: hidden;
    }
    img,
    video {
      display: block;
      width: 100%;
      aspect-ratio: 16/9;
      object-fit: contain;
    }
    .placeholder {
      aspect-ratio: 16/9;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
      color: var(--color-muted);
      font-size: 13px;
    }
    .live {
      position: absolute;
      left: 12px;
      top: 12px;
      background: var(--color-selected);
      color: var(--color-primary-hover);
      border-radius: 5px;
      padding: 4px 8px;
      font-size: 11px;
    }
    .media-error {
      padding: 10px 16px;
      color: var(--color-muted);
      font-size: 12px;
    }
  `,
})
export class RunMedia {
  readonly run = input.required<Run>();
  private readonly api = inject(ExecutionService);
  protected readonly url = computed(() =>
    this.api.media(this.run().id, this.run().status === 'running'),
  );
  protected readonly failed = signal(false);
  protected readonly monitor = LucideMonitor;

  constructor() {
    effect(() => {
      this.url();
      this.failed.set(false);
    });
  }
}
