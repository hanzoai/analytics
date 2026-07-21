// React bindings for @hanzo/event — a provider, an accessor hook, a route-change
// pageview hook, and an error boundary that reports render crashes through the SAME
// client (so React errors join window.onerror / rejections / manual reports on one
// stream). Framework-neutral: it takes the current path as an argument (the Next app
// wires usePathname(); a Vite/router app passes its own), so this file never imports
// next/*.
//
//   'use client'
//   import { AnalyticsProvider, useAnalytics, usePageview, ErrorBoundary } from '@hanzo/event/react'
//
//   <AnalyticsProvider config={{ product: 'app', host: 'https://api.hanzo.ai' }}>
//     <ErrorBoundary>…</ErrorBoundary>
//   </AnalyticsProvider>
//   const a = useAnalytics(); usePageview(usePathname())

import {
  Component,
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { Analytics, createAnalytics } from './core'
import type { AnalyticsConfig } from './types'

const Ctx = createContext<Analytics | null>(null)

export interface AnalyticsProviderProps {
  /** Provide a pre-built client, or a config to build one. */
  client?: Analytics
  config?: AnalyticsConfig
  /** Fire a pageview for the initial load (default true). */
  autoPageview?: boolean
  children: ReactNode
}

export function AnalyticsProvider(props: AnalyticsProviderProps) {
  const { client, config, autoPageview = true, children } = props
  const instance = useMemo<Analytics>(() => {
    if (client) return client
    if (config) return createAnalytics(config)
    throw new Error('AnalyticsProvider requires `client` or `config`')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  useEffect(() => {
    instance.init()
    if (autoPageview) instance.pageview()
  }, [instance, autoPageview])

  return createElement(Ctx.Provider, { value: instance }, children)
}

/** useAnalytics returns the client. Outside a provider it returns a no-op-safe
 *  null-guarded proxy so calls never throw during SSR/tests. */
export function useAnalytics(): Analytics {
  const a = useContext(Ctx)
  if (!a) return noop
  return a
}

/** usePageview fires a pageview on every route CHANGE (not the initial mount —
 *  the provider's autoPageview covers that, so pages are counted exactly once). */
export function usePageview(path: string | null | undefined): void {
  const a = useContext(Ctx)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (a && path) a.pageview(path)
  }, [a, path])
}

/** reportBoundaryError ships a caught render error through the shared client. Pure
 *  and null-safe (no client => no-op) so it is unit-testable without a DOM. */
export function reportBoundaryError(
  client: Analytics | null,
  error: Error,
  info?: { componentStack?: string | null },
): void {
  if (!client) return
  client.captureError(error, {
    handled: true,
    properties: { react: true, componentStack: info?.componentStack ?? undefined },
  })
}

export interface ErrorBoundaryProps {
  children: ReactNode
  /** Rendered after a caught error. Default: null (a last-resort outer boundary —
   *  apps typically nest their own UI-fallback boundary inside this reporting one). */
  fallback?: ReactNode | ((error: Error) => ReactNode)
  /** Extra hook invoked with the caught error (after it is reported). */
  onError?: (error: Error, info: { componentStack?: string | null }) => void
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * ErrorBoundary catches render errors in its subtree and reports them via the
 * client from the nearest AnalyticsProvider — the SAME de-duped stream as
 * window.onerror / unhandledrejection / manual captureError. It reads the client
 * from context, so it must live under an AnalyticsProvider.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static contextType = Ctx
  declare context: React.ContextType<typeof Ctx>

  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportBoundaryError(this.context, error, { componentStack: info.componentStack })
    this.props.onError?.(error, { componentStack: info.componentStack })
  }

  render(): ReactNode {
    if (this.state.error) {
      const { fallback } = this.props
      if (typeof fallback === 'function') return fallback(this.state.error)
      return fallback ?? null
    }
    return this.props.children
  }
}

// A shared no-op client for use outside a provider — keeps call sites total.
const noop = new Analytics({ product: 'unknown', enabled: false })
