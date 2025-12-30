import { useLocation } from 'react-router-dom'
import { lazy, Suspense } from 'react'

// Pre-create lazy components (must be stable references)
const DocsIndex = lazy(() => import('../docs/index.mdx'))
const DocsRest = lazy(() => import('../docs/rest.mdx'))
const DocsDb = lazy(() => import('../docs/db.mdx'))
const DocsServer = lazy(() => import('../docs/server.mdx'))
const DocsFlow = lazy(() => import('../docs/flow.mdx'))
const DocsProjection = lazy(() => import('../docs/projection.mdx'))
const DocsSignal = lazy(() => import('../docs/signal.mdx'))
const DocsChannel = lazy(() => import('../docs/channel.mdx'))
const DocsCache = lazy(() => import('../docs/cache.mdx'))
const DocsAuth = lazy(() => import('../docs/auth.mdx'))
const DocsErrors = lazy(() => import('../docs/errors.mdx'))
const DocsExamples = lazy(() => import('../docs/examples.mdx'))
const DocsApi = lazy(() => import('../api/globals.mdx'))
// New docs
const DocsWorkflow = lazy(() => import('../docs/workflow.mdx'))
const DocsCron = lazy(() => import('../docs/cron.mdx'))
const DocsTracing = lazy(() => import('../docs/tracing.mdx'))
const DocsHttpClient = lazy(() => import('../docs/http-client.mdx'))
const DocsServiceClient = lazy(() => import('../docs/service-client.mdx'))
const DocsStorage = lazy(() => import('../docs/storage.mdx'))
const DocsClient = lazy(() => import('../docs/client.mdx'))
const DocsCli = lazy(() => import('../docs/cli.mdx'))
const DocsMigration = lazy(() => import('../docs/migration.mdx'))
const DocsConfig = lazy(() => import('../docs/config.mdx'))
const DocsObservability = lazy(() => import('../docs/observability.mdx'))
// Integrations
const DocsBetterAuth = lazy(() => import('../docs/better-auth.mdx'))
const DocsDrizzle = lazy(() => import('../docs/drizzle.mdx'))

const docs: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  '/docs': DocsIndex,
  '/docs/rest': DocsRest,
  '/docs/db': DocsDb,
  '/docs/server': DocsServer,
  '/docs/flow': DocsFlow,
  '/docs/projection': DocsProjection,
  '/docs/signal': DocsSignal,
  '/docs/channel': DocsChannel,
  '/docs/cache': DocsCache,
  '/docs/auth': DocsAuth,
  '/docs/errors': DocsErrors,
  '/docs/examples': DocsExamples,
  '/docs/api': DocsApi,
  // New docs
  '/docs/workflow': DocsWorkflow,
  '/docs/cron': DocsCron,
  '/docs/tracing': DocsTracing,
  '/docs/http-client': DocsHttpClient,
  '/docs/service-client': DocsServiceClient,
  '/docs/storage': DocsStorage,
  '/docs/client': DocsClient,
  '/docs/cli': DocsCli,
  '/docs/migration': DocsMigration,
  '/docs/config': DocsConfig,
  '/docs/observability': DocsObservability,
  // Integrations
  '/docs/better-auth': DocsBetterAuth,
  '/docs/drizzle': DocsDrizzle,
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 bg-[--bg-elevated] rounded-sm" />
      <div className="space-y-2">
        <div className="h-4 w-full bg-[--bg-secondary] rounded-sm" />
        <div className="h-4 w-5/6 bg-[--bg-secondary] rounded-sm" />
        <div className="h-4 w-4/6 bg-[--bg-secondary] rounded-sm" />
      </div>
      <div className="h-32 w-full bg-[--bg-secondary] rounded-sm" />
    </div>
  )
}

function NotFound() {
  return (
    <div className="py-12">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-sm bg-zinc-800 mb-6">
          <svg viewBox="0 0 24 24" className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Page Not Found</h1>
        <p className="text-zinc-400 mb-6">
          The documentation page you're looking for doesn't exist.
        </p>
        <a
          href="/docs"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-amber-500/10 text-amber-500 font-medium hover:bg-amber-500/20 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to docs
        </a>
      </div>
    </div>
  )
}

export function DocsPage() {
  const location = useLocation()
  const path = location.pathname

  const Content = docs[path]

  if (!Content) {
    return <NotFound />
  }

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <Content />
    </Suspense>
  )
}
