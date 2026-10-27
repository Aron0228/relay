import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Run, RunEvent, RunPage, RunResult } from './execution.models';

declare const API_BASE_URL: string;

@Injectable({ providedIn: 'root' })
export class ExecutionService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/runs`;

  list(scope = 'all', search = '', before?: string) {
    let params = new HttpParams().set('scope', scope).set('search', search);

    if (before) params = params.set('before', before);

    return firstValueFrom(this.http.get<RunPage>(this.base, { params, withCredentials: true }));
  }

  get(id: string) {
    return firstValueFrom(this.http.get<Run>(`${this.base}/${id}`, { withCredentials: true }));
  }

  result(id: string) {
    return firstValueFrom(
      this.http.get<RunResult | null>(`${this.base}/${id}/result`, { withCredentials: true }),
    );
  }

  cancel(id: string) {
    return firstValueFrom(
      this.http.post(`${this.base}/${id}/cancel`, {}, { withCredentials: true }),
    );
  }

  media(id: string, live: boolean) {
    return `${this.base}/${id}/media/${live ? 'stream' : 'video'}`;
  }

  watch(
    id: string,
    after: number,
    onEvent: (event: RunEvent) => void,
    onConnection: (connected: boolean) => void,
  ) {
    let source: EventSource;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let cursor = after;

    const names = [
      'run.queued',
      'worker.spawned',
      'agent.started',
      'agent.metrics',
      'agent.summary',
      'agent.activity',
      'agent.tool_called',
      'agent.tool_completed',
      'agent.tool_failed',
      'agent.completed',
      'run.completed',
      'run.failed',
      'run.cancelled',
      'run.cancel_requested',
    ];
    const connect = () => {
      source = new EventSource(`${this.base}/${id}/activity?after=${cursor}`, {
        withCredentials: true,
      });
      const receive = (message: MessageEvent<string>) => {
        const event = JSON.parse(message.data) as RunEvent;
        cursor = Number(event.sequence);
        onEvent(event);

        if (['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)) {
          stopped = true;
          source.close();
        }
      };

      for (const name of names) source.addEventListener(name, receive as EventListener);

      source.onopen = () => onConnection(true);
      source.onerror = () => {
        source.close();
        onConnection(false);

        if (!stopped) timer = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      source.close();
    };
  }
}
