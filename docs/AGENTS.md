# AGENTS.md - Documentation Site

This file provides guidance to AI agents (Claude Code, Cursor, etc.) when working with the OnePipe documentation site.

## Overview

This is the documentation and blog site for OnePipe, built with Vite + React + MDX. It includes:
- Documentation pages (`/docs/*`)
- Blog section (`/blog/*`)
- Landing page (`/`)
- LLM-friendly content (`/llms.txt`, `/content.md`)

## Tech Stack

- **Vite 6** - Build tool and dev server
- **React 19** - UI framework
- **React Router DOM 7** - Client-side routing
- **MDX** - Markdown + JSX for content
- **Tailwind CSS** - Styling with CSS variables for theming
- **TypeDoc** - Auto-generated API reference from SDK

## Directory Structure

```
docs/
├── src/
│   ├── blog/           # Blog posts (MDX) and metadata
│   │   ├── posts.ts    # Blog post registry with metadata
│   │   └── *.mdx       # Individual blog posts
│   ├── docs/           # Documentation pages (MDX)
│   ├── api/            # Auto-generated API reference
│   ├── components/     # React components
│   │   ├── Layout.tsx      # Docs layout with sidebar
│   │   ├── BlogLayout.tsx  # Blog layout
│   │   └── SEO.tsx         # SEO meta tags component
│   ├── pages/          # Page components
│   │   ├── Index.tsx       # Landing page
│   │   ├── DocsPage.tsx    # Docs router
│   │   ├── BlogPage.tsx    # Blog listing
│   │   └── BlogPostPage.tsx # Individual blog post
│   ├── context/        # React context (ThemeContext)
│   ├── main.tsx        # App entry point with routes
│   └── index.css       # Global styles and CSS variables
├── public/
│   ├── llms.txt        # LLM-friendly documentation
│   ├── content.md      # Raw markdown for LLMs
│   └── robots.txt      # SEO robots file
├── index.html          # HTML entry with SEO meta tags
├── vite.config.ts      # Vite configuration
├── tailwind.config.js  # Tailwind configuration
└── typedoc.json        # TypeDoc configuration
```

## Commands

```bash
# Development
bun run dev           # Start dev server (port 5173)

# Build
bun run build         # Generate API docs + build for production
bun run api           # Generate API reference only

# Preview
bun run preview       # Preview production build
```

## Adding a New Blog Post

1. Create MDX file in `src/blog/`:
   ```
   src/blog/my-new-post.mdx
   ```

2. Add metadata to `src/blog/posts.ts`:
   ```typescript
   {
     slug: 'my-new-post',
     title: 'My New Post Title',
     description: 'Brief description for SEO and cards',
     date: '2025-12-23',
     author: 'OnePipe Team',
     tags: ['tag1', 'tag2'],
     readingTime: '5 min read',
     featured: false, // Set true for featured post
   }
   ```

3. Register lazy import in `src/pages/BlogPostPage.tsx`:
   ```typescript
   'my-new-post': lazy(() => import('../blog/my-new-post.mdx')),
   ```

**Important**: Do NOT include H1 (`# Title`) in MDX files - the title is rendered from metadata in the header component.

## Adding Documentation Pages

1. Create MDX file in `src/docs/`:
   ```
   src/docs/my-feature.mdx
   ```

2. Add route mapping in `src/pages/DocsPage.tsx`:
   ```typescript
   const DocsMyFeature = lazy(() => import('../docs/my-feature.mdx'))
   // Add to docs object:
   '/docs/my-feature': DocsMyFeature,
   ```

3. Add to sidebar navigation in `src/components/Layout.tsx`:
   ```typescript
   { title: 'My Feature', href: '/docs/my-feature' }
   ```

## Theming

CSS variables are defined in `src/index.css`:

- Dark theme: `:root, .dark { ... }`
- Light theme: `.light { ... }`

Key variables:
- `--bg-primary` through `--bg-hover` - Background colors
- `--text-primary` through `--text-muted` - Text colors
- `--accent`, `--accent-hover`, `--accent-muted` - Accent colors (amber)
- `--border-subtle`, `--border-default`, `--border-strong` - Borders

## SEO

- Global meta tags in `index.html`
- Dynamic meta tags via `SEO` component
- JSON-LD structured data via `ArticleSchema` component
- LLM-friendly content at `/llms.txt` and `/content.md`

## Current Blog Posts

| Slug | Title | Date |
|------|-------|------|
| introducing-onepipe | Introducing OnePipe | 2025-12-23 |
| using-claude-code-to-build-features | Using Claude Code to Build Features | 2025-12-22 |
| integrating-with-existing-frameworks | Integrating with Existing Frameworks | 2025-12-21 |
| building-event-driven-apis | Building Event-Driven APIs | 2025-12-20 |
| why-bun-for-backend | Why We Built OnePipe for Bun | 2025-12-18 |

## Key Patterns

### Blog Post MDX Format
```mdx
First paragraph is the intro - no H1 header needed.

## Section Header

Content with **bold**, `code`, and [links](/docs).

\`\`\`typescript
// Code blocks with syntax highlighting
const api = REST.create('example').build()
\`\`\`

## Another Section

- Bullet points
- More content
```

### Adding Components to MDX
MDX files can import and use React components:
```mdx
import { MyComponent } from '../components/MyComponent'

<MyComponent prop="value" />
```

## Updating LLM Content

When adding new features or blog posts, update:
1. `public/llms.txt` - Structured documentation summary
2. `public/content.md` - Raw markdown version

These files help LLMs understand the OnePipe documentation without parsing the full site.
