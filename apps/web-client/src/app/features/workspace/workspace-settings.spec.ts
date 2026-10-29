import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WorkspaceService } from './workspace.service';
import { WorkspaceManager } from './components/workspace-manager';

it('groups settings into accessible tabs and preserves a draft when switching', async () => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  TestBed.inject(WorkspaceService).active.set({
    id: 'candy',
    name: 'Candy Kingdom',
    role: 'admin',
    isOwner: true,
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(WorkspaceManager);
  fixture.componentRef.setInput('settings', true);
  fixture.detectChanges();
  http
    .expectOne('/api/workspaces/candy/members')
    .flush([{ userId: 'finn', username: 'Finn', role: 'admin', isOwner: true }]);
  await Promise.resolve();
  await Promise.resolve();
  http.expectOne('/api/workspaces/candy/environments').flush([]);
  await Promise.resolve();
  await Promise.resolve();
  http.expectOne('/api/workspaces/candy/invitations').flush([]);
  await fixture.whenStable();
  fixture.detectChanges();
  const page = fixture.nativeElement as HTMLElement;
  const name = page.querySelector<HTMLInputElement>('input[name=name]')!;
  name.value = 'Candy Kingdom Revisited';
  name.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  const members = page.querySelector<HTMLButtonElement>('#workspace-settings-tab-members')!;
  members.click();
  fixture.detectChanges();
  expect(members.getAttribute('aria-selected')).toBe('true');
  expect(page.querySelector<HTMLElement>('#workspace-settings-general')!.hidden).toBe(true);
  expect(page.querySelector<HTMLElement>('#workspace-settings-members')!.hidden).toBe(false);
  expect(page.querySelector('#workspace-settings-members')!.textContent).toContain('Finn');
  members.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  fixture.detectChanges();
  expect(
    page.querySelector('#workspace-settings-tab-environments')!.getAttribute('aria-selected'),
  ).toBe('true');
  page
    .querySelector('#workspace-settings-tab-environments')!
    .dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  fixture.detectChanges();
  expect(page.querySelector<HTMLElement>('#workspace-settings-general')!.hidden).toBe(false);
  expect(name.value).toBe('Candy Kingdom Revisited');
  expect(page.querySelector('#workspace-settings-members')!.textContent).toContain('Owner');
  expect(page.textContent).not.toContain('Leave workspace');
  expect(page.querySelector('#workspace-settings-members')!.textContent).not.toContain(
    'Make member',
  );

  const environments = page.querySelector<HTMLButtonElement>(
    '#workspace-settings-tab-environments',
  )!;
  environments.click();
  fixture.detectChanges();
  expect(page.querySelector('input[name=baseUrl]')).toBeNull();
  const create = Array.from(page.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === 'New environment',
  )!;
  create.click();
  fixture.detectChanges();
  expect(page.querySelector('app-workspace-side-panel input[name=baseUrl]')).not.toBeNull();
  expect(page.querySelector('app-workspace-side-panel')!.textContent).not.toContain('Cancel');
  page.querySelector<HTMLButtonElement>('[aria-label="Close panel"]')!.click();
  fixture.detectChanges();
  expect(page.querySelector('app-workspace-side-panel')).toBeNull();
  members.click();
  fixture.detectChanges();
  Array.from(page.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.trim() === 'Invite member')!
    .click();
  fixture.detectChanges();
  expect(page.querySelector('app-workspace-side-panel label')!.textContent).toContain('E-mail');
  expect(page.querySelector('app-workspace-side-panel [title]')!.getAttribute('title')).toContain(
    'verified on your GitHub account',
  );
  expect(page.querySelector('app-workspace-side-panel')!.textContent).not.toContain('Cancel');
  http.verify();
  fixture.destroy();
});
