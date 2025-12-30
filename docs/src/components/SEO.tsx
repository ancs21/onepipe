import { useEffect } from 'react'

interface SEOProps {
  title: string
  description: string
  type?: 'website' | 'article'
  publishedTime?: string
  modifiedTime?: string
  author?: string
  tags?: string[]
  image?: string
  url?: string
}

export function SEO({
  title,
  description,
  type = 'website',
  publishedTime,
  modifiedTime,
  author,
  tags = [],
  image,
  url,
}: SEOProps) {
  useEffect(() => {
    // Update document title
    const fullTitle = `${title} | OnePipe Blog`
    document.title = fullTitle

    // Helper to set or create meta tag
    const setMeta = (name: string, content: string, property = false) => {
      const attr = property ? 'property' : 'name'
      let meta = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement
      if (!meta) {
        meta = document.createElement('meta')
        meta.setAttribute(attr, name)
        document.head.appendChild(meta)
      }
      meta.content = content
    }

    // Basic meta
    setMeta('description', description)

    // Open Graph
    setMeta('og:title', fullTitle, true)
    setMeta('og:description', description, true)
    setMeta('og:type', type, true)
    if (url) setMeta('og:url', url, true)
    if (image) setMeta('og:image', image, true)
    setMeta('og:site_name', 'OnePipe', true)

    // Twitter Card
    setMeta('twitter:card', 'summary_large_image')
    setMeta('twitter:title', fullTitle)
    setMeta('twitter:description', description)
    if (image) setMeta('twitter:image', image)

    // Article specific
    if (type === 'article') {
      if (publishedTime) setMeta('article:published_time', publishedTime, true)
      if (modifiedTime) setMeta('article:modified_time', modifiedTime, true)
      if (author) setMeta('article:author', author, true)
      tags.forEach((tag, i) => {
        setMeta(`article:tag:${i}`, tag, true)
      })
    }

    // Cleanup
    return () => {
      document.title = 'OnePipe - Stream-First Developer Platform for Bun'
    }
  }, [title, description, type, publishedTime, modifiedTime, author, tags, image, url])

  return null
}

// JSON-LD structured data for blog posts
interface ArticleSchemaProps {
  title: string
  description: string
  publishedTime: string
  modifiedTime?: string
  author: string
  url: string
  image?: string
}

export function ArticleSchema({
  title,
  description,
  publishedTime,
  modifiedTime,
  author,
  url,
  image,
}: ArticleSchemaProps) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description,
    datePublished: publishedTime,
    dateModified: modifiedTime || publishedTime,
    author: {
      '@type': 'Person',
      name: author,
    },
    publisher: {
      '@type': 'Organization',
      name: 'OnePipe',
      logo: {
        '@type': 'ImageObject',
        url: 'https://onepipe.dev/logo.svg',
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    ...(image && { image }),
  }

  useEffect(() => {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.id = 'article-schema'
    script.textContent = JSON.stringify(schema)

    // Remove existing schema script
    const existing = document.getElementById('article-schema')
    if (existing) existing.remove()

    document.head.appendChild(script)

    return () => {
      const scriptToRemove = document.getElementById('article-schema')
      if (scriptToRemove) scriptToRemove.remove()
    }
  }, [schema])

  return null
}
