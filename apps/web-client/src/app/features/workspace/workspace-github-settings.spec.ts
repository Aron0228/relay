import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WorkspaceService } from './workspace.service';
import { WorkspaceGithubSettings } from './components/workspace-github-settings';

it('selects a reachable repository and submits only its approved environment mapping', async () => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  TestBed.inject(WorkspaceService).active.set({
    id: 'candy',
    name: 'Candy Kingdom',
    role: 'admin',
  });
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(WorkspaceGithubSettings);
  const connection = {
    installations: [{ id: 'installation', githubId: 12345, accountLogin: 'Finn' }],
    repositories: [
      {
        id: 'repository',
        githubId: 54321,
        installationId: 'installation',
        fullName: 'ooo/candy-shop',
        defaultEnvironmentId: 'shop',
      },
    ],
  };
  fixture.detectChanges();
  http.expectOne('/api/workspaces/candy/github').flush(connection);
  http
    .expectOne('/api/workspaces/candy/environments')
    .flush([{ id: 'shop', name: 'Candy Shop', baseUrl: 'https://academybugs.com/' }]);
  await Promise.resolve();
  await Promise.resolve();
  await fixture.whenStable();
  fixture.detectChanges();
  const page = fixture.nativeElement as HTMLElement;
  const button = (name: string) =>
    Array.from(page.querySelectorAll<HTMLButtonElement>('button')).find(
      (item) => item.textContent?.trim() === name,
    )!;
  const replace = vi.fn();
  const popup = { opener: undefined, location: { replace }, close: vi.fn() };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

  try {
    button('Install GitHub App').click();
    http
      .expectOne('/api/workspaces/candy/github/installation-url')
      .flush({ url: 'https://github.com/apps/relay-bmo/installations/new' });
    await Promise.resolve();
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(replace).toHaveBeenCalledWith('https://github.com/apps/relay-bmo/installations/new');
    expect(popup.opener).toBeNull();
    button('Manage on GitHub').click();
    http
      .expectOne('/api/workspaces/candy/github/installations/installation/settings-url')
      .flush({ url: 'https://github.com/settings/installations/12345' });
    await Promise.resolve();
    await Promise.resolve();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(replace).toHaveBeenCalledWith('https://github.com/settings/installations/12345');
  } finally {
    open.mockRestore();
  }

  button('Edit').click();
  fixture.detectChanges();
  http
    .expectOne('/api/workspaces/candy/github/installations/installation/repositories')
    .flush([{ githubId: 54321, fullName: 'ooo/candy-shop' }]);
  await Promise.resolve();
  await Promise.resolve();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(page.querySelector('app-workspace-side-panel')!.textContent).toContain(
    'Approved environment',
  );
  expect(page.querySelector('app-workspace-side-panel')!.textContent).not.toContain('Cancel');
  button('Save repository').click();
  const save = http.expectOne('/api/workspaces/candy/github/repositories');
  expect(save.request.body).toEqual({
    installationId: 'installation',
    githubId: 54321,
    environmentId: 'shop',
  });
  save.flush({ id: 'repository' });
  await Promise.resolve();
  await Promise.resolve();
  http.expectOne('/api/workspaces/candy/github').flush(connection);
  http
    .expectOne('/api/workspaces/candy/environments')
    .flush([{ id: 'shop', name: 'Candy Shop', baseUrl: 'https://academybugs.com/' }]);
  await Promise.resolve();
  await Promise.resolve();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(page.querySelector('app-workspace-side-panel')).toBeNull();
  http.verify();
  fixture.destroy();
});
