# Auth Quick Start

Fullstack authentication example using:
- **Backend**: OnePipe SDK + better-auth (stateless, no database)
- **Frontend**: React + Tailwind + shadcn/ui

## Features

- Email/password authentication
- Stateless JWT sessions (no database required)
- Protected REST API routes with `REST.auth()`
- Public routes with `{ public: true }`
- Role-based access control

## Run

```bash
bun install
bun run dev
```

Open http://localhost:3000

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | Public | Health check |
| GET | `/api/me` | Protected | Get current user |
| GET | `/api/admin` | Protected | Admin only |
| POST | `/api/auth/sign-up/email` | Public | Register |
| POST | `/api/auth/sign-in/email` | Public | Login |
| POST | `/api/auth/sign-out` | Protected | Logout |
| GET | `/api/auth/get-session` | Protected | Get session |

## Test

```bash
# Public endpoint
curl http://localhost:3000/api/health

# Protected (returns 401)
curl http://localhost:3000/api/me
```

## Project Structure

```
src/
├── index.ts        # Bun.serve() + OnePipe REST API
├── auth.ts         # OnePipe Auth + better-auth setup
├── auth-client.ts  # Frontend auth client
├── App.tsx         # Main React component with auth UI
├── AuthForm.tsx    # Login/signup form
└── components/ui/  # shadcn/ui components
```
