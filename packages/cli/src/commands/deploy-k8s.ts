/**
 * Kubernetes Deployment Command
 *
 * Generates Kubernetes manifests for OnePipe applications
 *
 * @example
 * ```bash
 * onepipe deploy kubernetes --replicas 3 --cpu 500m --memory 512Mi
 * ```
 */

interface K8sDeployOptions {
  name: string
  namespace: string
  replicas: number
  port: number
  cpu: string
  memory: string
  image?: string
  registry?: string
  tag: string
  env: Record<string, string>
  infrastructure: InfrastructureNeeds
  outputDir: string
  dryRun: boolean
  // Ingress options
  ingress?: 'traefik' | 'nginx' | 'none'
  domain?: string
  tls?: boolean
}

interface InfrastructureNeeds {
  postgres: boolean
  redis: boolean
  streams: boolean
}

/**
 * Run K8s deployment
 */
export async function deployKubernetes(
  config: { name: string; port?: number; entrypoint?: string },
  args: string[]
): Promise<void> {
  // Parse options
  const options = parseK8sOptions(config, args)

  console.log(`
Generating Kubernetes manifests...
  Name:      ${options.name}
  Namespace: ${options.namespace}
  Replicas:  ${options.replicas}
  CPU:       ${options.cpu}
  Memory:    ${options.memory}
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
    // Fallback to minimal infrastructure
    options.infrastructure = { postgres: false, redis: false, streams: false }
  }

  // Generate manifests
  const manifests = generateK8sManifests(options)

  if (options.dryRun) {
    // Print to stdout
    console.log('--- deployment.yaml ---')
    console.log(manifests.deployment)
    console.log('\n--- service.yaml ---')
    console.log(manifests.service)
    console.log('\n--- configmap.yaml ---')
    console.log(manifests.configmap)
    console.log('\n--- hpa.yaml ---')
    console.log(manifests.hpa)
    if (manifests.ingress) {
      console.log('\n--- ingress.yaml ---')
      console.log(manifests.ingress)
    }
    return
  }

  // Write files
  const { mkdir } = await import('fs/promises')
  await mkdir(options.outputDir, { recursive: true })

  await Bun.write(`${options.outputDir}/deployment.yaml`, manifests.deployment)
  await Bun.write(`${options.outputDir}/service.yaml`, manifests.service)
  await Bun.write(`${options.outputDir}/configmap.yaml`, manifests.configmap)
  await Bun.write(`${options.outputDir}/hpa.yaml`, manifests.hpa)

  // Write ingress if enabled
  if (manifests.ingress) {
    await Bun.write(`${options.outputDir}/ingress.yaml`, manifests.ingress)
  }

  // Generate kustomization.yaml for easy kubectl apply
  await Bun.write(`${options.outputDir}/kustomization.yaml`, generateKustomization(options))

  const ingressNote = manifests.ingress ? `  ingress.yaml   - ${options.ingress === 'traefik' ? 'Traefik IngressRoute' : 'Kubernetes Ingress'}\n` : ''

  console.log(`
Generated Kubernetes manifests in ${options.outputDir}/:
  deployment.yaml  - Application deployment
  service.yaml     - ClusterIP service
  configmap.yaml   - Environment configuration
  hpa.yaml         - Horizontal Pod Autoscaler
${ingressNote}  kustomization.yaml

Apply with:
  kubectl apply -k ${options.outputDir}/

Or apply individually:
  kubectl apply -f ${options.outputDir}/
`)

  // Print infrastructure notes
  if (options.infrastructure.postgres || options.infrastructure.redis) {
    console.log(`Infrastructure requirements detected:`)
    if (options.infrastructure.postgres) {
      console.log(`  - PostgreSQL: Set DATABASE_URL in your secret`)
    }
    if (options.infrastructure.redis) {
      console.log(`  - Redis: Set REDIS_URL in your secret`)
    }
    console.log(`
Create a secret for sensitive values:
  kubectl create secret generic ${options.name}-secrets \\
    --from-literal=DATABASE_URL=postgres://... \\
    --from-literal=REDIS_URL=redis://... \\
    -n ${options.namespace}
`)
  }
}

/**
 * Parse K8s deployment options from args
 */
function parseK8sOptions(
  config: { name: string; port?: number },
  args: string[]
): K8sDeployOptions {
  const ingressFlag = getFlag(args, '--ingress')
  return {
    name: getFlag(args, '--name') || config.name,
    namespace: getFlag(args, '--namespace', '-n') || 'default',
    replicas: parseInt(getFlag(args, '--replicas') || '2', 10),
    port: parseInt(getFlag(args, '--port') || String(config.port || 3000), 10),
    cpu: getFlag(args, '--cpu') || '250m',
    memory: getFlag(args, '--memory') || '256Mi',
    image: getFlag(args, '--image'),
    registry: getFlag(args, '--registry', '-r'),
    tag: getFlag(args, '--tag') || 'latest',
    env: parseEnvFlags(args),
    infrastructure: { postgres: false, redis: false, streams: false },
    outputDir: getFlag(args, '--output', '-o') || './k8s',
    dryRun: args.includes('--dry-run'),
    // Ingress options
    ingress: ingressFlag as 'traefik' | 'nginx' | 'none' | undefined,
    domain: getFlag(args, '--domain'),
    tls: !args.includes('--no-tls'),
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
 * Generate all K8s manifests
 */
function generateK8sManifests(options: K8sDeployOptions): {
  deployment: string
  service: string
  configmap: string
  hpa: string
  ingress?: string
} {
  return {
    deployment: generateDeployment(options),
    service: generateService(options),
    configmap: generateConfigMap(options),
    hpa: generateHPA(options),
    ingress: options.ingress && options.ingress !== 'none' ? generateIngress(options) : undefined,
  }
}

/**
 * Generate Deployment manifest
 */
function generateDeployment(options: K8sDeployOptions): string {
  const imageName = options.image ||
    (options.registry
      ? `${options.registry}/${options.name}:${options.tag}`
      : `${options.name}:${options.tag}`)

  const secretEnvVars = []
  if (options.infrastructure.postgres) {
    secretEnvVars.push({
      name: 'DATABASE_URL',
      secretKeyRef: { name: `${options.name}-secrets`, key: 'DATABASE_URL' },
    })
  }
  if (options.infrastructure.redis) {
    secretEnvVars.push({
      name: 'REDIS_URL',
      secretKeyRef: { name: `${options.name}-secrets`, key: 'REDIS_URL' },
    })
  }

  const envBlock = secretEnvVars.length > 0
    ? `
        env:
        - name: NODE_ENV
          value: "production"
        - name: PORT
          value: "${options.port}"
${secretEnvVars.map(e => `        - name: ${e.name}
          valueFrom:
            secretKeyRef:
              name: ${e.secretKeyRef.name}
              key: ${e.secretKeyRef.key}`).join('\n')}`
    : `
        env:
        - name: NODE_ENV
          value: "production"
        - name: PORT
          value: "${options.port}"`

  return `# Generated by OnePipe CLI
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${options.name}
  namespace: ${options.namespace}
  labels:
    app: ${options.name}
    app.kubernetes.io/name: ${options.name}
    app.kubernetes.io/managed-by: onepipe
spec:
  replicas: ${options.replicas}
  selector:
    matchLabels:
      app: ${options.name}
  template:
    metadata:
      labels:
        app: ${options.name}
    spec:
      containers:
      - name: ${options.name}
        image: ${imageName}
        imagePullPolicy: Always
        ports:
        - containerPort: ${options.port}
          name: http
          protocol: TCP${envBlock}
        envFrom:
        - configMapRef:
            name: ${options.name}-config
        resources:
          requests:
            cpu: ${options.cpu}
            memory: ${options.memory}
          limits:
            cpu: ${parseInt(options.cpu) * 2}m
            memory: ${parseInt(options.memory) * 2}Mi
        livenessProbe:
          httpGet:
            path: /_health
            port: http
          initialDelaySeconds: 5
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /ready
            port: http
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        startupProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 3
          periodSeconds: 5
          failureThreshold: 30
      terminationGracePeriodSeconds: 30
`
}

/**
 * Generate Service manifest
 */
function generateService(options: K8sDeployOptions): string {
  return `# Generated by OnePipe CLI
apiVersion: v1
kind: Service
metadata:
  name: ${options.name}
  namespace: ${options.namespace}
  labels:
    app: ${options.name}
    app.kubernetes.io/name: ${options.name}
    app.kubernetes.io/managed-by: onepipe
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: ${options.port}
    protocol: TCP
    name: http
  selector:
    app: ${options.name}
`
}

/**
 * Generate ConfigMap manifest
 */
function generateConfigMap(options: K8sDeployOptions): string {
  const envEntries = Object.entries(options.env)
    .map(([key, value]) => `  ${key}: "${value}"`)
    .join('\n')

  const dataBlock = envEntries
    ? `data:\n${envEntries}`
    : `data:
  # Add non-sensitive environment variables here
  LOG_LEVEL: "info"
  OTEL_SERVICE_NAME: "${options.name}"`

  return `# Generated by OnePipe CLI
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${options.name}-config
  namespace: ${options.namespace}
  labels:
    app: ${options.name}
    app.kubernetes.io/name: ${options.name}
    app.kubernetes.io/managed-by: onepipe
${dataBlock}
`
}

/**
 * Generate HPA manifest
 */
function generateHPA(options: K8sDeployOptions): string {
  return `# Generated by OnePipe CLI
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${options.name}
  namespace: ${options.namespace}
  labels:
    app: ${options.name}
    app.kubernetes.io/name: ${options.name}
    app.kubernetes.io/managed-by: onepipe
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${options.name}
  minReplicas: ${Math.max(1, Math.floor(options.replicas / 2))}
  maxReplicas: ${options.replicas * 3}
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 25
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 15
      - type: Pods
        value: 4
        periodSeconds: 15
      selectPolicy: Max
`
}

/**
 * Generate Ingress manifest
 */
function generateIngress(options: K8sDeployOptions): string {
  const domain = options.domain || `${options.name}.example.com`

  if (options.ingress === 'traefik') {
    return generateTraefikIngress(options, domain)
  }

  // Standard Kubernetes Ingress (nginx or other)
  return generateStandardIngress(options, domain)
}

/**
 * Generate Traefik IngressRoute (CRD)
 */
function generateTraefikIngress(options: K8sDeployOptions, domain: string): string {
  const tlsBlock = options.tls
    ? `  tls:
    certResolver: letsencrypt`
    : ''

  return `# Generated by OnePipe CLI
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: ${options.name}
  namespace: ${options.namespace}
  labels:
    app: ${options.name}
    app.kubernetes.io/name: ${options.name}
    app.kubernetes.io/managed-by: onepipe
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(\`${domain}\`)
      kind: Rule
      services:
        - name: ${options.name}
          port: 80
      middlewares:
        - name: ${options.name}-ratelimit
${tlsBlock}
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: ${options.name}-ratelimit
  namespace: ${options.namespace}
spec:
  rateLimit:
    average: 100
    burst: 50
`
}

/**
 * Generate standard Kubernetes Ingress
 */
function generateStandardIngress(options: K8sDeployOptions, domain: string): string {
  const tlsBlock = options.tls
    ? `  tls:
    - hosts:
        - ${domain}
      secretName: ${options.name}-tls`
    : ''

  const annotations = options.ingress === 'nginx'
    ? `    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/ssl-redirect: "${options.tls}"
    cert-manager.io/cluster-issuer: letsencrypt-prod`
    : `    kubernetes.io/ingress.class: ${options.ingress || 'nginx'}
    cert-manager.io/cluster-issuer: letsencrypt-prod`

  return `# Generated by OnePipe CLI
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${options.name}
  namespace: ${options.namespace}
  labels:
    app: ${options.name}
    app.kubernetes.io/name: ${options.name}
    app.kubernetes.io/managed-by: onepipe
  annotations:
${annotations}
spec:
${tlsBlock}
  rules:
    - host: ${domain}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${options.name}
                port:
                  number: 80
`
}

/**
 * Generate kustomization.yaml
 */
function generateKustomization(options: K8sDeployOptions): string {
  const ingressResource = options.ingress && options.ingress !== 'none' ? '\n- ingress.yaml' : ''

  return `# Generated by OnePipe CLI
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: ${options.namespace}

resources:
- deployment.yaml
- service.yaml
- configmap.yaml
- hpa.yaml${ingressResource}

commonLabels:
  app.kubernetes.io/name: ${options.name}
  app.kubernetes.io/managed-by: onepipe
`
}

/**
 * Get flag value from args
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
