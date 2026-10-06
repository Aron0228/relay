import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

declare const API_BASE_URL: string;

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);

  login(): void {
    window.location.assign(`${API_BASE_URL}/sessions/login?client=web`);
  }

  exchange(exchangeCode: string) {
    return this.http.post(
      `${API_BASE_URL}/sessions/exchange`,
      { exchangeCode },
      { withCredentials: true },
    );
  }

  me() {
    return this.http.get<Record<string, unknown>>(`${API_BASE_URL}/sessions/me`, {
      withCredentials: true,
    });
  }

  logout() {
    return this.http.post(`${API_BASE_URL}/sessions/logout`, {}, { withCredentials: true });
  }
}
