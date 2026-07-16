import type { ActionState, AtomLike, Frame } from '@reatom/core'
import {
  _enqueue,
  bind,
  EXTENSIONS,
  getSerial,
  getStackTrace,
  isAbort,
  isBrowser,
  isConnected,
  isSkip,
  log as reatomLog,
  top,
  withMiddleware,
} from '@reatom/core'

export interface LoggerRecordBase {
  name: string
  timestamp: string
  serial: string
  stack: string
  color?: string
  error?: unknown
  aborted: boolean
}

export interface AtomLoggerRecord extends LoggerRecordBase {
  type: 'atom'
  state: unknown
  prevState: unknown
  connected: boolean
}

export interface ActionLoggerRecord extends LoggerRecordBase {
  type: 'action' | 'log'
  params: unknown[]
  payload: unknown
}

export type LoggerRecord = AtomLoggerRecord | ActionLoggerRecord

export interface ConnectLoggerOptions {
  /** Same filtering contract as @reatom/core's connectLogger. */
  match?: (name: string, frame: Frame) => boolean | string
  /** Maps one Reatom record to arguments for one `log` call. */
  map?: (record: LoggerRecord) => readonly unknown[]
  /** Receives the arguments returned by `map`. */
  log?: (...args: unknown[]) => void
}

let defaultMap = (record: LoggerRecord): unknown[] => {
  let title = `[Reatom:${record.type}] ${record.name}${record.serial}`
  let args: unknown[] = [title, record]

  if (record.type === 'log') {
    args = [title, ...record.params, record]
  }

  if (record.color && isBrowser()) {
    args[0] = `%c${title}`
    args.splice(1, 0, `background: ${record.color}; color: white;`)
  }

  return args
}

let defaultLog = (...args: unknown[]) => console.log(...args)

/**
 * Connects a flat, mappable logger to every Reatom entity created afterwards.
 * Call it before importing application models, just like Reatom's connectLogger.
 */
export let connectLogger = ({
  match,
  map = defaultMap,
  log = defaultLog,
}: ConnectLoggerOptions = {}): void => {
  let emit = (record: LoggerRecord) => {
    try {
      log(...map(record))
    } catch (error) {
      console.log('Reatom log error:', error)
    }
  }

  let extendedTargets = new WeakSet<AtomLike>()
  let loggerExtension = <T extends AtomLike>(target: T): T => {
    // Actions receive global extensions twice during construction in Reatom.
    if (extendedTargets.has(target) || isSkip(target)) {
      return target
    }
    extendedTargets.add(target)

    let isLogMethod = (target as AtomLike) === (reatomLog as AtomLike)
    let isOnReject = target.name.endsWith('.onReject')
    let isOnFulfill = target.name.endsWith('.onFulfill')
    let initKey = {}

    return target.extend(
      withMiddleware(
        () =>
          function convenientLogger(next, ...params) {
            _enqueue(
              bind(() => {
                let frame = top()
                let matchResult = match?.(target.name, frame) ?? true
                if (!matchResult) return

                let common: LoggerRecordBase = {
                  name: target.name,
                  timestamp: new Date().toISOString(),
                  serial: getSerial(frame),
                  stack: getStackTrace(frame),
                  color:
                    typeof matchResult === 'string' ? matchResult : undefined,
                  error,
                  aborted: isAbort(error),
                }

                if (target.__reatom.reactive) {
                  if (Object.is(prevState, state)) return

                  let inits = frame.root.inits
                  if (!inits.has(initKey)) {
                    inits.set(initKey, null)
                    if (params.length === 0) return
                  }

                  emit({
                    ...common,
                    type: 'atom',
                    state,
                    prevState,
                    connected: isConnected(target),
                  })
                  return
                }

                // Core leaves state unset when `next` throws synchronously.
                let call = (state as ActionState | undefined)?.at(-1)
                if (isOnReject && call) error = call.payload?.error

                if (error) {
                  emit({
                    ...common,
                    type: isLogMethod ? 'log' : 'action',
                    params,
                    payload: undefined,
                    error,
                    aborted: isAbort(error),
                  })
                  return
                }

                if (call) {
                  let payload = isOnFulfill
                    ? call.payload?.payload
                    : call.payload
                  emit({
                    ...common,
                    type: isLogMethod ? 'log' : 'action',
                    params,
                    payload,
                  })
                }
              }),
              'hook',
            )

            let prevState = top().state
            let state: typeof prevState
            let error: unknown

            try {
              state = next(...params)
            } catch (cause) {
              error = cause ?? new Error('unknown error')
              throw cause
            }

            return state
          },
      ),
    )
  }

  // Match @reatom/core's connectLogger registration order and LOG handling.
  EXTENSIONS.push(loggerExtension)
  reatomLog.extend(loggerExtension)
}
