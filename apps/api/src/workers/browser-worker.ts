import {BrowserAgent} from '../ai/browser-agent';
import {OpenAiCompatibleProvider} from '../ai/openai-compatible.provider';
import {mkdir} from 'node:fs/promises';
import {PlaywrightInterface} from './playwright.interface';
import {
  WorkerCommand,
  WorkerInput,
  WorkerMessage,
  WorkerResult,
  WORKER_SCRIPT,
} from './protocol';
import {exampleTodo} from './scripts/example-todo';

let browser: PlaywrightInterface | undefined;
let cancelled = false;
let started = false;
const cancellation = new AbortController();

function emit(message: WorkerMessage): void {
  if (process.connected) {
    process.send?.(message);
  }
}

async function cancel(): Promise<void> {
  cancelled = true;
  cancellation.abort();

  await browser?.cancel();
}

async function execute(input: WorkerInput): Promise<void> {
  const result: WorkerResult = {status: 'completed'};

  try {
    await mkdir(input.videoDirectory, {recursive: true});
    browser = new PlaywrightInterface(input, emit);
    await browser.start();

    if (cancelled) {
      throw new Error('Run cancelled');
    }

    if (input.scriptName === WORKER_SCRIPT.Agent) {
      if (!input.agentInput) {
        throw new Error('Agent input is required');
      }

      const agent = new BrowserAgent(
        new OpenAiCompatibleProvider(),
        browser,
        (event, payload) => emit({type: 'event', event, payload}),
      );

      result.agentResult = await agent.run(
        input.agentInput,
        cancellation.signal,
      );

      if (
        ['provider_error', 'timeout'].includes(result.agentResult.stopReason)
      ) {
        result.status = 'failed';
        result.error = result.agentResult.summary;
      }
    } else if (input.scriptName === WORKER_SCRIPT.ExampleTodo) {
      await exampleTodo(browser, input.exampleUrl);
    } else {
      throw new Error('Unknown worker script');
    }
  } catch (error) {
    result.status = cancelled ? 'cancelled' : 'failed';
    result.error = cancelled ? undefined : (error as Error).message;
  } finally {
    try {
      result.videoFile = await browser?.close();
    } catch (error) {
      result.status = cancelled ? 'cancelled' : 'failed';
      result.error = (error as Error).message;
    }
  }

  if (cancelled) {
    result.status = 'cancelled';
  }

  if (process.connected) {
    await new Promise<void>((resolve, reject) => {
      process.send?.({type: 'result', result} satisfies WorkerMessage, error =>
        error ? reject(error) : resolve(),
      );
    });
  }

  process.exit(0);
}

process.on('message', (command: WorkerCommand) => {
  if (command.type === 'cancel') {
    cancel().catch(() => {});
  } else if (!started) {
    started = true;
    execute(command.input).catch(error => {
      console.error(error);
      process.exit(1);
    });
  }
});

process.on('SIGTERM', () => {
  cancel().catch(() => {});
});
process.on('SIGINT', () => {
  cancel().catch(() => {});
});
process.on('disconnect', () => {
  cancel().then(
    () => {
      if (!started) {
        process.exit(1);
      }
    },
    () => process.exit(1),
  );
});
