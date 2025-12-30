import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CommandPalette } from './components/CommandPalette'
import { QueryProvider } from './lib/QueryProvider'
import { ThemeProvider } from './lib/theme'
import { useNavigationShortcuts } from './hooks/useKeyboardShortcuts'
import { Services } from './pages/Services'
import { ApiExplorer } from './pages/ApiExplorer'
import { Traces } from './pages/Traces'
import { Metrics } from './pages/Metrics'
import { Logs } from './pages/Logs'
import { Flows } from './pages/Flows'
import { Database } from './pages/Database'
import { Workflows } from './pages/Workflows'
import { CronPage } from './pages/Cron'
import Auth from './pages/Auth'

function AppContent() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)

  // Setup keyboard shortcuts
  useNavigationShortcuts(() => setCommandPaletteOpen(true))

  return (
    <>
      <div className="noise-overlay" />
      <ErrorBoundary>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/services" replace />} />
            <Route path="/services" element={<Services />} />
            <Route path="/api" element={<ApiExplorer />} />
            <Route path="/traces" element={<Traces />} />
            <Route path="/metrics" element={<Metrics />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/flows" element={<Flows />} />
            <Route path="/database" element={<Database />} />
            <Route path="/workflows" element={<Workflows />} />
            <Route path="/cron" element={<CronPage />} />
            <Route path="/auth" element={<Auth />} />
          </Routes>
        </Layout>
      </ErrorBoundary>
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
    </>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AppContent />
      </QueryProvider>
    </ThemeProvider>
  )
}
