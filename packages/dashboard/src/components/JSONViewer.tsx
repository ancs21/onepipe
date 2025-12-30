import { useState, useMemo } from 'react'
import { ChevronRight, ChevronDown, Copy, Check } from 'lucide-react'

interface JSONViewerProps {
  data: unknown
  collapsed?: boolean
  rootName?: string
}

function JSONValue({
  value,
  depth = 0,
  path = '',
}: {
  value: unknown
  depth?: number
  path?: string
}) {
  const [isExpanded, setIsExpanded] = useState(depth < 2)

  if (value === null) {
    return <span className="text-text-muted italic">null</span>
  }

  if (value === undefined) {
    return <span className="text-text-muted italic">undefined</span>
  }

  if (typeof value === 'boolean') {
    return <span className="text-violet-600 dark:text-violet-400">{String(value)}</span>
  }

  if (typeof value === 'number') {
    return <span className="text-amber-600 dark:text-amber-400">{value}</span>
  }

  if (typeof value === 'string') {
    // Check if it's a URL
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-600 dark:text-emerald-400 hover:underline"
        >
          "{value}"
        </a>
      )
    }
    return <span className="text-emerald-600 dark:text-emerald-400">"{value}"</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-text-secondary">[]</span>
    }

    return (
      <div className="inline">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="inline-flex items-center text-text-muted hover:text-text-secondary"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        <span className="text-text-secondary">[</span>
        {!isExpanded && (
          <span className="text-text-muted text-xs ml-1">{value.length} items</span>
        )}
        {isExpanded && (
          <div className="ml-4 border-l border-border pl-2">
            {value.map((item, index) => (
              <div key={index} className="my-0.5">
                <span className="text-text-muted text-xs mr-2">{index}:</span>
                <JSONValue value={item} depth={depth + 1} path={`${path}[${index}]`} />
                {index < value.length - 1 && <span className="text-text-muted">,</span>}
              </div>
            ))}
          </div>
        )}
        <span className="text-text-secondary">]</span>
      </div>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      return <span className="text-text-secondary">{'{}'}</span>
    }

    return (
      <div className="inline">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="inline-flex items-center text-text-muted hover:text-text-secondary"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
        <span className="text-text-secondary">{'{'}</span>
        {!isExpanded && (
          <span className="text-text-muted text-xs ml-1">{entries.length} keys</span>
        )}
        {isExpanded && (
          <div className="ml-4 border-l border-border pl-2">
            {entries.map(([key, val], index) => (
              <div key={key} className="my-0.5">
                <span className="text-blue-600 dark:text-blue-400">"{key}"</span>
                <span className="text-text-muted">: </span>
                <JSONValue value={val} depth={depth + 1} path={`${path}.${key}`} />
                {index < entries.length - 1 && <span className="text-text-muted">,</span>}
              </div>
            ))}
          </div>
        )}
        <span className="text-text-secondary">{'}'}</span>
      </div>
    )
  }

  return <span className="text-text-primary">{String(value)}</span>
}

export function JSONViewer({ data, collapsed = false, rootName }: JSONViewerProps) {
  const [copied, setCopied] = useState(false)

  const jsonString = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return String(data)
    }
  }, [data])

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-bg-tertiary/80 opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-text-secondary"
        title="Copy JSON"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <div className="p-3 bg-bg-primary border border-border rounded-lg overflow-auto max-h-96 font-mono text-xs">
        {rootName && (
          <span className="text-text-muted">{rootName}: </span>
        )}
        <JSONValue value={data} depth={collapsed ? 0 : 1} />
      </div>
    </div>
  )
}
