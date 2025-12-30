import { useParams, Link, useNavigate } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import { BlogLayout } from '../components/BlogLayout'
import { SEO, ArticleSchema } from '../components/SEO'
import { getPost, posts, formatDate, type BlogPost } from '../blog/posts'

// Lazy load blog post MDX content
const blogContent: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  'why-we-use-better-auth': lazy(() => import('../blog/why-we-use-better-auth.mdx')),
  'introducing-onepipe': lazy(() => import('../blog/introducing-onepipe.mdx')),
  'using-claude-code-to-build-features': lazy(() => import('../blog/using-claude-code-to-build-features.mdx')),
  'setting-up-agents-md-for-claude-code': lazy(() => import('../blog/setting-up-agents-md-for-claude-code.mdx')),
  'integrating-with-existing-frameworks': lazy(() => import('../blog/integrating-with-existing-frameworks.mdx')),
  'building-event-driven-apis': lazy(() => import('../blog/building-event-driven-apis.mdx')),
  'why-bun-for-backend': lazy(() => import('../blog/why-bun-for-backend.mdx')),
}

function LoadingSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="space-y-4">
        <div className="h-4 w-20 skeleton rounded" />
        <div className="h-12 w-4/5 skeleton rounded" />
        <div className="flex items-center gap-4">
          <div className="h-4 w-28 skeleton rounded" />
          <div className="h-4 w-20 skeleton rounded" />
        </div>
      </div>
      <div className="h-px bg-[var(--border-subtle)]" />
      <div className="space-y-4">
        <div className="h-5 w-full skeleton rounded" />
        <div className="h-5 w-[95%] skeleton rounded" />
        <div className="h-5 w-[85%] skeleton rounded" />
      </div>
      <div className="h-56 w-full skeleton rounded-xl" />
      <div className="space-y-4">
        <div className="h-5 w-full skeleton rounded" />
        <div className="h-5 w-[90%] skeleton rounded" />
      </div>
    </div>
  )
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center px-3 py-1.5 text-[11px] font-medium tracking-wide uppercase rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] border border-[var(--border-subtle)] transition-colors hover:border-[var(--accent)]/30 hover:text-[var(--accent)]">
      {tag}
    </span>
  )
}

function PostNavigation({ currentSlug }: { currentSlug: string }) {
  const currentIndex = posts.findIndex((p) => p.slug === currentSlug)
  const prevPost = currentIndex > 0 ? posts[currentIndex - 1] : null
  const nextPost = currentIndex < posts.length - 1 ? posts[currentIndex + 1] : null

  if (!prevPost && !nextPost) return null

  return (
    <nav className="mt-20 pt-10 border-t border-[var(--border-subtle)]">
      <div className="grid md:grid-cols-2 gap-6">
        {prevPost ? (
          <Link
            to={`/blog/${prevPost.slug}`}
            className="group flex flex-col p-6 rounded-2xl bg-[var(--bg-secondary)]/50 border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-secondary)] transition-all duration-300"
          >
            <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)] mb-3">
              <ArrowLeftIcon />
              Previous article
            </span>
            <span className="text-base font-semibold text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors duration-300 line-clamp-2 leading-snug">
              {prevPost.title}
            </span>
          </Link>
        ) : (
          <div />
        )}
        {nextPost && (
          <Link
            to={`/blog/${nextPost.slug}`}
            className="group flex flex-col items-end text-right p-6 rounded-2xl bg-[var(--bg-secondary)]/50 border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-secondary)] transition-all duration-300"
          >
            <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)] mb-3">
              Next article
              <ArrowRightIcon />
            </span>
            <span className="text-base font-semibold text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors duration-300 line-clamp-2 leading-snug">
              {nextPost.title}
            </span>
          </Link>
        )}
      </div>
    </nav>
  )
}

function NotFound() {
  const navigate = useNavigate()

  return (
    <BlogLayout>
      <div className="py-24 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] mb-8">
          <svg viewBox="0 0 24 24" className="w-10 h-10 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-3 tracking-tight">Post Not Found</h1>
        <p className="text-lg text-[var(--text-tertiary)] mb-10 max-w-md mx-auto">
          The article you're looking for doesn't exist or has been moved.
        </p>
        <button
          onClick={() => navigate('/blog')}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent-muted)] text-[var(--accent)] font-semibold hover:bg-[var(--accent)]/20 transition-colors"
        >
          <ArrowLeftIcon />
          Back to blog
        </button>
      </div>
    </BlogLayout>
  )
}

function PostHeader({ post }: { post: BlogPost }) {
  return (
    <header className="mb-12 md:mb-16">
      {/* Back link */}
      <Link
        to="/blog"
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors mb-10 group"
      >
        <span className="w-8 h-8 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-center group-hover:border-[var(--border-default)] transition-colors">
          <ArrowLeftIcon />
        </span>
        Back to blog
      </Link>

      {/* Tags */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {post.tags.map((tag) => (
          <TagBadge key={tag} tag={tag} />
        ))}
      </div>

      {/* Title */}
      <h1 className="text-4xl md:text-5xl lg:text-[3.5rem] font-black text-[var(--text-primary)] leading-[1.1] tracking-tight mb-8">
        {post.title}
      </h1>

      {/* Meta bar */}
      <div className="flex flex-wrap items-center gap-6 pb-10 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-hover)] flex items-center justify-center text-white font-bold text-sm">
            {post.author.charAt(0)}
          </div>
          <div>
            <div className="font-semibold text-[var(--text-primary)]">{post.author}</div>
            <div className="text-sm text-[var(--text-muted)]">Author</div>
          </div>
        </div>

        <div className="h-10 w-px bg-[var(--border-subtle)] hidden sm:block" />

        <div className="flex items-center gap-6 text-sm">
          <div>
            <div className="font-semibold text-[var(--text-primary)] tabular-nums">{formatDate(post.date)}</div>
            <div className="text-[var(--text-muted)]">Published</div>
          </div>
          <div>
            <div className="font-semibold text-[var(--text-primary)]">{post.readingTime}</div>
            <div className="text-[var(--text-muted)]">Read time</div>
          </div>
        </div>
      </div>
    </header>
  )
}

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>()
  const post = slug ? getPost(slug) : undefined
  const Content = slug ? blogContent[slug] : undefined

  // Scroll to top on navigation
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [slug])

  if (!post || !Content) {
    return <NotFound />
  }

  const postUrl = `https://onepipe.dev/blog/${post.slug}`

  return (
    <BlogLayout>
      <SEO
        title={post.title}
        description={post.description}
        type="article"
        publishedTime={post.date}
        author={post.author}
        tags={post.tags}
        url={postUrl}
      />
      <ArticleSchema
        title={post.title}
        description={post.description}
        publishedTime={post.date}
        author={post.author}
        url={postUrl}
      />

      <article>
        <PostHeader post={post} />

        <div className="prose prose-lg">
          <Suspense fallback={<LoadingSkeleton />}>
            <Content />
          </Suspense>
        </div>

        <PostNavigation currentSlug={post.slug} />
      </article>
    </BlogLayout>
  )
}
