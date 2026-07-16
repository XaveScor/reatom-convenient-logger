import { beforeEach, expect, test } from 'vitest'
import {
  action,
  atom,
  context,
  log as reatomLog,
  notify,
  withAsync,
} from '@reatom/core'

import {
  connectLogger,
  type LoggerRecord,
  type LoggerRecordBase,
} from './index'

let records: LoggerRecord[] = []
let calls: unknown[][] = []
let mapper = (record: LoggerRecord): unknown[] => {
  records.push(record)
  return ['mapped', record.type, record.name]
}

let loggerOptions = {
  match: (name) => {
    if (name === 'loggerTest.color') return '#123456'
    return name.startsWith('loggerTest.') || name === 'LOG'
  },
  map: (record) => mapper(record),
  log: (...args) => calls.push(args),
} satisfies Parameters<typeof connectLogger>[0]

connectLogger(loggerOptions)

beforeEach(() => {
  context.reset()
  records = []
  calls = []
  mapper = (record) => {
    records.push(record)
    return ['mapped', record.type, record.name]
  }
})

test('maps one atom change to one log call', () => {
  let count = atom(0, 'loggerTest.count')
  count.subscribe()

  count.set(1)
  notify()

  expect(calls).toEqual([['mapped', 'atom', 'loggerTest.count']])
  expect(records).toMatchObject([
    {
      type: 'atom',
      name: 'loggerTest.count',
      state: 1,
      prevState: 0,
      connected: true,
      aborted: false,
    },
  ])
  expect(records[0]?.stack).toContain('loggerTest.count')
})

test('does not log initial reads or unchanged state', () => {
  let count = atom(0, 'loggerTest.unchanged')
  count.subscribe()
  count.set(0)
  notify()

  expect(calls).toEqual([])
})

test('maps action params and payload', () => {
  let multiply = action((value: number) => value * 2, 'loggerTest.multiply')

  expect(multiply(3)).toBe(6)
  notify()

  expect(records).toMatchObject([
    {
      type: 'action',
      name: 'loggerTest.multiply',
      params: [3],
      payload: 6,
      aborted: false,
    },
  ])
})

test('maps thrown errors without swallowing them', () => {
  let failure = new Error('failure')
  let fail = action(() => {
    throw failure
  }, 'loggerTest.fail')

  expect(() => fail()).toThrow(failure)
  notify()

  expect(records).toMatchObject([
    {
      type: 'action',
      name: 'loggerTest.fail',
      params: [],
      error: failure,
      aborted: false,
    },
  ])
})

test('skips private entities and applies match colors', () => {
  let privateAtom = atom(0, '_loggerTest.private')
  let coloredAtom = atom(0, 'loggerTest.color')
  privateAtom.subscribe()
  coloredAtom.subscribe()

  privateAtom.set(1)
  coloredAtom.set(1)
  notify()

  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    name: 'loggerTest.color',
    color: '#123456',
  } satisfies Partial<LoggerRecordBase>)
})

test('logs the Reatom LOG action through the same mapper', () => {
  reatomLog('message', { id: 1 })
  notify()

  expect(records).toMatchObject([
    {
      type: 'log',
      name: 'LOG',
      params: ['message', { id: 1 }],
    },
  ])
  expect(calls).toHaveLength(1)
})

test('forwards every value returned by a custom mapper', () => {
  mapper = (record) => ['custom', { event: record.type }, record.name]
  let event = action(() => 'payload', 'loggerTest.customMap')

  event()
  notify()

  expect(calls).toEqual([
    ['custom', { event: 'action' }, 'loggerTest.customMap'],
  ])
})

test('normalizes async fulfillment and rejection records', async () => {
  let shouldReject = false
  let request = action(async (value: string) => {
    if (shouldReject) throw new Error(value)
    return value.toUpperCase()
  }, 'loggerTest.request').extend(withAsync())

  await request('ok')
  await Promise.resolve()
  notify()

  expect(records.map(({ name }) => name)).toEqual([
    'loggerTest.request',
    'loggerTest.request.onFulfill',
  ])
  expect(records[1]).toMatchObject({
    type: 'action',
    name: 'loggerTest.request.onFulfill',
    params: ['OK', ['ok']],
    payload: 'OK',
  })

  records = []
  calls = []
  shouldReject = true
  await expect(request('failure')).rejects.toThrow('failure')
  await Promise.resolve()
  notify()

  expect(records.map(({ name }) => name)).toEqual([
    'loggerTest.request',
    'loggerTest.request.onReject',
  ])
  expect(records[1]).toMatchObject({
    type: 'action',
    name: 'loggerTest.request.onReject',
    params: [expect.objectContaining({ message: 'failure' }), ['failure']],
    payload: undefined,
    error: expect.objectContaining({ message: 'failure' }),
  })
})

test('preserves core ordering for nested actions and atom changes', () => {
  let state = atom(0, 'loggerTest.nested.state')
  state.subscribe()
  let update = action((value: number) => state.set(value), 'loggerTest.nested')

  update(1)
  notify()

  expect(records.map(({ name }) => name)).toEqual([
    'loggerTest.nested',
    'loggerTest.nested.state',
  ])
})
