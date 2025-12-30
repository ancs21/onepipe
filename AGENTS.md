# AGENTS.md

Instructions for AI coding agents working on OnePipe.

## Commands

```bash
# Install
bun install

# Dev server
bun run dev --app ./examples/full-demo.ts

# Tests
bun test                                    # Run all tests
bun test packages/sdk/src/flow.test.ts      # Single file

# Type check
bun run --filter '*' typecheck

# Build
bun run build

# Docs
bun run docs:dev      # Dev server
bun run docs:build    # Production build

# Release (Changesets)
bun run changeset     # Create changeset
bun run version       # Bump versions
bun run release       # Publish to npm
```

## Project Structure

```
packages/
  sdk/        # Core SDK - REST, Flow, DB, Projection, Signal, Channel, Cache, Auth
  runtime/    # Runtime server (depends on SDK)
  client/     # Frontend client (React hooks, fetch client)
  cli/        # CLI tool
docs/         # Documentation site (Vite + React + MDX)
examples/     # Demo applications
```

## Code Style

### Builder Pattern
All primitives use fluent builders: `Primitive.create(name)...build()`

```typescript
// Good
const api = REST.create('orders')
  .basePath('/api/orders')
  .db(database)
  .get('/', async (ctx) => ctx.db.query('SELECT * FROM orders'))
  .build()

// Bad - don't skip build()
const api = REST.create('orders').basePath('/api/orders')
```

### Error Handling
Use `APIError` class with Encore-compatible codes:

```typescript
throw APIError.notFound('Resource not found')
throw APIError.invalidArgument('Title is required')
throw APIError.unavailable('Service in maintenance')
```

### REST Handlers
Context provides: `params`, `query`, `headers`, `body()`, `db`, `cache`
Response helpers: `json()`, `created()`, `notFound()`, `noContent()`

```typescript
.post('/', async (ctx) => {
  const data = await ctx.body()
  const result = await ctx.db.query('INSERT INTO orders ...')
  return ctx.created(result)
})
```

### Flow + Projection Pattern

```typescript
const events = Flow.create('events').schema(Schema).build()
const stats = Projection.create('stats')
  .from(events)
  .initial({ count: 0 })
  .reduce((state, event) => ({ count: state.count + 1 }))
  .build()
```

## Testing

- Tests colocated with source: `*.test.ts`
- Run `bun test` before committing
- Run `bun run --filter '*' typecheck` for type safety

## Git Workflow

- Create changesets for user-facing changes: `bun run changeset`
- Commit message format: `type: description` (feat, fix, chore, docs)
- Run tests and typecheck before pushing

## Boundaries

### Always do
- Use the builder pattern with `.build()` at the end
- Use `APIError` for error responses
- Colocate tests with source files
- Run `bun test` after modifying SDK code

### Ask first
- Adding new dependencies
- Changing public API signatures
- Modifying database schemas

### Never do
- Skip `.build()` on primitives
- Commit without running tests
- Expose internal implementation details in public API
- Use `throw new Error()` instead of `APIError` in handlers
