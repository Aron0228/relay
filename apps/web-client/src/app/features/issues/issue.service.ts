import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { WorkspaceService } from '../workspace/workspace.service';
import { IssueDetail, IssueItem } from './issue.models';

declare const API_BASE_URL: string;

@Injectable({ providedIn: 'root' })
export class IssueService {
  private readonly http = inject(HttpClient);
  private readonly workspaces = inject(WorkspaceService);

  list(search: string, before?: string, resource = 'issues') {
    const workspaceId = this.workspaces.active()?.id;
    if (!workspaceId) return Promise.resolve({ items: [] as IssueItem[], nextCursor: null });

    let params = new HttpParams().set('workspaceId', workspaceId);
    if (search.trim()) params = params.set('search', search.trim());
    if (before) params = params.set('before', before);

    return firstValueFrom(
      this.http.get<{ items: IssueItem[]; nextCursor: string | null }>(
        `${API_BASE_URL}/${resource}`,
        {
          params,
          withCredentials: true,
        },
      ),
    );
  }

  get(id: string, taskId?: string, resource = 'issues') {
    const params = taskId ? new HttpParams().set('taskId', taskId) : undefined;
    return firstValueFrom(
      this.http.get<IssueDetail>(`${API_BASE_URL}/${resource}/${id}`, {
        params,
        withCredentials: true,
      }),
    );
  }

  cancel(id: string) {
    return firstValueFrom(
      this.http.post(`${API_BASE_URL}/tasks/${id}/cancel`, {}, { withCredentials: true }),
    );
  }
}
