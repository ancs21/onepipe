# @onepipe/cli

Command-line interface for OnePipe development.

## Installation

```bash
bun add -g @onepipe/cli
```

Or use directly:
```bash
bunx @onepipe/cli dev --app ./src/server.ts
```

## Quick Start

```bash
# Start dev server with dashboard (single command!)
onepipe dev --app ./src/server.ts

# This starts:
# - Your app on http://localhost:3001
# - Dashboard on http://localhost:4000
```

## Commands

```bash
# Development (with dashboard)
onepipe dev --app ./src/server.ts

# Development (without dashboard)
onepipe dev --app ./src/server.ts --no-dashboard

# Custom ports
onepipe dev --app ./src/server.ts --app-port 3000 --dashboard-port 8080

# Show help
onepipe --help
```

## Dev Options

| Option | Default | Description |
|--------|---------|-------------|
| `-a, --app` | `./src/index.ts` | App entry file |
| `--app-port` | `3001` | App server port |
| `--dashboard-port` | `4000` | Dashboard port |
| `--no-dashboard` | - | Disable dashboard |

## License

MIT
