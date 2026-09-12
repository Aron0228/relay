# Relay

## Stack

| Component | Technology | Location |
| --- | --- | --- |
| REST API | LoopBack 4 · TypeScript | [apps/api](apps/api) |
| Web client | Angular · TypeScript | [apps/web-client](apps/web-client) |
| Mobile client | Flutter · Dart | [apps/mobile-client](apps/mobile-client) |
| Orchestrator | Temporal · Python | [apps/orchestrator](apps/orchestrator) |

pnpm manages the workspace and JavaScript dependencies. Flutter uses pub, and
Python uses uv. Each application project is named `relay`; root commands target
apps by directory.

## Getting started

### Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 24.21.0, pinned in [.node-version](.node-version) |
| pnpm | 10.30.1 |
| Flutter | 3.47.4 stable |
| Python | 3.10+ |
| uv | 0.12.13 |
| Temporal CLI | Required to run the orchestrator locally |

Make sure `node`, `pnpm`, `flutter`, `dart`, `uv`, and `temporal` are available
on your `PATH`. Native mobile development also requires the corresponding SDK
and a device or emulator; iOS development requires macOS and Xcode.

### Install dependencies

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm setup:mobile
pnpm setup:orchestrator
```

### Run locally

Start each process you need in a separate terminal:

| Application | Command | Local endpoint |
| --- | --- | --- |
| API | `pnpm start:api` | http://localhost:3000 |
| API explorer | Start the API | http://localhost:3000/explorer |
| Web client | `pnpm start:web` | http://localhost:4200 |
| Flutter web target | `pnpm start:mobile:web` | http://localhost:4300 |
| Flutter device target | `pnpm start:mobile` | Connected device or emulator |
| Temporal server | `pnpm start:temporal` | localhost:7233 |
| Orchestrator | `pnpm start:orchestrator` | Temporal worker |

Start the Temporal server before the orchestrator. The current orchestrator
runs the official Temporal [Hello Activity sample](apps/orchestrator/hello_activity.py),
prints `Result: Hello, World!`, and exits after completing its workflow.

The Flutter web target lets you run the client without a mobile emulator.

## Development

### Quality checks

| App | Lint | Tests | Formatting |
| --- | --- | --- | --- |
| API | `pnpm lint:api` | `pnpm test:api` | Included in lint |
| Web | `pnpm lint:web` | `pnpm test:web` | — |
| Mobile | `pnpm lint:mobile` | `pnpm test:mobile` | `pnpm --dir apps/mobile-client format:check` |
| Orchestrator | `pnpm lint:orchestrator` | `pnpm test:orchestrator` | `pnpm --dir apps/orchestrator format:check` |

Web tests run without watch mode. Orchestrator tests use Temporal's activity
testing environment and do not require a running server.

### Builds

```sh
pnpm build:api
pnpm build:web
pnpm build:mobile  # Android APK; requires the Android SDK
```

### Continuous integration

[GitHub Actions CI](.github/workflows/ci.yml) runs on pushes, pull requests, and
manual triggers, with independent jobs for each app:

- **API:** ESLint, Prettier, acceptance tests, and TypeScript build.
- **Web:** Angular ESLint, unit tests, and production build.
- **Mobile:** Flutter analysis, Dart formatting, and widget tests.
- **Orchestrator:** Ruff lint, formatting, and activity tests.

CI enforces dependency lockfiles, caches dependencies, and cancels superseded
runs.

## Repository layout

```text
apps/
├── api/            # Central REST API
├── web-client/     # Angular client
├── mobile-client/  # Flutter client
└── orchestrator/   # Temporal workflows and activities
.github/workflows/  # Continuous integration
pnpm-workspace.yaml # Workspace configuration
```

The Temporal starter sample retains its original
[MIT license](apps/orchestrator/TEMPORAL_SAMPLE_LICENSE).
