/**
 * Standalone Dashboard API Server
 *
 * Run: bun run server/standalone.ts
 */

import { Dashboard } from './index'

const port = parseInt(process.env.PORT || '4001')

Dashboard.create()
  .port(port)
  .start()
  .catch((error) => {
    console.error('Failed to start dashboard:', error)
    process.exit(1)
  })
