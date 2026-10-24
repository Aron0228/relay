import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { routes } from '../../app.routes';
import { WorkspaceShell } from '../workspace/workspace-shell';
import { SessionService } from './session.service';

describe('Authentication routes', () => {
  let sessions: SessionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WorkspaceShell],
      providers: [provideHttpClient(), provideRouter(routes)],
    });
    sessions = TestBed.inject(SessionService);
    vi.spyOn(sessions, 'me').mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401 })),
    );
  });

  it('redirects a signed-out visitor to login', async () => {
    const harness = await RouterTestingHarness.create('/workers');
    const page = harness.routeNativeElement!;

    expect(TestBed.inject(Router).url).toBe('/auth/login');
    expect(page.querySelector('h1')?.textContent).toBe('Log in to Relay');
    expect(page.querySelector('[role="alert"]')).toBeNull();

    const login = vi.spyOn(sessions, 'login').mockImplementation(() => undefined);
    page.querySelector('button')?.click();
    harness.detectChanges();

    expect(login).toHaveBeenCalledOnce();
    expect(page.querySelector('button')?.disabled).toBe(true);
  });

  it('redirects an existing session away from login', async () => {
    vi.mocked(sessions.me).mockReturnValue(of({ name: 'Finn the Human' }));
    await RouterTestingHarness.create('/auth/login');

    expect(TestBed.inject(Router).url).toBe('/overview');
  });

  it('exchanges the callback code once and replaces the callback with overview', async () => {
    vi.mocked(sessions.me).mockReturnValue(of({ name: 'Finn the Human' }));
    const exchange = vi.spyOn(sessions, 'exchange').mockReturnValue(of({}));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    await RouterTestingHarness.create('/auth/callback?exchange_code=finn-code');
    await vi.waitFor(() => expect(router.url).toBe('/overview'));

    expect(exchange).toHaveBeenCalledExactlyOnceWith('finn-code');
    expect(sessions.profile()?.['name']).toBe('Finn the Human');
    expect(navigate).toHaveBeenCalledWith('/overview', { replaceUrl: true });
  });

  it('returns failed callbacks to login with a retry message', async () => {
    vi.spyOn(sessions, 'exchange').mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401 })),
    );
    const router = TestBed.inject(Router);
    await RouterTestingHarness.create('/auth/callback?exchange_code=expired-code');
    await vi.waitFor(() => expect(router.url).toBe('/auth/login'));

    expect(sessions.error()).toBe('Could not sign in. Please try again.');
    expect(sessions.profile()).toBeNull();
  });

  it('does not exchange a code when the callback is opened without one', async () => {
    const exchange = vi.spyOn(sessions, 'exchange');
    await RouterTestingHarness.create('/auth/callback');
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/auth/login'));

    expect(exchange).not.toHaveBeenCalled();
  });

  it('shows a retry message when session restoration fails', async () => {
    vi.mocked(sessions.me).mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503 })),
    );
    const harness = await RouterTestingHarness.create('/overview');

    expect(harness.routeNativeElement?.querySelector('[role="alert"]')?.textContent).toContain(
      'Please try signing in again',
    );
  });
});
