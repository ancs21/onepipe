# Contributing to OnePipe

Thank you for your interest in contributing to OnePipe!

## Development Setup

1. Clone the repository:
```bash
git clone https://github.com/ancs21/onepipe.git
cd onepipe
```

2. Install dependencies:
```bash
bun install
```

3. Run the development server:
```bash
bun run dev --app ./examples/full-demo.ts
```

4. Run tests:
```bash
bun test
```

## Project Structure

```
onepipe/
├── packages/
│   ├── sdk/        # Core SDK primitives
│   ├── runtime/    # Bun HTTP server
│   ├── client/     # Client SDK + React hooks
│   └── cli/        # CLI tool
├── docs/           # Documentation site
└── examples/       # Example applications
```

## Development Workflow

1. Create a branch for your feature/fix:
```bash
git checkout -b feature/my-feature
```

2. Make your changes

3. Add tests for new functionality

4. Run tests and type checking:
```bash
bun test
bun run --filter '*' typecheck
```

5. Submit a pull request

## Code Style

- Use TypeScript for all code
- Follow existing patterns in the codebase
- Use the fluent builder pattern for new primitives
- Add JSDoc comments for public APIs
- Keep functions small and focused

## Commit Messages

Use conventional commits:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance

Example:
```
feat(sdk): add websocket support to Flow
```

## Testing

- Tests are colocated with source files (`*.test.ts`)
- Use `bun test` to run all tests
- Use `bun test path/to/file.test.ts` for specific tests

## Pull Request Guidelines

1. Keep PRs focused on a single feature/fix
2. Update documentation if needed
3. Add/update tests
4. Ensure all tests pass
5. Request review from maintainers

## Reporting Issues

When reporting issues, please include:

- OnePipe version
- Bun version
- Operating system
- Minimal reproduction code
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
