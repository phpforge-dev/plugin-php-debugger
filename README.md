# PHP Debugger / Xdebug plugin

Standalone plugin for PHP IDE 0.2.11+. The IDE does not compile this tool into its application binary. Install from the Marketplace or `https://github.com/phpforge-dev/plugin-php-debugger` using **Plugins → Install from Git**. Review and grant the permissions before activation.

## Package

- `main.js`: sandboxed language contributions (where applicable).
- `workbench.js` / `workbench.css`: separately consented workbench integration.
- `native/`: Rust service source; JSON-lines protocol version 1 over stdio.
- `bin/<architecture>-<os>/`: prebuilt service with SHA-256 recorded in `plugin.json`.

Installation never runs npm, Cargo or project build scripts. The host checks platform/checksum, starts the installed executable on demand, and owns its lifetime. Disabling/removing the plugin closes its UI, listeners and native process. PHP editing remains usable without it.

## Trust and permissions

`native.tool` executes native code with your account privileges; it is not an OS sandbox. `workbench` runs UI code in the IDE window with access to displayed data. These capabilities are separate from ordinary isolated language plugins. Install only trusted packages. `project.read` permits reading project files. The default installation must not automatically grant native/UI permissions.

No passwords or private credentials belong in this repository, fixtures or logs. Do not send runtime values or tool output to an agent automatically.

## Features

Behaviour follows the public PhpStorm help and an authorized observation of PhpStorm 2026.1.4 (see
`docs/research/xdebug-fidelity.md` in php-ide). No JetBrains code or assets are used.

- Breakpoints in place of the line number: click toggles, Alt+click enables/disables, Shift+click adds a logging
  (non-suspending) breakpoint, right-click opens the properties popup or the Add Breakpoint menu, Cmd+F8 at the caret.
  Icons for line, conditional, disabled, logging, verified (accepted by Xdebug), invalid and muted.
- View Breakpoints (Shift+Cmd+F8): PHP line and PHP exception breakpoints, enable/condition/log/remove-once options.
- Debug window: session tabs, Stop/Resume/Pause/Step toolbar, Threads & Variables (frames, `{type} value` tree,
  watches, evaluate field with Enter / Shift+Cmd+Enter), Console, Mute Breakpoints, settings and path mappings.
- Evaluate Expression (Alt+F8) window and inline values next to the code of the current function.
- Pause Program sends DBGp `break` only when the engine reports `supports_async`; Xdebug 3.4 reports 0, so the button
  stays disabled with an explanation (PhpStorm offers no Pause for Xdebug either).

## Development

Use Node only to build browser assets and Rust to build the tool. There is no Node application backend.

```sh
npm ci --ignore-scripts
npm run build
npm test                     # Rust service + UI rules (node:test)
cargo build --release --manifest-path native/Cargo.toml
node scripts/record-binary.mjs
```

The workflow tests and publishes prebuilt macOS arm64, Windows x64 and Linux x64 executables. A build succeeding is not a claim of full native UI validation on that OS. Unsupported platforms show a setup error; there is no fallback to a hidden built-in service.

## Validation scope

Native unit tests are migrated from the independent PHP IDE implementation. Use only disposable fixture projects/containers. Integration with the IDE must be checked through real Tauri IPC, including consent, disable/remove, stale events and provider absence. No PhpStorm compatibility is claimed.

License: MIT. Originally extracted from phpforge-dev/php-ide; see LICENSE.
