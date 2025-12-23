/**
 * Projection Builder Tests
 */

import { describe, test, expect, mock } from 'bun:test'
import { Projection } from './projection'
import { Flow } from './flow'

describe('Projection', () => {
  describe('Projection.create()', () => {
    test('creates a projection builder with name', () => {
      const builder = Projection.create('order-stats')
      expect(builder).toBeDefined()
    })
  })

  describe('ProjectionBuilder', () => {
    test('sets source flow by instance', () => {
      const events = Flow.create('events').build()

      const projection = Projection.create('stats')
        .from(events)
        .initial({ count: 0 })
        .reduce((state, event) => state)
        .build()

      expect(projection.name).toBe('stats')
    })

    test('sets source flow by name', () => {
      const projection = Projection.create('stats')
        .from('events')
        .initial({ count: 0 })
        .reduce((state, event) => state)
        .build()

      expect(projection.name).toBe('stats')
    })

    test('sets initial state', () => {
      const projection = Projection.create('counter')
        .from('events')
        .initial({ count: 0, total: 0 })
        .reduce((state) => state)
        .build()

      expect(projection.name).toBe('counter')
    })

    test('sets reducer function', () => {
      interface State {
        count: number
      }
      interface Event {
        type: string
      }

      const reducer = (state: State, event: Event): State => ({
        count: state.count + 1,
      })

      const projection = Projection.create<State, Event>('counter')
        .from('events')
        .initial({ count: 0 })
        .reduce(reducer)
        .build()

      expect(projection.name).toBe('counter')
    })

    test('configures snapshot options', () => {
      const projection = Projection.create('snapshotted')
        .from('events')
        .initial({})
        .reduce((state) => state)
        .snapshot({ every: 100, storage: 'sqlite', onStartup: 'restore' })
        .build()

      expect(projection.name).toBe('snapshotted')
    })

    test('throws without source flow', () => {
      expect(() => {
        Projection.create('invalid')
          .initial({})
          .reduce((state) => state)
          .build()
      }).toThrow('requires a source flow')
    })
  })

  describe('ProjectionInstance', () => {
    test('has get method', () => {
      const projection = Projection.create('test')
        .from('events')
        .initial({ value: 0 })
        .reduce((state) => state)
        .build()

      expect(typeof projection.get).toBe('function')
    })

    test('has subscribe method', () => {
      const projection = Projection.create('test')
        .from('events')
        .initial({ value: 0 })
        .reduce((state) => state)
        .build()

      expect(typeof projection.subscribe).toBe('function')
    })

    test('subscribe returns unsubscribe function', () => {
      const projection = Projection.create('test')
        .from('events')
        .initial({ value: 0 })
        .reduce((state) => state)
        .build()

      const handler = mock(() => {})
      const unsubscribe = projection.subscribe(handler)

      expect(typeof unsubscribe).toBe('function')
    })
  })

  describe('Reducer patterns', () => {
    test('counter pattern', () => {
      interface CounterState {
        count: number
      }
      interface CounterEvent {
        type: 'increment' | 'decrement'
        amount?: number
      }

      const counter = Projection.create<CounterState, CounterEvent>('counter')
        .from('counter-events')
        .initial({ count: 0 })
        .reduce((state, event) => {
          switch (event.type) {
            case 'increment':
              return { count: state.count + (event.amount || 1) }
            case 'decrement':
              return { count: state.count - (event.amount || 1) }
            default:
              return state
          }
        })
        .build()

      expect(counter.name).toBe('counter')
    })

    test('accumulator pattern', () => {
      interface Stats {
        sum: number
        count: number
        min: number
        max: number
      }
      interface ValueEvent {
        value: number
      }

      const stats = Projection.create<Stats, ValueEvent>('value-stats')
        .from('values')
        .initial({ sum: 0, count: 0, min: Infinity, max: -Infinity })
        .reduce((state, event) => ({
          sum: state.sum + event.value,
          count: state.count + 1,
          min: Math.min(state.min, event.value),
          max: Math.max(state.max, event.value),
        }))
        .build()

      expect(stats.name).toBe('value-stats')
    })

    test('entity aggregation pattern', () => {
      interface OrderStats {
        totalOrders: number
        totalRevenue: number
        ordersByStatus: Record<string, number>
      }
      interface OrderEvent {
        type: 'created' | 'completed' | 'cancelled'
        orderId: string
        amount?: number
      }

      const orderStats = Projection.create<OrderStats, OrderEvent>('order-stats')
        .from('order-events')
        .initial({
          totalOrders: 0,
          totalRevenue: 0,
          ordersByStatus: { pending: 0, completed: 0, cancelled: 0 },
        })
        .reduce((state, event) => {
          switch (event.type) {
            case 'created':
              return {
                ...state,
                totalOrders: state.totalOrders + 1,
                ordersByStatus: {
                  ...state.ordersByStatus,
                  pending: state.ordersByStatus.pending + 1,
                },
              }
            case 'completed':
              return {
                ...state,
                totalRevenue: state.totalRevenue + (event.amount || 0),
                ordersByStatus: {
                  ...state.ordersByStatus,
                  pending: state.ordersByStatus.pending - 1,
                  completed: state.ordersByStatus.completed + 1,
                },
              }
            case 'cancelled':
              return {
                ...state,
                ordersByStatus: {
                  ...state.ordersByStatus,
                  pending: state.ordersByStatus.pending - 1,
                  cancelled: state.ordersByStatus.cancelled + 1,
                },
              }
            default:
              return state
          }
        })
        .build()

      expect(orderStats.name).toBe('order-stats')
    })
  })

  describe('Snapshot configuration', () => {
    test('memory storage', () => {
      const projection = Projection.create('memory-snap')
        .from('events')
        .initial({})
        .reduce((s) => s)
        .snapshot({ storage: 'memory', every: 50 })
        .build()

      expect(projection.name).toBe('memory-snap')
    })

    test('sqlite storage', () => {
      const projection = Projection.create('sqlite-snap')
        .from('events')
        .initial({})
        .reduce((s) => s)
        .snapshot({ storage: 'sqlite', every: 100 })
        .build()

      expect(projection.name).toBe('sqlite-snap')
    })

    test('restore on startup', () => {
      const projection = Projection.create('restore-snap')
        .from('events')
        .initial({})
        .reduce((s) => s)
        .snapshot({ onStartup: 'restore' })
        .build()

      expect(projection.name).toBe('restore-snap')
    })

    test('rebuild on startup', () => {
      const projection = Projection.create('rebuild-snap')
        .from('events')
        .initial({})
        .reduce((s) => s)
        .snapshot({ onStartup: 'rebuild' })
        .build()

      expect(projection.name).toBe('rebuild-snap')
    })
  })
})
