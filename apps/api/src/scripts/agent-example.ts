import {parseArgs} from 'node:util';
import {RelayApplication} from '../application';
import {isRunFinished, Run} from '../models';
import {RunRepository} from '../repositories';
import {WorkerService, WORKER_SERVICE_BINDING_KEY} from '../services';
import {WORKER_SCRIPT} from '../workers/protocol';

async function main(): Promise<void> {
  const {values} = parseArgs({
    options: {
      prompt: {type: 'string'},
      url: {type: 'string', default: 'https://academybugs.com/'},
      exit: {type: 'boolean', default: false},
    },
  });

  if (!values.prompt) {
    throw new Error(
      'Usage: pnpm agent:example --prompt "Your test goal" [--url URL] [--exit]',
    );
  }

  const port = Number(process.env.WORKER_DEMO_PORT ?? 3001);
  const app = new RelayApplication({
    rest: {host: '127.0.0.1', port, gracePeriodForClose: 1000},
  });

  await app.boot();
  await app.start();

  const workers = await app.get<WorkerService>(WORKER_SERVICE_BINDING_KEY);
  const runs = await app.get<RunRepository>('repositories.RunRepository');
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = () => {
    shuttingDown = true;
    shutdownPromise ??= workers.stop().then(() => app.stop());

    return shutdownPromise;
  };

  process.once('SIGINT', () => {
    shutdown().catch(console.error);
  });
  process.once('SIGTERM', () => {
    shutdown().catch(console.error);
  });

  try {
    const {run, viewToken} = await workers.create(
      WORKER_SCRIPT.Agent,
      undefined,
      {prompt: values.prompt, targetUrl: values.url!},
    );
    const baseUrl = app.restServer.url;

    console.log(`Run: ${run.id}`);
    console.log(
      `Live stream: ${baseUrl}/api/runs/${run.id}/stream?token=${viewToken}`,
    );
    console.log(
      `Recording: ${baseUrl}/api/runs/${run.id}/video?token=${viewToken}`,
    );

    let current: Run = run;
    let sequence = 0;

    while (!shuttingDown && !isRunFinished(current.status)) {
      await new Promise(resolve => setTimeout(resolve, 500));
      current = await runs.findById(run.id);

      for (const event of await workers.listEvents(run.id, sequence)) {
        sequence = event.sequence;
        console.log(event.type, JSON.stringify(event.payload));
      }
    }

    if (shuttingDown) {
      await shutdown();

      return;
    }

    console.log(
      `Run ${current.status}${current.error ? `: ${current.error}` : ''}`,
    );
    console.log(
      `Recording file: ${current.videoFile ? workers.videoPath(run.id) : 'unavailable'}`,
    );

    if (current.status === 'failed') {
      process.exitCode = 1;
    }

    console.log(
      'Result:',
      JSON.stringify((await workers.getResult(run.id))?.result, null, 2),
    );

    if (values.exit) {
      await shutdown();
    }
  } catch (error) {
    await shutdown();
    throw error;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
