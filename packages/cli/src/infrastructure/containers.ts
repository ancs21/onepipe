/**
 * Container Runtime Detection
 *
 * Supports Apple Container (macOS) and Docker
 */

export type ContainerRuntime = 'apple' | 'docker' | null

async function checkCommand(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', command], { stdout: 'pipe', stderr: 'pipe' })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

/**
 * Detect available container runtime
 * Prefers Apple Container on macOS (faster, lighter, native)
 */
export async function detectContainerRuntime(): Promise<ContainerRuntime> {
  // Prefer Apple Container on macOS
  if (process.platform === 'darwin' && (await checkCommand('container'))) {
    // Check if Apple container system is running
    const check = Bun.spawn(['container', 'system', 'info'], { stdout: 'pipe', stderr: 'pipe' })
    if ((await check.exited) === 0) {
      return 'apple'
    }
    // Try to start Apple container system
    const start = Bun.spawn(['container', 'system', 'start'], { stdout: 'pipe', stderr: 'pipe' })
    if ((await start.exited) === 0) {
      return 'apple'
    }
  }

  // Fallback to Docker
  if (await checkCommand('docker')) {
    return 'docker'
  }

  return null
}

/**
 * Run a container with Apple Container
 */
export async function runContainerApple(options: {
  name: string
  image: string
  env?: Record<string, string>
  ports?: { host: number; container: number }[]
}): Promise<{ ip: string }> {
  const { name, image, env = {} } = options

  // Check if container exists
  const list = Bun.spawn(['container', 'ls', '-a'], { stdout: 'pipe' })
  const output = await new Response(list.stdout).text()

  if (output.includes(name)) {
    // Start if not running
    if (!output.includes('running')) {
      await Bun.spawn(['container', 'start', name]).exited
    }
  } else {
    // Create new container
    const args = ['container', 'run', '-d', '--name', name]

    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`)
    }

    args.push(image)
    await Bun.spawn(args).exited
  }

  // Get container IP
  const inspect = Bun.spawn(['container', 'inspect', name], { stdout: 'pipe' })
  const info = JSON.parse(await new Response(inspect.stdout).text())
  const address = info[0]?.networks?.[0]?.address || ''
  const ip = address.split('/')[0] || 'localhost'

  return { ip }
}

/**
 * Run a container with Docker
 */
export async function runContainerDocker(options: {
  name: string
  image: string
  env?: Record<string, string>
  ports?: { host: number; container: number }[]
}): Promise<{ ip: string }> {
  const { name, image, env = {}, ports = [] } = options

  // Check if container is running
  const running = Bun.spawn(['docker', 'ps', '-q', '-f', `name=${name}`], { stdout: 'pipe' })
  if ((await new Response(running.stdout).text()).trim()) {
    return { ip: 'localhost' }
  }

  // Check if container exists but not running
  const exists = Bun.spawn(['docker', 'ps', '-aq', '-f', `name=${name}`], { stdout: 'pipe' })
  if ((await new Response(exists.stdout).text()).trim()) {
    await Bun.spawn(['docker', 'start', name]).exited
  } else {
    // Create new container
    const args = ['docker', 'run', '-d', '--name', name]

    for (const { host, container } of ports) {
      args.push('-p', `${host}:${container}`)
    }

    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`)
    }

    args.push(image)
    await Bun.spawn(args).exited
  }

  return { ip: 'localhost' }
}

/**
 * Execute command in container
 */
export async function execInContainer(
  runtime: ContainerRuntime,
  containerName: string,
  command: string[]
): Promise<{ exitCode: number; output: string }> {
  if (!runtime) throw new Error('No container runtime available')

  const cmd = runtime === 'apple' ? ['container', 'exec', containerName, ...command] : ['docker', 'exec', containerName, ...command]

  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const exitCode = await proc.exited
  const output = await new Response(proc.stdout).text()

  return { exitCode, output }
}

/**
 * Wait for container health check
 */
export async function waitForContainer(
  runtime: ContainerRuntime,
  containerName: string,
  healthCheck: string[],
  maxAttempts = 30,
  intervalMs = 1000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const { exitCode } = await execInContainer(runtime, containerName, healthCheck)
    if (exitCode === 0) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Container ${containerName} health check failed after ${maxAttempts} attempts`)
}
