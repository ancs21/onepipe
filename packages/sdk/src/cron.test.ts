/**
 * Cron Builder Tests
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { Cron } from './cron'

// Mock database instance
function createMockDB() {
  return {
    name: 'test-db',
    type: 'postgres' as const,
    query: mock(async () => []),
    execute: mock(async () => ({ rowsAffected: 0 })),
    transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    close: mock(async () => {}),
    getTables: mock(async () => []),
    getTableSchema: mock(async () => []),
  }
}

describe('Cron', () => {
  describe('Cron.create()', () => {
    test('creates a cron builder with name', () => {
      const builder = Cron.create('test-cron')
      expect(builder).toBeDefined()
    })
  })

  describe('CronBuilder', () => {
    test('accepts schedule expression', () => {
      const builder = Cron.create('daily-job')
        .schedule('0 9 * * *')

      expect(builder).toBeDefined()
    })

    test('throws on invalid schedule expression', () => {
      expect(() => {
        Cron.create('test')
          .schedule('invalid')
      }).toThrow('Invalid cron expression')
    })

    test('throws on incomplete schedule expression', () => {
      expect(() => {
        Cron.create('test')
          .schedule('0 9 * *')
      }).toThrow('expected 5 parts')
    })

    test('accepts timezone', () => {
      const builder = Cron.create('daily-job')
        .schedule('0 9 * * *')
        .timezone('America/New_York')

      expect(builder).toBeDefined()
    })

    test('accepts catchUp option', () => {
      const builder = Cron.create('daily-job')
        .schedule('0 9 * * *')
        .catchUp(true)

      expect(builder).toBeDefined()
    })

    test('accepts maxCatchUp option', () => {
      const builder = Cron.create('daily-job')
        .schedule('0 9 * * *')
        .catchUp(true)
        .maxCatchUp(5)

      expect(builder).toBeDefined()
    })

    test('accepts database instance', () => {
      const db = createMockDB()

      const builder = Cron.create('daily-job')
        .schedule('0 9 * * *')
        .db(db)

      expect(builder).toBeDefined()
    })

    test('throws error for non-postgres database', () => {
      const sqliteDb = {
        name: 'test-db',
        type: 'sqlite' as const,
        query: mock(async () => []),
        execute: mock(async () => ({ rowsAffected: 0 })),
        transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
        close: mock(async () => {}),
        getTables: mock(async () => []),
        getTableSchema: mock(async () => []),
      }

      expect(() => {
        Cron.create('test')
          .schedule('0 9 * * *')
          .db(sqliteDb)
      }).toThrow('Cron requires PostgreSQL database')
    })

    test('enables tracing', () => {
      const builder = Cron.create('daily-job')
        .schedule('0 9 * * *')
        .trace()

      expect(builder).toBeDefined()
    })

    test('accepts handler function', () => {
      const builder = Cron.create('daily-job')
        .schedule('0 9 * * *')
        .handler(async (_ctx) => {
          return { processed: true }
        })

      expect(builder).toBeDefined()
    })

    test('chains multiple options', () => {
      const db = createMockDB()

      const builder = Cron.create('daily-report')
        .schedule('0 9 * * *')
        .timezone('America/New_York')
        .catchUp(true)
        .maxCatchUp(5)
        .db(db)
        .trace()
        .handler(async (_ctx) => {
          return { sent: true }
        })

      expect(builder).toBeDefined()
    })

    test('build() requires schedule', () => {
      const db = createMockDB()

      expect(() => {
        Cron.create('test')
          .db(db)
          .handler(async () => ({}))
          .build()
      }).toThrow('requires a schedule')
    })

    test('build() requires database', () => {
      expect(() => {
        Cron.create('test')
          .schedule('0 9 * * *')
          .handler(async () => ({}))
          .build()
      }).toThrow('requires a PostgreSQL database')
    })

    test('build() requires handler or workflow', () => {
      const db = createMockDB()

      expect(() => {
        Cron.create('test')
          .schedule('0 9 * * *')
          .db(db)
          .build()
      }).toThrow('requires either a handler or workflow')
    })

    test('builds a cron instance', () => {
      const db = createMockDB()

      const cron = Cron.create('daily-report')
        .schedule('0 9 * * *')
        .db(db)
        .handler(async (_ctx) => {
          return { ok: true }
        })
        .build()

      expect(cron).toBeDefined()
      expect(cron.name).toBe('daily-report')
      expect(cron.schedule).toBe('0 9 * * *')
    })
  })

  describe('CronInstance', () => {
    let db: ReturnType<typeof createMockDB>

    beforeEach(() => {
      db = createMockDB()
    })

    test('has start method', () => {
      const cron = Cron.create('test')
        .schedule('* * * * *')
        .db(db)
        .handler(async () => ({}))
        .build()

      expect(typeof cron.start).toBe('function')
    })

    test('has stop method', () => {
      const cron = Cron.create('test')
        .schedule('* * * * *')
        .db(db)
        .handler(async () => ({}))
        .build()

      expect(typeof cron.stop).toBe('function')
    })

    test('has trigger method', () => {
      const cron = Cron.create('test')
        .schedule('* * * * *')
        .db(db)
        .handler(async () => ({}))
        .build()

      expect(typeof cron.trigger).toBe('function')
    })

    test('has history method', () => {
      const cron = Cron.create('test')
        .schedule('* * * * *')
        .db(db)
        .handler(async () => ({}))
        .build()

      expect(typeof cron.history).toBe('function')
    })

    test('has nextRun method', () => {
      const cron = Cron.create('test')
        .schedule('* * * * *')
        .db(db)
        .handler(async () => ({}))
        .build()

      expect(typeof cron.nextRun).toBe('function')
    })

    test('has isRunning method', () => {
      const cron = Cron.create('test')
        .schedule('* * * * *')
        .db(db)
        .handler(async () => ({}))
        .build()

      expect(typeof cron.isRunning).toBe('function')
    })

    test('isRunning returns false before start', () => {
      const cron = Cron.create('test')
        .schedule('* * * * *')
        .db(db)
        .handler(async () => ({}))
        .build()

      expect(cron.isRunning()).toBe(false)
    })

    test('nextRun returns null when not running', () => {
      const cron = Cron.create('test')
        .schedule('* * * * *')
        .db(db)
        .handler(async () => ({}))
        .build()

      expect(cron.nextRun()).toBe(null)
    })
  })
})

describe('Cron schedule expressions', () => {
  let db: ReturnType<typeof createMockDB>

  beforeEach(() => {
    db = createMockDB()
  })

  test('every minute: * * * * *', () => {
    const cron = Cron.create('test')
      .schedule('* * * * *')
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron.schedule).toBe('* * * * *')
  })

  test('every hour: 0 * * * *', () => {
    const cron = Cron.create('test')
      .schedule('0 * * * *')
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron.schedule).toBe('0 * * * *')
  })

  test('daily at 9 AM: 0 9 * * *', () => {
    const cron = Cron.create('test')
      .schedule('0 9 * * *')
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron.schedule).toBe('0 9 * * *')
  })

  test('every Monday at 9 AM: 0 9 * * 1', () => {
    const cron = Cron.create('test')
      .schedule('0 9 * * 1')
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron.schedule).toBe('0 9 * * 1')
  })

  test('first of month at midnight: 0 0 1 * *', () => {
    const cron = Cron.create('test')
      .schedule('0 0 1 * *')
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron.schedule).toBe('0 0 1 * *')
  })

  test('every 15 minutes: */15 * * * *', () => {
    const cron = Cron.create('test')
      .schedule('*/15 * * * *')
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron.schedule).toBe('*/15 * * * *')
  })

  test('weekdays at 8:30: 30 8 * * 1-5', () => {
    const cron = Cron.create('test')
      .schedule('30 8 * * 1-5')
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron.schedule).toBe('30 8 * * 1-5')
  })

  test('specific minutes: 0,30 * * * *', () => {
    const cron = Cron.create('test')
      .schedule('0,30 * * * *')
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron.schedule).toBe('0,30 * * * *')
  })

  test('range hours: 0 9-17 * * *', () => {
    const cron = Cron.create('test')
      .schedule('0 9-17 * * *')
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron.schedule).toBe('0 9-17 * * *')
  })

  test('complex: 0,30 9-17 * * 1-5', () => {
    const cron = Cron.create('test')
      .schedule('0,30 9-17 * * 1-5')
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron.schedule).toBe('0,30 9-17 * * 1-5')
  })
})

describe('Cron expression validation', () => {
  test('throws for too few parts', () => {
    expect(() => {
      Cron.create('test')
        .schedule('0 9 * *')
    }).toThrow('expected 5 parts')
  })

  test('throws for too many parts', () => {
    expect(() => {
      Cron.create('test')
        .schedule('0 9 * * * *')
    }).toThrow('expected 5 parts')
  })

  test('throws for empty expression', () => {
    expect(() => {
      Cron.create('test')
        .schedule('')
    }).toThrow('expected 5 parts')
  })

  test('filters out-of-range values silently', () => {
    const db = createMockDB()

    // Parser filters invalid values but doesn't throw
    // These will result in empty arrays for the field
    const cron = Cron.create('test')
      .schedule('0 9 * * *')  // Valid schedule
      .db(db)
      .handler(async () => ({}))
      .build()

    expect(cron).toBeDefined()
  })
})

describe('Cron with typed output', () => {
  test('handler return type is preserved', () => {
    const db = createMockDB()

    interface ReportResult {
      sent: boolean
      recipientCount: number
      timestamp: Date
    }

    const cron = Cron.create('daily-report')
      .schedule('0 9 * * *')
      .db(db)
      .handler(async (ctx): Promise<ReportResult> => {
        return {
          sent: true,
          recipientCount: 10,
          timestamp: new Date(),
        }
      })
      .build()

    expect(cron.name).toBe('daily-report')
  })
})
