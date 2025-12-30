/**
 * UI Module
 *
 * Beautiful CLI output for OnePipe
 */

// Terminal utilities (colors, symbols, TTY detection)
export {
  supportsColor,
  c,
  s,
  timestamp,
  ts,
  pad,
  clearLine,
  cursorUp,
  hideCursor,
  showCursor,
} from './terminal'

// Spinner utilities
export {
  createSpinner,
  createTimestampedSpinner,
  withSpinner,
  type Spinner,
} from './spinner'

// Box drawing utilities
export {
  box,
  section,
  keyValueBox,
  errorBox,
  successBox,
  headerBox,
  hr,
} from './box'

// High-level output functions
export {
  printHeader,
  printEntrypoint,
  printDiscovery,
  printProvisioning,
  printProvisionedService,
  printProvisionResult,
  printReady,
  printError,
  printWarning,
  printInfo,
} from './output'
