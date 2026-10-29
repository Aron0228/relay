import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WorkspaceService } from './workspace.service';
import { WorkspaceList } from './workspace-list';
import { WorkspaceManager } from './components/workspace-manager';
import { SessionService } from '../auth/session.service';

const candy = { id: 'candy', name: 'Candy Kingdom', role: 'admin' as const };
const tree = { id: 'tree', name: 'Tree Fort', role: 'member' as const };

beforeEach(() => {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
});

afterEach(() => TestBed.inject(HttpTestingController).verify());

it('restores an explicit workspace and keeps creation authenticated', async () => {
  const service = TestBed.inject(WorkspaceService);
  const http = TestBed.inject(HttpTestingController);
  localStorage.setItem('relay.workspace.current', 'tree');
  const loading = service.refresh();
  const request = http.expectOne('/api/workspaces');
  expect(request.request.withCredentials).toBe(true);
  request.flush([candy, tree]);
  await loading;
  expect(service.active()).toEqual(tree);
  expect(service.admin()).toBe(false);
});

it('does not fall back to a different workspace when a deep link is inaccessible', async () => {
  const service = TestBed.inject(WorkspaceService);
  localStorage.setItem('relay.workspace.current', 'ice-king');
  const loading = service.refresh();
  TestBed.inject(HttpTestingController).expectOne('/api/workspaces').flush([candy]);
  await loading;
  expect(service.active()).toBeNull();
  expect(service.ready()).toBe(true);
});

it('accepts a pending invitation and refreshes workspace membership', async () => {
  const service = TestBed.inject(WorkspaceService);
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(WorkspaceList);
  fixture.detectChanges();
  http.expectOne('/api/workspaces').flush([]);
  await Promise.resolve();
  await Promise.resolve();
  http
    .expectOne('/api/workspace-invitations')
    .flush([{ id: 'jake-invite', email: 'jake@ooo.example', workspaceName: 'Candy Kingdom' }]);
  await fixture.whenStable();
  fixture.detectChanges();
  const accept = [
    ...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>),
  ].find((button) => button.textContent?.trim() === 'Join workspace')!;
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(accept.disabled).toBe(false);
  });
  accept.click();
  http.expectOne('/api/workspace-invitations/jake-invite/response').flush(null);
  await Promise.resolve();
  await Promise.resolve();
  http.expectOne('/api/workspaces').flush([tree]);
  await Promise.resolve();
  await Promise.resolve();
  http.expectOne('/api/workspace-invitations').flush([]);
  await fixture.whenStable();
  expect(service.items()).toEqual([tree]);
  fixture.destroy();
});

it('hides admin controls for members', async () => {
  const service = TestBed.inject(WorkspaceService);
  service.active.set(tree);
  TestBed.inject(SessionService).profile.set({ id: 'jake' });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(WorkspaceManager);
  fixture.componentRef.setInput('settings', true);
  fixture.detectChanges();
  http
    .expectOne('/api/workspaces/tree/members')
    .flush([{ userId: 'jake', username: 'Jake', role: 'member' }]);
  await Promise.resolve();
  await Promise.resolve();
  http.expectOne('/api/workspaces/tree/environments').flush([]);
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Jake');
  expect(fixture.nativeElement.textContent).not.toContain('Invite member');
  expect(fixture.nativeElement.textContent).not.toContain('Save environment');
  expect(fixture.nativeElement.textContent).toContain('Leave workspace');
  fixture.destroy();
});
