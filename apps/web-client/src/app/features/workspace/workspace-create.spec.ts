import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { WorkspaceCreate } from './workspace-create';

it('retries a failed avatar upload without creating another workspace', async () => {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const http = TestBed.inject(HttpTestingController);
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bmo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const fixture = TestBed.createComponent(WorkspaceCreate);
  fixture.detectChanges();
  await fixture.whenStable();
  const name = fixture.nativeElement.querySelector('input[name=name]') as HTMLInputElement;
  name.value = 'Candy Kingdom';
  name.dispatchEvent(new Event('input'));
  const image = fixture.nativeElement.querySelector('input[type=file]') as HTMLInputElement;
  const file = new File(['bmo image'], 'bmo.png', { type: 'image/png' });
  Object.defineProperty(image, 'files', { value: [file] });
  image.dispatchEvent(new Event('change'));
  fixture.detectChanges();
  fixture.nativeElement
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const create = http.expectOne('/api/workspaces');
  expect(create.request.body).toEqual({ name: 'Candy Kingdom' });
  create.flush({ id: 'candy', name: 'Candy Kingdom', role: 'admin' });
  await Promise.resolve();
  await Promise.resolve();
  http
    .expectOne('/api/workspaces/candy/avatar')
    .flush({}, { status: 422, statusText: 'Bad image' });
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain(
    'Workspace created, but the image could not be uploaded',
  );
  fixture.nativeElement
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const upload = http.expectOne('/api/workspaces/candy/avatar');
  expect(upload.request.body).toBe(file);
  expect(upload.request.withCredentials).toBe(true);
  upload.flush({ avatarUrl: '/api/workspaces/candy/avatar/bmo.webp' });
  await Promise.resolve();
  await Promise.resolve();
  http.expectOne('/api/workspaces').flush([{ id: 'candy', name: 'Candy Kingdom', role: 'admin' }]);
  await fixture.whenStable();
  expect(navigate).toHaveBeenCalledWith('/overview');
  expect(localStorage.getItem('relay.workspace.current')).toBe('candy');
  http.verify();
  fixture.destroy();
});
