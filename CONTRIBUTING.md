# Contributing to Opal

Thanks for your interest in improving Opal! Bug reports, ideas, documentation and code are all welcome.

## Getting started

```bash
git clone https://github.com/enprevo/opal.git
cd opal
npm install
npm run dev
```

Requirements: Node.js 22 or newer. Opal runs on Windows, macOS and Linux.

## Before you open a pull request

```bash
npm run typecheck   # TypeScript, strict mode
npm test            # unit tests (Vitest)
npm run test:e2e    # builds the app and runs the end-to-end tests (Playwright + Electron)
```

On Linux without a display, run the end-to-end tests with `xvfb-run -a npm run test:e2e`.

Please:

- keep pull requests focused (one feature or fix per PR)
- add or update tests for behaviour you change — file operations must have unit tests
- keep the UI keyboard-accessible and add `data-help-title` / `data-help-desc` to new buttons so the helper cards can explain them
- follow the existing code style (2 spaces, no semicolons, single quotes); an `.editorconfig` is included

## Project layout

| Folder | What lives there |
| --- | --- |
| `src/shared` | Pure TypeScript shared by main and renderer: wildcards, rename engine, command parser, sorting and grouping, paths |
| `src/main` | Electron main process: file system service, settings, IPC, semantic search (`src/main/semantic`) |
| `src/preload` | The typed, context-isolated bridge exposed as `window.opal` |
| `src/renderer` | React UI: `state/` (store, actions, commands and hotkeys) and `components/` |
| `tests/unit` | Vitest unit tests (including real file-system tests in temp folders) |
| `tests/e2e` | Playwright tests that drive the built Electron app |

All file-system access happens in the main process; the renderer only talks to it through the preload bridge.

## Reporting bugs

Use the issue templates. Include your OS, Opal version and the steps to reproduce. For anything that could lose data,
please mark the issue as **data safety** — those are fixed first.

## Security

Please do not open public issues for security problems; see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
