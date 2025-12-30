// Blog post metadata registry
// Frontmatter is defined here for type safety and easy access

export interface BlogPost {
  slug: string
  title: string
  description: string
  date: string
  author: string
  tags: string[]
  readingTime: string
  featured?: boolean
}

export const posts: BlogPost[] = [
  {
    slug: 'why-we-use-better-auth',
    title: 'Why We Use better-auth for Authentication',
    description: 'Authentication is critical but complex. Learn why OnePipe integrates with better-auth for type-safe, database-flexible authentication that runs on your infrastructure.',
    date: '2025-12-24',
    author: 'OnePipe Team',
    tags: ['tutorial', 'authentication', 'better-auth', 'security'],
    readingTime: '8 min read',
  },
  {
    slug: 'introducing-onepipe',
    title: 'Introducing OnePipe: Stream-First Development for Bun',
    description: 'Today we\'re launching OnePipe, a stream-first developer platform SDK that brings event sourcing, projections, and reactive patterns to TypeScript developers building on Bun.',
    date: '2025-12-23',
    author: 'OnePipe Team',
    tags: ['announcement', 'launch', 'bun'],
    readingTime: '5 min read',
    featured: true,
  },
  {
    slug: 'using-claude-code-to-build-features',
    title: 'Using Claude Code to Build Features with OnePipe',
    description: 'AI-assisted development meets stream-first architecture. Learn how to use Claude Code to rapidly implement OnePipe features - from idea to working code in minutes.',
    date: '2025-12-23',
    author: 'OnePipe Team',
    tags: ['tutorial', 'claude-code', 'ai', 'productivity', 'workflow'],
    readingTime: '10 min read',
  },
  {
    slug: 'setting-up-agents-md-for-claude-code',
    title: 'Setting Up AGENTS.md for Better AI-Assisted Development',
    description: 'Want Claude Code to understand your codebase instantly? Learn how to create an AGENTS.md file that gives AI assistants the context they need to write correct code.',
    date: '2025-12-22',
    author: 'OnePipe Team',
    tags: ['tutorial', 'claude-code', 'ai', 'developer-experience', 'documentation'],
    readingTime: '7 min read',
  },
  {
    slug: 'integrating-with-existing-frameworks',
    title: 'Integrating OnePipe with Hono, Elysia, Express & More',
    description: 'OnePipe works seamlessly with your existing stack. Learn how to add event sourcing, projections, and caching to Hono, Elysia, Express, and Fastify without rewriting your app.',
    date: '2025-12-21',
    author: 'OnePipe Team',
    tags: ['tutorial', 'hono', 'elysia', 'express', 'integration'],
    readingTime: '12 min read',
  },
  {
    slug: 'building-event-driven-apis',
    title: 'Building Event-Driven APIs with Flows and Projections',
    description: 'Learn how to build scalable, event-driven APIs using OnePipe\'s Flow and Projection primitives. We\'ll walk through a real-world example of building an order management system.',
    date: '2025-12-20',
    author: 'OnePipe Team',
    tags: ['tutorial', 'flows', 'projections', 'event-sourcing'],
    readingTime: '8 min read',
  },
  {
    slug: 'why-bun-for-backend',
    title: 'Why We Built OnePipe for Bun',
    description: 'Bun\'s speed, built-in SQLite, native PostgreSQL, Redis caching, and TypeScript support make it the perfect runtime for building modern backend applications.',
    date: '2025-12-19',
    author: 'OnePipe Team',
    tags: ['bun', 'typescript', 'postgresql', 'redis', 'architecture'],
    readingTime: '10 min read',
  },
]

export function getPost(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug)
}

export function getPostsByTag(tag: string): BlogPost[] {
  return posts.filter((p) => p.tags.includes(tag))
}

export function getFeaturedPosts(): BlogPost[] {
  return posts.filter((p) => p.featured)
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
