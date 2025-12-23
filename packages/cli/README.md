# @onepipe/cli

Command-line interface for OnePipe development.

## Installation

```bash
bun add -g @onepipe/cli
```

Or use via npx:
```bash
bunx @onepipe/cli dev
```

## Commands

```bash
# Start development server with dashboard
onepipe dev --app ./src/server.ts

# Show version
onepipe --version

# Show help
onepipe --help
```

## Options

```
Usage: onepipe <command> [options]

Commands:
  dev         Start development server with dashboard
  dashboard   Start dashboard only (standalone)
  version     Show version

Options:
  -h, --help      Show help
  -p, --port      Dashboard port (default: 4000)
  -a, --app       App entry file (default: auto-detect)
  --app-port      App server port (default: 3001)
  --dev           Run with Vite hot-reload
```

## License

MIT
