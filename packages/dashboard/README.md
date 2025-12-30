# @onepipe/dashboard

Development dashboard for OnePipe applications.

## Features

- Real-time API request monitoring
- Flow event visualization
- Database inspection
- Signal state management
- Performance tracing

## Usage

The dashboard is automatically started when using `onepipe dev`:

```bash
onepipe dev --app ./src/server.ts
```

Or run standalone:

```bash
onepipe dashboard --port 4000
```

## Environment Variables

- `ONEPIPE_DASHBOARD_URL` - Dashboard API URL (default: `http://localhost:4001`)

## License

MIT
