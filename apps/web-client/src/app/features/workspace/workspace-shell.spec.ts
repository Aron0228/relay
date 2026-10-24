import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { routes } from '../../app.routes';
import { WorkspaceShell } from './workspace-shell';
import { SessionService } from '../auth/session.service';

describe('Workspace routes', () => {
  let sessions: SessionService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WorkspaceShell],
      providers: [provideHttpClient(), provideRouter(routes)],
    });
    sessions = TestBed.inject(SessionService);
    vi.spyOn(sessions, 'me').mockReturnValue(of({ name: 'Finn the Human' }));
    vi.spyOn(sessions, 'logout').mockReturnValue(of({}));
  });

  it('supports deep links, sidebar navigation, collapse, and search', async () => {
    const harness = await RouterTestingHarness.create('/runs');
    const page = harness.routeNativeElement!;
    const router = TestBed.inject(Router);

    expect(page.querySelector('h1')?.textContent).toBe('Runs');
    expect(page.querySelector('[aria-current="page"]')?.getAttribute('aria-label')).toBe('Runs');

    (page.querySelector('[aria-label="Collapse sidebar"]') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(page.querySelector('.workspace')?.classList.contains('collapsed')).toBe(true);

    (page.querySelector('[aria-label="Workers"]') as HTMLAnchorElement).click();
    await vi.waitFor(() => expect(router.url).toBe('/workers'));
    harness.detectChanges();
    expect(page.querySelector('h1')?.textContent).toBe('Workers');

    (page.querySelector('[aria-label="Search navigation"]') as HTMLButtonElement).click();
    harness.detectChanges();
    const search = page.querySelector('input') as HTMLInputElement;
    search.value = 'worker';
    search.dispatchEvent(new Event('input'));
    harness.detectChanges();

    expect(page.querySelectorAll('.nav-item')).toHaveLength(1);
    expect(sessions.me).toHaveBeenCalledOnce();
  });

  it('signs out to login and prevents revisiting a protected route', async () => {
    const harness = await RouterTestingHarness.create('/overview');
    const page = harness.routeNativeElement!;

    (page.querySelector('.account-button') as HTMLButtonElement).click();
    harness.detectChanges();
    (page.querySelector('.account-menu button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(TestBed.inject(Router).url).toBe('/auth/login'));
    await harness.navigateByUrl('/runs');

    expect(sessions.logout).toHaveBeenCalledOnce();
    expect(sessions.profile()).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/auth/login');
  });

  it('keeps the workspace visible when sign-out fails', async () => {
    vi.mocked(sessions.logout).mockReturnValue(throwError(() => new Error('Offline')));
    const harness = await RouterTestingHarness.create('/overview');
    const page = harness.routeNativeElement!;

    (page.querySelector('.account-button') as HTMLButtonElement).click();
    harness.detectChanges();
    (page.querySelector('.account-menu button') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(page.querySelector('[role="alert"]')?.textContent).toContain('Could not sign out');
    });

    expect(TestBed.inject(Router).url).toBe('/overview');
    expect(sessions.profile()).not.toBeNull();
  });
});
