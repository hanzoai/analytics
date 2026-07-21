import { describe, it, expect } from 'vitest'
import { ErrorBoundary, reportBoundaryError } from './react'
import type { Analytics } from './core'
import type { CaptureErrorOptions } from './types'

interface Call {
  error: unknown
  options?: CaptureErrorOptions
}

function fakeClient(): { client: Analytics; calls: Call[] } {
  const calls: Call[] = []
  const client = {
    captureError: (error: unknown, options?: CaptureErrorOptions) => calls.push({ error, options }),
  } as unknown as Analytics
  return { client, calls }
}

describe('reportBoundaryError', () => {
  it('reports a caught render error as handled, with react context', () => {
    const { client, calls } = fakeClient()
    const err = new Error('render blew up')
    reportBoundaryError(client, err, { componentStack: '\n  at Foo\n  at Bar' })
    expect(calls).toHaveLength(1)
    expect(calls[0].error).toBe(err)
    expect(calls[0].options?.handled).toBe(true)
    expect(calls[0].options?.properties).toMatchObject({ react: true })
    expect(calls[0].options?.properties?.componentStack).toContain('at Foo')
  })

  it('is a no-op with no client (outside a provider)', () => {
    expect(() => reportBoundaryError(null, new Error('x'))).not.toThrow()
  })
})

describe('ErrorBoundary', () => {
  it('getDerivedStateFromError captures the error into state', () => {
    const err = new Error('boom')
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err })
  })

  it('componentDidCatch reports through the context client and calls onError', () => {
    const { client, calls } = fakeClient()
    let onErrorArg: Error | null = null
    const boundary = new ErrorBoundary({ children: null, onError: (e) => (onErrorArg = e) })
    // React wires this.context from contextType at runtime; set it manually here.
    ;(boundary as unknown as { context: Analytics | null }).context = client
    const err = new Error('subtree crash')
    boundary.componentDidCatch(err, { componentStack: '\n  at Widget' })
    expect(calls).toHaveLength(1)
    expect(calls[0].error).toBe(err)
    expect(calls[0].options?.handled).toBe(true)
    expect(onErrorArg).toBe(err)
  })

  it('render returns children normally and a fallback after an error', () => {
    const boundary = new ErrorBoundary({ children: 'kids' as unknown as null })
    expect(boundary.render()).toBe('kids')
    boundary.state = { error: new Error('x') }
    // default fallback is null (last-resort outer boundary)
    expect(boundary.render()).toBeNull()
    boundary.props = { children: null, fallback: 'oops' as unknown as null }
    expect(boundary.render()).toBe('oops')
  })
})
