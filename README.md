# Relay

## Stack

| Component | Technology | Location |
| --- | --- | --- |
| REST API | LoopBack 4 · TypeScript | [apps/api](apps/api) |
| Web client | Angular · TypeScript | [apps/web-client](apps/web-client) |
| Mobile client | Flutter · Dart | [apps/mobile-client](apps/mobile-client) |

## Getting started

### Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 24.21.0, pinned in [.node-version](.node-version) |
| pnpm | 10.30.1 |
| Flutter | 3.47.4 stable |

### Install dependencies

From the repository root run:

```sh
pnpm install --frozen-lockfile
pnpm install:mobile
```

### Run locally

Start each process you need in a separate terminal:

| Application | Command | Local endpoint |
| --- | --- | --- |
| API | `pnpm start:api` | http://localhost:3000 |
| Web client | `pnpm start:web` | http://localhost:4200 |
| Flutter web target | `pnpm start:mobile:web` | http://localhost:4300 |
| Flutter device target | `pnpm start:mobile` | Connected device or emulator |

## Repository layout

```text
apps/
├── api/            # Central REST API
├── web-client/     # Angular client
├── mobile-client/  # Flutter client
```