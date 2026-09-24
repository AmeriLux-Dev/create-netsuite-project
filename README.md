# @amerilux/create-netsuite-project

Scaffold a Suitelet-hosted React application for NetSuite in one command.

```sh
npm create @amerilux/netsuite-project@latest MyApp
# or
npx @amerilux/create-netsuite-project MyApp
```

The generated project is a small monorepo: a Vite + React 19 + Tailwind 4 client served by a Suitelet, a webpack-built SuiteScript API where **every controller is its own script** (transport-agnostic endpoints served by a Restlet or a Suitelet, switchable in one file), decorated record models and per-controller script declarations so every NetSuite id is written once, the endpoint plumbing and a generated, typed browser client through [`@amerilux/netsuite-api`](https://www.npmjs.com/package/@amerilux/netsuite-api), typed data access through [`@amerilux/netsuite-repository`](https://www.npmjs.com/package/@amerilux/netsuite-repository), instrumented `N/*` calls through [`@amerilux/netsuite-wrapper`](https://www.npmjs.com/package/@amerilux/netsuite-wrapper), Vitest everywhere, ESLint, and deployment scripts around the SuiteCloud CLI.

## What you get

```
MyApp/
  netsuite.ts               app names and any id no controller or model owns; imported by both api/ and client/
  netsuite-api.config.json  where the generator reads the controllers and writes the generated files (the defaults)
  api/src/controllers/      one file per controller: shapes, endpoints and the Restlet or Suitelet entry point declaring the script's ids (userController.ts and userRolesController.ts to start)
  api/src/services/         decisions, one per domain: a record type with its lines and child records, or an outside party (<domain>Service.ts)
  api/src/repositories/     query and write functions over dbContext; generated/ comes from `npm run generate`
  api/src/specifications/   query predicates, one module per record type
  api/src/models/           decorated record models; each declares its record type and field ids
  api/src/lib/              plain helpers any layer may call; they import only other lib/ files (errors.ts to start)
  api/src/types/            models.gen.ts (generated entity types)
  api/src/scripts.gen.ts    generated from the controllers: every script by name, for createSuiteletClient
  api/src/_host/            boilerplate: the Suitelet that serves the SPA; nothing is added there
  client/src/               React app: TanStack Router (file-based routes under src/routes, hash history), TanStack Query, Tailwind
  client/src/api/           generated from the controllers by `npm run generate`: one module per controller (its request and response types, the entity types it names, its endpoint type and, for a controller the browser calls, its client), re-exported by index.gen.ts under the controller's name
  client/server.ts          local dev proxy that signs OAuth 2.0 calls to your sandbox
  netsuite/                 SDF project: manifest, deploy.xml, Objects/, FileCabinet/ (build output)
  scripts/deploy.mjs        build → suitecloud project:deploy (or file:upload only)
  scripts/checkStructure.mjs run by npm run lint: every script's pieces (declaration, exports, SDF object) agree
  .vscode/                  VS Code snippets (nsp…) for every layer: controller, endpoint, service, repository, specifications, model, hook, SDF object
  .claude/                  Claude Code settings, per-folder rules, a skill for converting an existing project, and hooks: a check of every file the agent writes, and guardrails (Probity with --probity)
  README.md                 the application record: purpose, owners, dependencies, deployment, support, decisions
  how-to-use/               the folder structure, the naming, and worked examples of a repository, a controller and a job
  CLAUDE.md                 project brief for Claude Code
  probity.config.ts         agent guardrails (Probity), wired up in .claude/settings.json; only with --probity
```

Build output lands in `netsuite/FileCabinet/SuiteScripts/MyApp/`: `client/app.js` plus one AMD file per script under `api/`. Each API file starts with the `@NApiVersion` / `@NScriptType` banner NetSuite expects.

## Prompts and flags

Every prompt has a flag, so the command works unattended:

| Prompt | Flag | Default |
|---|---|---|
| Project name | `[directory]` or `--name` | required |
| Script id prefix | `--prefix` | derived from the name, max 8 characters |
| Author or team | `--author` | `git config user.name` |
| Description | `--description` | a one-liner |
| PerformanceTracker telemetry | `--performance-tracker` / `--no-performance-tracker` | off |
| Probity guardrails for AI agents | `--probity` / `--no-probity` | off |
| Controllers on `@amerilux/netsuite-api` | `--netsuite-api` / `--no-netsuite-api` | yes |
| Data access on `@amerilux/netsuite-repository` | `--netsuite-repository` / `--no-netsuite-repository` | yes |
| Map/Reduce jobs | `--jobs` / `--no-jobs` | off |
| Install dependencies | `--install` / `--no-install` | yes |
| Initialise git | `--git` / `--no-git` | yes |

`--no-netsuite-api` and `--no-netsuite-repository` leave a package out along with everything built on it: the project keeps the folders (`api/src/controllers`, `client/src/hooks`, `api/src/repositories` and the rest) and the host page, and the code that goes in them is the developer's. The `user`/`userRoles` example needs both packages, so it is only there when both are. The job setup is built on netsuite-api, so `--jobs` needs it.

`--jobs` runs the project's own `npm run add:jobs` after scaffolding, which adds the record a job run lives in, the script that clears old runs daily, and the endpoint and hook a page follows a run with. Answering no leaves them out; run `npm run add:jobs` in the project the day the first job is wanted, and it adds only what is missing.

`--yes` accepts every default. `--ref <gitref>`, `--repo <owner/repo>` and `--local-template <path>` control where the template comes from; by default the CLI downloads `react-app` from [netsuite-project-templates](https://github.com/AmeriLux-Dev/netsuite-project-templates) at the ref set in its own `package.json`, which is `main`, so every scaffold uses the current template. Pass `--ref <tag>` to freeze it.

Script ids are `customscript_<prefix>_<name>` and NetSuite caps them at 40 characters, so the prefix is 2 to 10 lowercase characters; the project's structure check keeps every later script id within the budget.

## Adding a controller

A controller is one deployed script with named endpoints (`orders` with `list`, `byId`, `create`): one controller file holding the request and response shapes, the endpoints and the script declaration, plus its SDF object; `npm run generate` writes the client module from it. The generated project writes one of each end to end in how-to-use/ (a model and its repository; a Restlet with its hooks and page; a Suitelet running as another role and one answering a file; a Map/Reduce job a page follows), ships VS Code snippets that emit each file in that shape, and its `npm run lint` runs a structure check that fails until every piece exists and they agree (ids, transport, endpoint names). The `user` and `userRoles` controllers are the reference.

## Deploying

The scaffold never deploys. With both packages on, the generated project starts with a `user` Restlet (its `roles` endpoint: the caller and every role assigned to them) and the `userRoles` Suitelet it calls, deployed to run as Administrator because a Restlet caller's role cannot read role assignments. When the account is set up:

```sh
npx suitecloud account:setup   # once per account; writes the gitignored project.json
npm run deploy:full            # build, project:adddependencies, project:deploy: the first time, and after an SDF object changes
npm run deploy                 # build, then upload only File Cabinet files
```

The client bundle URL carries the version and a build id, so a new deploy is picked up without a manual cache bust.

## Requirements

- Node 22 or newer
- Java 17 or newer, for the SuiteCloud CLI
- git (optional; used for the first commit and the default author)

## Repository layout

This repository holds only the CLI. The templates it renders live in [netsuite-project-templates](https://github.com/AmeriLux-Dev/netsuite-project-templates), one folder per project type.

```
src/                  the CLI: commands, prompts, template download and render, the controller generator
__tests__/            unit tests (vitest)
scripts/              private-reference scan and the end-to-end wrapper
.github/workflows/    CI (checks, scaffold with the template repository's main on Linux and Windows, secret scan) and release
```

`templateSource` in `package.json` names the template repository and the git ref the CLI downloads by default (`main`); `--repo` and `--ref` override it at run time.

### Developing

```sh
npm install
npm test                    # unit tests
npm run e2e                 # build, then run the template repository's end-to-end check against this build
node dist/index.js ./Sandbox --local-template ../netsuite-project-templates/react-app --prefix sbx --yes --no-install --no-git
```

`npm run e2e` expects a checkout of the template repository at `../netsuite-project-templates`; set `NETSUITE_PROJECT_TEMPLATES_DIR` to use another path. CI runs the same check against the template repository's `main`.

### Releasing

1. Template changes need no CLI release: the CLI scaffolds from the template repository's `main`. Release the CLI only when the CLI itself changed. A template change that needs a new CLI feature must wait for that CLI release, and the templates repository's CI (which scaffolds with the CLI's `main`) is the guard.
2. Bump `version` in `package.json`.
3. Tag `v<version>` and push the tag. The release workflow verifies the tag matches, checks that the template ref exists, runs the checks and publishes through the npm Trusted Publisher configured for this repository (no token secret; provenance is attached automatically).

CI runs the same pre-flight checks and a dry-run publish on every pull request, so most release problems surface before tagging. If the release workflow itself needs fixing after a tag exists, push the fix to `main` and run the Release workflow manually from the Actions tab with that tag: the manual run uses the workflow from `main` but publishes the tagged commit, so the tag never needs to move.

## Security

This repository is public. Nothing account-specific belongs here: no account ids, authentication ids, `project.json`, `.env` files, keys or certificates. CI runs gitleaks and `scripts/check-no-private-refs.mjs` on every push.

## License

[MIT](./LICENSE)
