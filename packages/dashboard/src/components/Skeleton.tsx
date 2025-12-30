import { type HTMLAttributes } from 'react'

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string | number
  height?: string | number
}

export function Skeleton({ width, height, className = '', style, ...props }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-bg-tertiary rounded ${className}`}
      style={{
        width: width,
        height: height,
        ...style,
      }}
      {...props}
    />
  )
}

export function SkeletonText({ lines = 1, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="1rem"
          className={i === lines - 1 && lines > 1 ? 'w-2/3' : 'w-full'}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`card p-4 space-y-3 ${className}`}>
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton height="0.875rem" className="w-1/3" />
          <Skeleton height="0.75rem" className="w-1/2" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 px-4 py-3 bg-bg-tertiary/30 border-b border-border">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} height="0.75rem" className="flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex gap-4 px-4 py-3 border-b border-border last:border-b-0"
        >
          {Array.from({ length: cols }).map((_, colIndex) => (
            <Skeleton key={colIndex} height="0.875rem" className="flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonList({ items = 5 }: { items?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary border border-border">
          <Skeleton className="w-8 h-8 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton height="0.875rem" className="w-2/3" />
            <Skeleton height="0.625rem" className="w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
