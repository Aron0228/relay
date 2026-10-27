import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { RunDetail } from './run-detail';
import { ExecutionService } from './execution.service';
import { Run } from './execution.models';

const run: Run = {
  id: 'bmo-run-123',
  title: 'Finn checks the shop',
  status: 'completed',
  cancelRequested: false,
  createdAt: '2026-10-18T09:00:00Z',
};

async function render(liveView: boolean) {
  const close = vi.fn();
  const api = {
    get: vi.fn().mockResolvedValue(run),
    result: vi.fn().mockResolvedValue({
      result: { verdict: 'failed', summary: 'The Candy Kingdom cart did not update.' },
    }),
    media: vi.fn().mockReturnValue('/recording'),
    watch: vi.fn().mockImplementation((_id, _after, receive) => {
      receive({
        id: 'observation',
        sequence: 1,
        type: 'agent.activity',
        payload: { kind: 'observation', text: 'The cart is visible.' },
        createdAt: run.createdAt,
      });
      receive({
        id: 'message',
        sequence: 2,
        type: 'agent.activity',
        payload: { kind: 'message', text: 'I am checking the cart.' },
        createdAt: run.createdAt,
      });

      receive({
        id: 'bmo-metrics',
        sequence: 3,
        type: 'agent.metrics',
        createdAt: run.createdAt,
        payload: {
          failedToolCalls: 2,
          tokenUsage: {
            inputTokens: 120,
            outputTokens: 30,
            totalTokens: 150,
            reportedRequests: 2,
            unreportedRequests: 1,
          },
        },
      });

      return close;
    }),
  };
  TestBed.configureTestingModule({
    imports: [RunDetail],
    providers: [
      provideRouter([]),
      { provide: ExecutionService, useValue: api },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { data: { liveView }, paramMap: convertToParamMap({ id: run.id }) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(RunDetail);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  if (!liveView)
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Verdict: failed');
    });

  return { fixture, close, page: fixture.nativeElement as HTMLElement };
}

describe('Run and worker detail', () => {
  it('shows persisted messages and observations without a verdict in worker mode', async () => {
    const { fixture, close, page } = await render(true);

    expect(page.textContent).toContain('Failed tool calls: 2');
    expect(page.textContent).toContain('Tokens used: 150 (partial)');
    expect(page.textContent).not.toContain('Back to workers');
    expect(page.textContent).toContain('The cart is visible.');
    expect(page.textContent).toContain('I am checking the cart.');
    expect(page.textContent).not.toContain('Verdict:');
    expect(page.textContent).toContain('View the completed run');
    fixture.destroy();
    expect(close).toHaveBeenCalled();
  });

  it('shows the saved verdict and reason for a completed run', async () => {
    const { fixture, page } = await render(false);

    expect(page.textContent).toContain('Failed tool calls: 2');
    expect(page.textContent).not.toContain('Back to runs');
    expect(page.textContent).toContain('Verdict: failed');
    expect(page.textContent).toContain('The Candy Kingdom cart did not update.');
    fixture.destroy();
  });
});
