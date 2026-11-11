import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from '../test/fake-event-source.ts'
import { STALE_AFTER_MS, useEventStream } from './use-event-stream.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup() {
  const onData = vi.fn()
  const onFailedAttempt = vi.fn()
  const hook = renderHook(() => useEventStream('/api/canal', { dato: onData }, onFailedAttempt))
  const first = FakeEventSource.latest()
  act(() => first.open())
  return { hook, first, onData, onFailedAttempt }
}

describe('useEventStream', () => {
  it('entrega los eventos con nombre ya convertidos de JSON', () => {
    const { hook, first, onData } = setup()
    expect(hook.result.current).toBe('open')
    act(() => first.emit('dato', { a: 1 }))
    expect(onData).toHaveBeenCalledWith({ a: 1 })
  })

  it('con latidos la conexión se mantiene', () => {
    const { hook, first } = setup()
    for (let i = 0; i < 6; i++) {
      act(() => {
        vi.advanceTimersByTime(25_000)
        first.emit('ping', {})
      })
    }
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(hook.result.current).toBe('open')
  })

  it('sin datos ni latidos durante 60 s la da por muerta y reconecta (proxy que no la cierra)', () => {
    const { hook, first } = setup()
    act(() => vi.advanceTimersByTime(STALE_AFTER_MS + 10_000))
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(first.readyState).toBe(FakeEventSource.CLOSED)
    expect(hook.result.current).toBe('reconnecting')
    act(() => FakeEventSource.latest().open())
    expect(hook.result.current).toBe('open')
  })

  it('si el servidor responde con error, avisa y reintenta con espera creciente', () => {
    const { first, onFailedAttempt } = setup()
    act(() => first.fail({ closed: true }))
    expect(onFailedAttempt).toHaveBeenCalledTimes(1)
    expect(FakeEventSource.instances).toHaveLength(1)
    act(() => vi.advanceTimersByTime(3_000))
    expect(FakeEventSource.instances).toHaveLength(2)

    act(() => FakeEventSource.latest().fail({ closed: true }))
    act(() => vi.advanceTimersByTime(3_000))
    expect(FakeEventSource.instances).toHaveLength(2)
    act(() => vi.advanceTimersByTime(3_000))
    expect(FakeEventSource.instances).toHaveLength(3)
  })

  it('un corte normal lo reintenta el navegador solo (sin reconexión manual)', () => {
    const { hook, first, onFailedAttempt } = setup()
    act(() => first.fail())
    expect(hook.result.current).toBe('reconnecting')
    expect(onFailedAttempt).not.toHaveBeenCalled()
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('al desmontar cierra la conexión', () => {
    const { hook, first } = setup()
    hook.unmount()
    expect(first.readyState).toBe(FakeEventSource.CLOSED)
  })
})
