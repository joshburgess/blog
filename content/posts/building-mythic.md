---
title: "Building a Traditional Static Site Generator That's Faster Than Hugo"
date: "2026-05-17"
tags:
  - rust
  - mythic
  - static-site-generator
  - performance
categories:
  - projects
---

Every static site generator I've tried has made me feel like I'm giving something up. Hugo is fast but its Go templates and opinionated structure get in the way. Eleventy is flexible but slow. Astro and Next.js are great but solve a different problem. So I built [Mythic](https://github.com/joshburgess/mythic), a classic SSG written in Rust. 10,000 pages build in 1.6 seconds and incremental rebuilds finish in 125ms. Accessibility auditing, content linting, and Schema.org generation are built in.

## Performance

Here are the numbers. I left Jekyll out since it's slower than both Hugo and Eleventy and I wanted to compare against the strongest competition.

### Full Build (Cold)

| Pages  | Mythic  | Hugo    | Eleventy |
|--------|---------|---------|----------|
| 1,000  | 150ms   | 171ms   | 300ms    |
| 5,000  | 740ms   | 851ms   | 1,510ms  |
| 10,000 | 1,614ms | 2,925ms | 3,860ms  |

On these synthetic benchmarks, Mythic came out ahead of Hugo at every scale I tested. Real-world results will vary depending on template complexity and content. Mythic supports three template engines (Tera, MiniJinja, and Handlebars), and if performance is a priority, MiniJinja is the best choice. Its `Value` type uses reference counting internally, which makes context passing significantly cheaper than Tera's deep-clone approach at scale.

### Incremental Build (No Content Changes)

Hugo and Eleventy re-process all pages on every build. So, their times are the same as the cold build. Mythic's incremental cache skips rendering, templating, and writing for unchanged pages entirely.

| Pages  | Mythic | Hugo    | Eleventy  |
|--------|--------|---------|-----------|
| 1,000  | 10ms   | 171ms   | ~300ms    |
| 5,000  | 58ms   | 851ms   | ~1,510ms  |
| 10,000 | 125ms  | 2,925ms | ~3,860ms  |

This is the number I care about most. When you're writing, you save a file, switch to the browser, and want to see the result instantly. You do this constantly, and Hugo re-processes everything every time. Mythic skips unchanged pages entirely.

### Why It's Fast

I profiled the 10,000-page build to understand where time was actually being spent:

- **Discovery** (parse frontmatter): 121ms (7%)
- **Markdown rendering**: 161ms (10%)
- **Template application**: 5ms (<1%)
- **File output I/O**: 1,348ms (83%)

The CPU work is almost free, thanks largely to [rayon](https://github.com/rayon-rs/rayon). A single `.par_iter()` call distributes markdown rendering across all available cores, and the same approach handles template application and file output.

The bottleneck is filesystem I/O: 10,000 pages means 40,000+ syscalls (mkdir, create, write, and close per page). CPU optimization can't fix that. The real win came from making incremental builds skip work entirely. Mythic checks content hashes before rendering, so unchanged pages never reach the render, template, or output stages.

I also hit an interesting O(n^2) problem in the template phase. Including a list of all pages in every page's template context meant deep-cloning that list for every render. At 10,000 pages, this alone took over 5 seconds. The fix was registering collections as lazy template functions that only materialize when a template actually accesses them. Templates that don't need the page list pay zero cost, and the template phase dropped from 5,200ms to 5ms.

## Built-In Features Worth Mentioning

### Three Template Engines

Mythic supports Tera, MiniJinja, and Handlebars in the same project, detected by file extension. They coexist without configuration, which is handy when migrating from another SSG or working with people who prefer different template syntaxes.

### Build-Time Accessibility Auditing

Every build runs WCAG checks:

- Images missing alt text
- Heading hierarchy violations (jumping from h2 to h4)
- Missing `lang` attribute on `<html>`
- Form inputs without labels
- Empty links

These show up as warnings in the build output, so you catch problems early instead of finding out from a Lighthouse audit or a user complaint. I'm surprised more SSGs don't do this. It's only a few hundred lines of HTML analysis, and it means every project gets accessibility checking on every build with nothing extra to install.

### Content Linting

Configurable quality rules run during the build: minimum/maximum word count, required frontmatter fields, orphan page detection. On a large site it's easy to end up with pages that are too short, missing metadata, or unreachable. Mythic finds them automatically.

### Schema.org and SEO

Mythic generates JSON-LD structured data from your frontmatter. Blog posts get `BlogPosting`, docs get `Article`, the index gets `WebPage`, and breadcrumbs get `BreadcrumbList`. Sitemaps, robots.txt, and Atom/RSS/JSON feeds are generated too. Most people don't bother maintaining this by hand, so getting it for free is a nice win.

### Smart Diffing

After each build, Mythic produces a manifest of exactly which files changed. If you're deploying to a CDN that supports selective invalidation, you can invalidate only what changed instead of the whole site. On a 10,000-page site, a single post edit means invalidating 1 file instead of 10,000.

## The Plugin System

Mythic has two plugin tiers.

**Rust plugins** implement a trait with hooks into every build stage:

```rust
impl Plugin for ReadingTimePlugin {
    fn name(&self) -> &str { "reading-time" }

    fn on_page_discovered(&self, page: &mut Page) -> Result<()> {
        let words = page.raw_content.split_whitespace().count();
        let minutes = (words + 199) / 200;
        let extra = page.frontmatter.extra.get_or_insert_with(HashMap::new);
        extra.insert("reading_time".into(), minutes.into());
        Ok(())
    }
}
```

Hooks include `on_pre_build`, `on_page_discovered`, `on_pre_render`, `on_post_render`, and `on_post_build`. You can modify pages, inject content, transform rendered HTML, or run post-build tasks.

**Rhai plugins** are lightweight scripts for quick customization without recompiling:

```rhai
fn on_page_discovered(page) {
    let words = page.content.split(" ");
    page.extra.word_count = words.len();
    page
}
```

[Rhai](https://rhai.rs) is a sandboxed scripting language for embedding in Rust. Scripts can't crash the build or access the filesystem, and they run fast enough that the overhead doesn't matter.

## Migration

Mythic includes migration tools for Jekyll, Hugo, and Eleventy:

```bash
mythic migrate --from hugo --source /path/to/hugo/site --output my-mythic-site
```

The Hugo migrator handles themes, shortcode conversion, and template syntax translation. It achieves roughly 80% conversion on real Hugo themes. The remaining 20% is usually custom Go template functions that need manual porting.

Hugo-compatible template filters like `markdownify`, `plainify`, `humanize`, `pluralize`, `urlize`, and `safeHTML` are built in, so many Hugo templates work with minimal changes.

## Developer Experience

The dev server (`mythic serve`) is built on axum with WebSocket-based live reload. When you save a file:

1. The file watcher detects the change (200ms debounce to coalesce rapid saves).
2. An incremental rebuild runs (only changed pages are re-rendered and re-written).
3. A WebSocket message tells the browser to reload.

CSS changes hot-inject: the stylesheet swaps in without a full page refresh, so you see the change with no flash of unstyled content. Config and template changes trigger a full rebuild automatically, so editing `mythic.toml` doesn't require restarting the server.

## Other Interesting Takeaways

Content hashing turned out to be a better caching strategy than dependency tracking. I tried dependency tracking first, rebuilding a page if its template or data files changed. The bookkeeping was complex and fragile. Content hashing is simpler: hash the inputs, compare to the cached hash, and skip if equal. A combined hash of the config and templates handles the "everything changed" case. There's no bookkeeping to drift out of sync, and the hash comparison is essentially free compared to I/O.

Supporting multiple template engines was also easier than expected. Dispatching on file extension (`.html`/`.tera` -> Tera, `.jinja`/`.j2` -> MiniJinja, `.hbs` -> Handlebars) took maybe 50 lines per engine, and they share the same template context and filter functions. Other SSGs are single-engine mostly by convention.

## Getting Started

```bash
# Install from crates.io
cargo install mythic-cli

# Or download a binary
curl -fsSL https://raw.githubusercontent.com/joshburgess/mythic/main/install.sh | sh

# Create a blog
mythic init my-blog --template blog
cd my-blog
mythic serve
```

Mythic is a 6-crate Rust workspace. The [source](https://github.com/joshburgess/mythic) and [documentation](https://github.com/joshburgess/mythic/tree/main/docs) cover everything from getting started to plugin development to migration from other SSGs. A GitHub Action for deployment is included and works with GitHub Pages, Netlify, Vercel, and Cloudflare Pages.

This blog is built with Mythic. If incremental build times matter on a large site, or you want accessibility and content linting without bolting on extra tools, it's worth a try.
