# relay

This application is generated using [LoopBack 4 CLI](https://loopback.io/doc/en/lb4/Command-line-interface.html) with the
[initial project layout](https://loopback.io/doc/en/lb4/Loopback-application-layout.html).

## Install dependencies

By default, dependencies were installed when this application was generated.
Whenever dependencies in `package.json` are changed, run the following command:

```sh
npm install
```

To only install resolved dependencies in `package-lock.json`:

```sh
npm ci
```

## Run the application

```sh
npm start
```

You can also run `node .` to skip the build step.

Open http://127.0.0.1:3000 in your browser.

## Rebuild the project

To incrementally build the project:

```sh
npm run build
```

To force a full build by cleaning up cached artifacts:

```sh
npm run rebuild
```


## Other useful commands

- `npm run migrate`: Migrate database schemas for models
- `npm run openapi-spec`: Generate OpenAPI spec into a file

## Tests

```sh
npm test
```

## What's next

Please check out [LoopBack 4 documentation](https://loopback.io/doc/en/lb4/) to
understand how you can continue to add features to this application.

[![LoopBack](https://github.com/loopbackio/loopback-next/raw/master/docs/site/imgs/branding/Powered-by-LoopBack-Badge-(blue)-@2x.png)](http://loopback.io/)

## AI browser testing

The backend uses tool calling through an OpenAI-compatible Chat Completions endpoint.
Ollama is the default provider. Install a tool-capable model with `ollama pull qwen3:8b`
and start Ollama. An already installed compatible model can be selected with `AI_MODEL`.
For another provider, configure `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY` in `.env`.
The base URL includes `/v1`; the service appends `/chat/completions`.

Apply migrations from `apps/api` with `pnpm exec db-migrate up -e dev`, with
`POSTGRES_URL` exported in your shell. PostgreSQL, Redis, and Playwright Chromium
must be available (`pnpm worker:install` from the repository root).

From the repository root:

```sh
pnpm agent:example --prompt "Check whether a product can be added to the cart on https://academybugs.com/"
```

The demo prints the live stream and recording URLs, public summaries, tool events,
and the final structured result. It keeps the media server running until Ctrl+C;
add `--exit` to stop it when testing finishes. Use `--url` to change the target and
add that target's origin to the comma-separated `AI_ALLOWED_ORIGINS` setting.

Authenticated API endpoints:

- `POST /api/runs/agent`: `{ "prompt": "Test goal", "targetUrl": "https://academybugs.com/" }`; the target defaults to AcademyBugs.
- `GET /api/runs/{id}/activity`: server-sent events, with an optional `after` sequence cursor for replay.
- `GET /api/runs/{id}/result`: persisted result, or `null` while no result is available.
- Existing run status, cancellation, live browser frames, and recording endpoints also apply.

The agent can inspect, navigate, click, fill, press keys, read text, and submit a
structured verdict. Turn, tool, context, observation, request, and execution limits
are configurable in `.env.sample`. Hitting a limit produces an inconclusive verdict.
Provider failures mark the run failed; cancellation aborts the provider request and
closes the browser. Browser actions are not retried as a new job.

The goal and target are stored on `execution.run`, activity in `execution.run_event`,
and the structured verdict, evidence, model, prompt version, and stop reason in
`execution.run_result`. The verdict is part of the result JSON for this starter;
separate verdict aggregation tables can be added when that functionality is introduced.
Navigation (including redirects) is restricted to approved origins. Subresources
can load from other origins; this restriction is not a network sandbox.
