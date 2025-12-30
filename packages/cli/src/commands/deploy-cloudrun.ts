/**
 * Google Cloud Run Deployment Command
 *
 * Deploys OnePipe applications to Cloud Run
 *
 * @example
 * ```bash
 * onepipe deploy cloudrun --region us-central1 --min-instances 1 --max-instances 10
 * ```
 */

interface CloudRunDeployOptions {
  name: string
  region: string
  project?: string
  port: number
  minInstances: number
  maxInstances: number
  memory: string
  cpu: string
  timeout: number
  image?: string
  registry?: string
  tag: string
  env: Record<string, string>
  secrets: string[]
  infrastructure: InfrastructureNeeds
  generateOnly: boolean
  allowUnauthenticated: boolean
}

interface InfrastructureNeeds {
  postgres: boolean
  redis: boolean
  streams: boolean
}

/**
 * Run Cloud Run deployment
 */
export async function deployCloudRun(
  config: { name: string; port?: number; entrypoint?: string },
  args: string[]
): Promise<void> {
  // Parse options
  const options = parseCloudRunOptions(config, args)

  console.log(`
Deploying to Google Cloud Run...
  Service:       ${options.name}
  Region:        ${options.region}
  Min instances: ${options.minInstances}
  Max instances: ${options.maxInstances}
  CPU:           ${options.cpu}
  Memory:        ${options.memory}
`)

  // Analyze codebase for infrastructure needs
  const { analyzeEntrypoint, getInfrastructureTypes } = await import('../discovery')
  const entrypoint = config.entrypoint || './src/index.ts'

  try {
    const discovery = await analyzeEntrypoint(entrypoint)
    const infraTypes = getInfrastructureTypes(discovery)
    const primitiveTypes = discovery.primitives.map((p) => p.type)
    options.infrastructure = {
      postgres: infraTypes.includes('postgresql'),
      redis: infraTypes.includes('redis'),
      streams: primitiveTypes.includes('flow') || primitiveTypes.includes('projection'),
    }
  } catch {
    options.infrastructure = { postgres: false, redis: false, streams: false }
  }

  // Check for gcloud CLI
  const hasGcloud = await checkCommand('gcloud')
  if (!hasGcloud && !options.generateOnly) {
    console.error(`Error: gcloud CLI not found`)
    console.error(`Install: https://cloud.google.com/sdk/docs/install`)
    console.error(`Or use --generate-only to generate service.yaml`)
    process.exit(1)
  }

  // Generate Cloud Run service YAML
  const serviceYaml = generateCloudRunService(options)

  if (options.generateOnly) {
    console.log('--- cloudrun-service.yaml ---')
    console.log(serviceYaml)
    return
  }

  // Write service.yaml
  await Bun.write('./cloudrun-service.yaml', serviceYaml)
  console.log('Generated cloudrun-service.yaml')

  // Build and push Docker image if needed
  if (!options.image) {
    const imageName = await buildAndPushImage(options)
    options.image = imageName
  }

  // Deploy using gcloud
  await deployToCloudRun(options)
}

/**
 * Parse Cloud Run deployment options
 */
function parseCloudRunOptions(
  config: { name: string; port?: number },
  args: string[]
): CloudRunDeployOptions {
  return {
    name: getFlag(args, '--name') || config.name,
    region: getFlag(args, '--region') || 'us-central1',
    project: getFlag(args, '--project'),
    port: parseInt(getFlag(args, '--port') || String(config.port || 3000), 10),
    minInstances: parseInt(getFlag(args, '--min-instances') || '0', 10),
    maxInstances: parseInt(getFlag(args, '--max-instances') || '100', 10),
    memory: getFlag(args, '--memory') || '512Mi',
    cpu: getFlag(args, '--cpu') || '1',
    timeout: parseInt(getFlag(args, '--timeout') || '300', 10),
    image: getFlag(args, '--image'),
    registry: getFlag(args, '--registry', '-r'),
    tag: getFlag(args, '--tag') || 'latest',
    env: parseEnvFlags(args),
    secrets: parseSecretFlags(args),
    infrastructure: { postgres: false, redis: false, streams: false },
    generateOnly: args.includes('--generate-only'),
    allowUnauthenticated: args.includes('--allow-unauthenticated'),
  }
}

/**
 * Parse --env KEY=VALUE flags
 */
function parseEnvFlags(args: string[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' || args[i] === '-e') {
      const kv = args[i + 1]
      if (kv && kv.includes('=')) {
        const [key, ...valueParts] = kv.split('=')
        env[key] = valueParts.join('=')
      }
    }
  }
  return env
}

/**
 * Parse --secret SECRET_NAME:ENV_VAR flags
 */
function parseSecretFlags(args: string[]): string[] {
  const secrets: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--secret') {
      const value = args[i + 1]
      if (value) {
        secrets.push(value)
      }
    }
  }
  return secrets
}

/**
 * Generate Cloud Run service YAML
 */
function generateCloudRunService(options: CloudRunDeployOptions): string {
  const imageName = options.image ||
    (options.registry
      ? `${options.registry}/${options.name}:${options.tag}`
      : `gcr.io/${options.project || 'PROJECT_ID'}/${options.name}:${options.tag}`)

  // Build env vars section
  const envVars = [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT', value: String(options.port) },
    ...Object.entries(options.env).map(([name, value]) => ({ name, value })),
  ]

  // Add secret env vars
  const secretEnvVars: Array<{ name: string; secretName: string; key: string }> = []
  if (options.infrastructure.postgres) {
    secretEnvVars.push({
      name: 'DATABASE_URL',
      secretName: `${options.name}-secrets`,
      key: 'DATABASE_URL',
    })
  }
  if (options.infrastructure.redis) {
    secretEnvVars.push({
      name: 'REDIS_URL',
      secretName: `${options.name}-secrets`,
      key: 'REDIS_URL',
    })
  }

  // Add user-specified secrets
  for (const secret of options.secrets) {
    const [secretRef, envName] = secret.includes(':') ? secret.split(':') : [secret, secret]
    const [secretName, key] = secretRef.includes('/') ? secretRef.split('/') : [secretRef, 'latest']
    secretEnvVars.push({
      name: envName || secretName,
      secretName,
      key,
    })
  }

  const envBlock = envVars.map((e) => `            - name: ${e.name}
              value: "${e.value}"`).join('\n')

  const secretEnvBlock = secretEnvVars.length > 0
    ? secretEnvVars.map((e) => `            - name: ${e.name}
              valueFrom:
                secretKeyRef:
                  name: ${e.secretName}
                  key: ${e.key}`).join('\n')
    : ''

  return `# Generated by OnePipe CLI
# Deploy with: gcloud run services replace cloudrun-service.yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: ${options.name}
  labels:
    cloud.googleapis.com/location: ${options.region}
  annotations:
    run.googleapis.com/launch-stage: GA
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "${options.minInstances}"
        autoscaling.knative.dev/maxScale: "${options.maxInstances}"
        run.googleapis.com/cpu-throttling: "false"
        run.googleapis.com/startup-cpu-boost: "true"
    spec:
      containerConcurrency: 80
      timeoutSeconds: ${options.timeout}
      containers:
        - name: ${options.name}
          image: ${imageName}
          ports:
            - name: http1
              containerPort: ${options.port}
          env:
${envBlock}${secretEnvBlock ? '\n' + secretEnvBlock : ''}
          resources:
            limits:
              cpu: "${options.cpu}"
              memory: "${options.memory}"
          startupProbe:
            httpGet:
              path: /health
              port: ${options.port}
            initialDelaySeconds: 0
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /_health
              port: ${options.port}
            initialDelaySeconds: 0
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
  traffic:
    - percent: 100
      latestRevision: true
`
}

/**
 * Build and push Docker image to GCR
 */
async function buildAndPushImage(options: CloudRunDeployOptions): Promise<string> {
  const project = options.project || await getGcloudProject()
  if (!project) {
    throw new Error('No GCP project specified. Use --project or set gcloud default project.')
  }

  const registry = options.registry || `gcr.io/${project}`
  const imageName = `${registry}/${options.name}:${options.tag}`

  console.log(`Building Docker image: ${imageName}`)

  // Check if Dockerfile exists
  const dockerfileExists = await Bun.file('./Dockerfile').exists()
  if (!dockerfileExists) {
    console.log('Generating Dockerfile...')
    await generateDockerfile(options.port)
  }

  // Build with docker
  const buildProc = Bun.spawn(['docker', 'build', '-t', imageName, '.'], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (await buildProc.exited !== 0) {
    throw new Error('Docker build failed')
  }

  // Push to registry
  console.log(`Pushing to ${registry}...`)
  const pushProc = Bun.spawn(['docker', 'push', imageName], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (await pushProc.exited !== 0) {
    throw new Error('Docker push failed')
  }

  return imageName
}

/**
 * Deploy to Cloud Run using gcloud
 */
async function deployToCloudRun(options: CloudRunDeployOptions): Promise<void> {
  const args = [
    'run', 'services', 'replace',
    'cloudrun-service.yaml',
    '--region', options.region,
  ]

  if (options.project) {
    args.push('--project', options.project)
  }

  console.log(`Deploying to Cloud Run...`)
  console.log(`$ gcloud ${args.join(' ')}`)

  const proc = Bun.spawn(['gcloud', ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  })

  if (await proc.exited !== 0) {
    throw new Error('Cloud Run deployment failed')
  }

  // Set IAM policy for unauthenticated access if requested
  if (options.allowUnauthenticated) {
    console.log('Setting IAM policy for unauthenticated access...')
    const iamArgs = [
      'run', 'services', 'add-iam-policy-binding',
      options.name,
      '--region', options.region,
      '--member', 'allUsers',
      '--role', 'roles/run.invoker',
    ]
    if (options.project) {
      iamArgs.push('--project', options.project)
    }

    const iamProc = Bun.spawn(['gcloud', ...iamArgs], {
      stdout: 'inherit',
      stderr: 'inherit',
    })
    await iamProc.exited
  }

  // Get the service URL
  const urlArgs = [
    'run', 'services', 'describe',
    options.name,
    '--region', options.region,
    '--format', 'value(status.url)',
  ]
  if (options.project) {
    urlArgs.push('--project', options.project)
  }

  const urlProc = Bun.spawn(['gcloud', ...urlArgs], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const url = (await new Response(urlProc.stdout).text()).trim()

  console.log(`
Deployed to Cloud Run successfully!
  Service: ${options.name}
  Region:  ${options.region}
  URL:     ${url}
`)

  if (options.infrastructure.postgres || options.infrastructure.redis) {
    console.log(`
Infrastructure notes:
  Create secrets for database connections:
    gcloud secrets create ${options.name}-secrets --data-file=-
`)
  }
}

/**
 * Generate Dockerfile
 */
async function generateDockerfile(port: number): Promise<void> {
  const dockerfile = `# Generated by OnePipe CLI
FROM oven/bun:1 AS builder
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Build
RUN bun build ./src/index.ts --outdir ./dist --target bun --minify

# Production image
FROM oven/bun:1-slim
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
EXPOSE ${port}

CMD ["bun", "run", "./dist/index.js"]
`
  await Bun.write('./Dockerfile', dockerfile)
}

/**
 * Get current gcloud project
 */
async function getGcloudProject(): Promise<string | null> {
  try {
    const proc = Bun.spawn(['gcloud', 'config', 'get-value', 'project'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const output = (await new Response(proc.stdout).text()).trim()
    return output || null
  } catch {
    return null
  }
}

/**
 * Check if command exists
 */
async function checkCommand(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', command], { stdout: 'pipe', stderr: 'pipe' })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

/**
 * Get flag value
 */
function getFlag(args: string[], long: string, short?: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === long || args[i] === short) {
      return args[i + 1]
    }
    if (args[i].startsWith(`${long}=`)) {
      return args[i].split('=')[1]
    }
  }
  return undefined
}
