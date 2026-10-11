import { Component, inject, signal } from '@angular/core';
import { SessionService } from '../session.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  protected readonly sessions = inject(SessionService);
  protected readonly busy = signal(false);
  protected readonly error = this.sessions.error;

  protected login(): void {
    this.busy.set(true);
    this.error.set('');

    this.sessions.login();
  }
}
