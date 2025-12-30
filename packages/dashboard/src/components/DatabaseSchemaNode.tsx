import { memo, type ReactNode } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Key } from 'lucide-react'

// Types
export interface SchemaColumn {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
}

export interface DatabaseSchemaNodeData extends Record<string, unknown> {
  label: string
  schema: SchemaColumn[]
  type?: 'table' | 'view'
}

// Labeled Handle component
function LabeledHandle({
  id,
  type,
  position,
}: {
  id: string
  title?: string
  type: 'source' | 'target'
  position: Position
}) {
  return (
    <Handle
      id={id}
      type={type}
      position={position}
      className="!w-2 !h-2 !bg-amber-500 !border-amber-600"
      style={{
        [position === Position.Left ? 'left' : 'right']: '-4px',
      }}
    />
  )
}

// Database Schema Node wrapper
function DatabaseSchemaNodeWrapper({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`
        bg-bg-secondary border border-border rounded-lg shadow-xl overflow-hidden
        min-w-[220px] max-w-[320px]
        ${className}
      `}
    >
      {children}
    </div>
  )
}

// Header
function DatabaseSchemaNodeHeader({ children, type }: { children: ReactNode; type?: 'table' | 'view' }) {
  return (
    <div className="px-3 py-2.5 bg-bg-tertiary border-b border-border flex items-center justify-between">
      <span className="font-mono font-semibold text-sm text-amber-600 dark:text-amber-400">{children}</span>
      {type === 'view' && (
        <span className="text-[10px] px-1.5 py-0.5 bg-bg-primary text-text-muted rounded uppercase tracking-wide">
          view
        </span>
      )}
    </div>
  )
}

// Body (table container)
function DatabaseSchemaNodeBody({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border-subtle">
      {children}
    </div>
  )
}

// Table Row
function DatabaseSchemaTableRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between px-2 py-1.5 hover:bg-bg-tertiary ${className}`}>
      {children}
    </div>
  )
}

// Table Cell
function DatabaseSchemaTableCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center ${className}`}>
      {children}
    </div>
  )
}

// Define the node type for React Flow
export type DatabaseSchemaNodeType = Node<DatabaseSchemaNodeData, 'databaseSchema'>

// Main Database Schema Node component
export const DatabaseSchemaNode = memo(({ data }: NodeProps<DatabaseSchemaNodeType>) => {
  return (
    <DatabaseSchemaNodeWrapper>
      <DatabaseSchemaNodeHeader type={data.type}>{data.label}</DatabaseSchemaNodeHeader>
      <DatabaseSchemaNodeBody>
        {data.schema.map((column) => (
          <DatabaseSchemaTableRow key={column.name}>
            <DatabaseSchemaTableCell className="gap-1.5 relative">
              <LabeledHandle
                id={`${column.name}-target`}
                type="target"
                position={Position.Left}
              />
              {column.primaryKey && (
                <Key className="w-3 h-3 text-amber-500 ml-2" />
              )}
              <span className={`text-xs font-mono ${column.primaryKey ? 'font-semibold text-text-primary' : 'text-text-secondary'} ${!column.primaryKey ? 'ml-2' : ''}`}>
                {column.name}
              </span>
              {column.nullable && (
                <span className="text-[10px] text-text-muted ml-0.5">?</span>
              )}
            </DatabaseSchemaTableCell>
            <DatabaseSchemaTableCell className="relative">
              <span className="text-xs text-text-muted font-mono">{column.type}</span>
              <LabeledHandle
                id={`${column.name}-source`}
                type="source"
                position={Position.Right}
              />
            </DatabaseSchemaTableCell>
          </DatabaseSchemaTableRow>
        ))}
      </DatabaseSchemaNodeBody>
    </DatabaseSchemaNodeWrapper>
  )
})

DatabaseSchemaNode.displayName = 'DatabaseSchemaNode'

export {
  DatabaseSchemaNodeWrapper,
  DatabaseSchemaNodeHeader,
  DatabaseSchemaNodeBody,
  DatabaseSchemaTableRow,
  DatabaseSchemaTableCell,
  LabeledHandle,
}
