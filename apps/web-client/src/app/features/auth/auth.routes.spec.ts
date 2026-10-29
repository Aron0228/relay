import { WorkspaceShell } from '../workspace/workspace-shell';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { WorkspaceService } from '../workspace/workspace.service';
import { WorkspaceList } from '../workspace/workspace-list';
import { WorkspaceHome } from '../workspace/workspace-home';
import { routes } from '../../app.routes';
import { SessionService } from './session.service';

describe('Authentication routes', () => {
  let sessions: SessionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WorkspaceShell, WorkspaceList, WorkspaceHome],
      providers: [provideHttpClient(), provideRouter(routes)],
    });
    const workspaces = TestBed.inject(WorkspaceService);
    const workspace = { id: 'candy', name: 'Candy Kingdom', role: 'admin' as const };
    workspaces.active.set(workspace);
    workspaces.items.set([workspace]);
    workspaces.ready.set(true);
    vi.spyOn(workspaces, 'refresh').mockResolvedValue();
    vi.spyOn(workspaces, 'request').mockResolvedValue([]);
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

    expect(TestBed.inject(Router).url).toBe('/workspaces');
  });

  it('exchanges the callback code once and replaces the callback with workspace selection', async () => {
    vi.mocked(sessions.me).mockReturnValue(of({ name: 'Finn the Human' }));
    const exchange = vi.spyOn(sessions, 'exchange').mockReturnValue(of({}));
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    await RouterTestingHarness.create('/auth/callback?exchange_code=finn-code');
    await vi.waitFor(() => expect(router.url).toBe('/workspaces'));

    expect(exchange).toHaveBeenCalledExactlyOnceWith('finn-code');
    expect(sessions.profile()?.['name']).toBe('Finn the Human');
    expect(navigate).toHaveBeenCalledWith('/workspaces', { replaceUrl: true });
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
