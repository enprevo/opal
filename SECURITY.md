# Security Policy

## Supported versions

Security fixes are released for the latest version of Opal.

## Reporting a vulnerability

Please **do not** open a public issue. Instead use
[GitHub private vulnerability reporting](https://github.com/enprevo/opal/security/advisories/new)
for this repository. Include a description, the affected version and OS, and steps to reproduce.

You can expect an acknowledgement within a few days. Once a fix is available, the advisory will be published with
credit to the reporter (unless you prefer to remain anonymous).

## Design notes

- The renderer runs with `contextIsolation` and without Node integration; all file-system access goes through a
  typed preload bridge to the main process.
- The UI is served from local files with a restrictive Content-Security-Policy (no remote scripts).
- Rendered Markdown in Quick Look is sanitised (scripts, event handlers and `javascript:` URLs are removed).
- Semantic search runs a local model; document contents never leave the computer. The only network access is the
  one-time download of the model from Hugging Face.
