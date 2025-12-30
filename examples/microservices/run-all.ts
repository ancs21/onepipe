/**
 * Run All Microservices
 *
 * Starts all services in separate processes to demonstrate
 * true service-to-service communication with tracing.
 *
 * Usage: bun run examples/microservices/run-all.ts
 */

import { spawn, type Subprocess } from 'bun'

const SERVICES = ['users', 'inventory', 'orders', 'gateway']
const processes: Subprocess[] = []

console.log('Starting microservices...\n')

// Start each service
for (const service of SERVICES) {
  const proc = spawn(['bun', 'run', 'examples/microservices/distributed.ts'], {
    env: { ...process.env, SERVICE: service },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  processes.push(proc)
  // Small delay between starts
  await new Promise(r => setTimeout(r, 500))
}

console.log(`
All services running:
  - users:     http://localhost:3001
  - inventory: http://localhost:3002
  - orders:    http://localhost:3003
  - gateway:   http://localhost:3000

Dashboard: http://localhost:4000

Try creating an order (calls users + inventory):
  curl -X POST http://localhost:3000/api/orders \\
    -H "Content-Type: application/json" \\
    -d '{"userId":"user-1","items":[{"productId":"prod-1","quantity":1}]}'

Press Ctrl+C to stop all services.
`)

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nStopping services...')
  for (const proc of processes) {
    proc.kill()
  }
  process.exit(0)
})

// Keep running
await Promise.all(processes.map(p => p.exited))
