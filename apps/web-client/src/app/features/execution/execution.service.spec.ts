import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ExecutionService } from './execution.service';

class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  onopen?: () => void;
  onerror?: () => void;
  close = vi.fn();

  constructor(
    readonly url: string,
    readonly options: EventSourceInit,
  ) {
    super();
    FakeEventSource.instances.push(this);
  }
}

describe('Activity streaming', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reconnects from the last persisted event and releases the connection on navigation', async () => {
    const receive = vi.fn();
    const stop = TestBed.inject(ExecutionService).watch('bmo', 0, receive, vi.fn());
    const first = FakeEventSource.instances[0];
    first.dispatchEvent(
      new MessageEvent('agent.activity', {
        data: JSON.stringify({
          id: 'finn',
          sequence: 8,
          type: 'agent.activity',
          payload: { text: 'Cart found' },
        }),
      }),
    );
    first.onerror?.();
    await vi.advanceTimersByTimeAsync(2000);

    expect(receive).toHaveBeenCalledOnce();
    expect(first.options.withCredentials).toBe(true);
    expect(FakeEventSource.instances[1].url).toContain('after=8');
    stop();
    await vi.advanceTimersByTimeAsync(4000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].close).toHaveBeenCalled();
  });

  it('does not reconnect a completed activity stream', async () => {
    TestBed.inject(ExecutionService).watch('bmo', 0, vi.fn(), vi.fn());
    const source = FakeEventSource.instances[0];
    source.dispatchEvent(
      new MessageEvent('run.completed', {
        data: JSON.stringify({ id: 'done', sequence: 9, type: 'run.completed', payload: {} }),
      }),
    );
    source.onerror?.();
    await vi.advanceTimersByTimeAsync(4000);

    expect(source.close).toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
