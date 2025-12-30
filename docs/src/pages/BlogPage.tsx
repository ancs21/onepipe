import { Link } from 'react-router-dom'
import { BlogLayout } from '../components/BlogLayout'
import { SEO } from '../components/SEO'
import { posts, formatDate, type BlogPost } from '../blog/posts'

function TagBadge({ tag, index = 0 }: { tag: string; index?: number }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase rounded-sm bg-[--bg-tertiary] text-[--text-tertiary] border border-[--border-subtle]"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {tag}
    </span>
  )
}

function FeaturedCard({ post }: { post: BlogPost }) {
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group block relative overflow-hidden rounded-sm bg-[--bg-secondary] border border-[--border-subtle] hover:border-[--border-default] transition-colors"
    >
      <div className="relative p-6 md:p-8">
        {/* Top row */}
        <div className="flex items-center justify-between mb-6">
          <span className="inline-flex items-center gap-2 px-2 py-1 text-[11px] font-bold uppercase tracking-widest rounded-sm bg-amber-500 text-black">
            <span className="w-1.5 h-1.5 rounded-sm bg-black/30" />
            Featured
          </span>
          <span className="text-sm text-[--text-muted] tabular-nums">{formatDate(post.date)}</span>
        </div>

        {/* Content */}
        <div className="max-w-3xl">
          <h2 className="text-2xl md:text-3xl font-semibold text-[--text-primary] mb-4 leading-tight tracking-tight group-hover:text-[--accent] transition-colors">
            {post.title}
          </h2>

          <p className="text-[--text-secondary] leading-relaxed mb-6">
            {post.description}
          </p>

          <div className="flex items-center justify-between pt-4 border-t border-[--border-subtle]">
            <div className="flex items-center gap-2">
              {post.tags.slice(0, 3).map((tag, i) => (
                <TagBadge key={tag} tag={tag} index={i} />
              ))}
            </div>

            <div className="flex items-center gap-3 text-sm text-[--text-muted]">
              <span>{post.readingTime}</span>
              <span className="inline-flex items-center gap-1.5 text-[--accent] font-medium">
                Read article
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function PostCard({ post, index }: { post: BlogPost; index: number }) {
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group block"
    >
      <article className="h-full p-5 rounded-sm bg-[--bg-secondary] border border-[--border-subtle] hover:border-[--border-default] transition-colors">
        {/* Meta */}
        <div className="flex items-center gap-3 text-sm text-[--text-muted] mb-3">
          <time dateTime={post.date} className="tabular-nums">{formatDate(post.date)}</time>
          <span className="w-1 h-1 rounded-sm bg-[--border-default]" />
          <span>{post.readingTime}</span>
        </div>

        {/* Title */}
        <h3 className="text-lg font-medium text-[--text-primary] mb-2 leading-snug group-hover:text-[--accent] transition-colors">
          {post.title}
        </h3>

        {/* Description */}
        <p className="text-[--text-tertiary] text-sm leading-relaxed mb-4 line-clamp-2">
          {post.description}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-[--border-subtle]">
          <div className="flex items-center gap-1.5 flex-wrap">
            {post.tags.slice(0, 2).map((tag, i) => (
              <TagBadge key={tag} tag={tag} index={i} />
            ))}
            {post.tags.length > 2 && (
              <span className="text-xs text-[--text-muted] ml-1">+{post.tags.length - 2}</span>
            )}
          </div>

          <span className="text-[--accent]">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </article>
    </Link>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  )
}

export function BlogPage() {
  const featuredPost = posts.find((p) => p.featured)
  const regularPosts = posts.filter((p) => !p.featured)

  return (
    <BlogLayout>
      <SEO
        title="Blog"
        description="Thoughts on building stream-first applications, event sourcing patterns, and the future of backend development with TypeScript and Bun."
      />

      {/* Header */}
      <header className="mb-12">
        <h1 className="text-3xl font-semibold text-[--text-primary] mb-3 tracking-tight">
          Blog
        </h1>
        <p className="text-[--text-secondary]">
          Deep dives into stream-first architecture, event sourcing patterns, and modern backend development.
        </p>
      </header>

      {/* Featured post */}
      {featuredPost && (
        <section className="mb-12">
          <FeaturedCard post={featuredPost} />
        </section>
      )}

      {/* Recent posts */}
      {regularPosts.length > 0 && (
        <section className="mb-12">
          <div className="flex items-center gap-4 mb-6">
            <h2 className="text-xs font-medium uppercase tracking-wider text-[--text-muted]">
              All Articles
            </h2>
            <div className="h-px flex-1 bg-[--border-subtle]" />
            <span className="text-xs text-[--text-muted] tabular-nums">{regularPosts.length} posts</span>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {regularPosts.map((post, index) => (
              <PostCard key={post.slug} post={post} index={index} />
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="p-6 rounded-sm bg-[--bg-secondary] border border-[--border-subtle]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-medium text-[--text-primary] mb-1">
              Stay in the loop
            </h3>
            <p className="text-sm text-[--text-muted]">
              Star us on GitHub to follow updates and new releases.
            </p>
          </div>

          <a
            href="https://github.com/ancs21/onepipe"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-sm bg-[--text-primary] text-[--bg-primary] text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <GitHubIcon />
            Star on GitHub
          </a>
        </div>
      </section>
    </BlogLayout>
  )
}
