import { Location } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SessionService } from '../session.service';

@Component({
  selector: 'app-auth-callback',
  template: '<main><p role="status">Completing sign-in…</p></main>',
  styles: 'main { min-height: 100svh; display: grid; place-items: center; }',
})
export class AuthCallback implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly sessions = inject(SessionService);

  async ngOnInit(): Promise<void> {
    const code = this.route.snapshot.queryParamMap.get('exchange_code');
    this.location.replaceState('/auth/callback');

    try {
      if (!code) throw new Error('Missing exchange code');

      await firstValueFrom(this.sessions.exchange(code));
      const profile = await this.sessions.refresh();

      if (!profile) throw new Error('Session unavailable');

      await this.router.navigateByUrl('/overview', { replaceUrl: true });
    } catch {
      this.sessions.clear();
      this.sessions.error.set('Could not sign in. Please try again.');

      await this.router.navigateByUrl('/auth/login', { replaceUrl: true });
    }
  }
}
