---
title: "Building a Traditional Static Site Generator That's Faster Than Hugo"
date: "2026-04-05"
tags:
  - rust
  - mythic
  - static-site-generator
  - performance
categories:
  - projects
---

Every static site generator I've tried has made me feel like I'm giving something up. Hugo is impressively fast, but its Go templates and opinionated structure can be annoying. Eleventy lets you do almost anything, but that flexibility comes at the cost of build speed. Of course, there are also powerful, modern options like Astro, Next.js, etc., but they're sort of solving a different problem. So, I built [Mythic](https://github.com/joshburgess/mythic). I wanted a _classic_ static site generator, I greatly prefer Rust to Go, and I aimed to achieve both speed and flexibility. It turned out well. 10,000 pages build in 1.6 seconds, incremental rebuilds with no changes finish in 125ms, and it includes things like accessibility auditing, content linting, and Schema.org generation out of the box.

## Performance

Here are the numbers from my benchmarks. I left Jekyll out. It's slower than both Hugo and Eleventy, and I wanted to compare against the strongest competition.

### Full Build (Cold)

| Pages  | Mythic  | Hugo    | Eleventy |
|--------|---------|---------|----------|
| 1,000  | 150ms   | 171ms   | 300ms    |
| 5,000  | 740ms   | 851ms   | 1,510ms  |
| 10,000 | 1,614ms | 2,925ms | 3,860ms  |

On these synthetic benchmarks, Mythic came out ahead of Hugo at every scale I tested. Real-world results will vary depending on template complexity and content. Mythic supports three template engines (Tera, Handlebars, and MiniJinja), and if performance is a priority, MiniJinja is the best choice. Its `Value` type uses reference counting internally, which makes context passing significantly cheaper than Tera's deep-clone approach at scale.

### Incremental Build (No Content Changes)

| SSG      | 1k     | 5k     | 10k     |
|----------|--------|--------|---------|
| Mythic   | 10ms   | 58ms   | 125ms   |
| Hugo     | 171ms  | 851ms  | 2,925ms |
| Eleventy | ~300ms | ~1,510ms | ~3,860ms |

This is the number I care about most. When you're writing, you save a file, switch to the browser, and want to see the result. You do this constantly, and Hugo re-processes everything every time. Mythic skips unchanged content entirely: no re-rendering, no re-templating, and no re-writing.

### Why It's Fast

I profiled the 10,000-page build to understand where time was actually being spent:

- **Discovery** (parse frontmatter): 121ms (7%)
- **Markdown rendering**: 161ms (10%)
- **Template application**: 5ms (<1%)
- **File output I/O**: 1,348ms (83%)

The CPU work is almost free, thanks largely to [rayon](https://github.com/rayon-rs/rayon), a data-parallelism library for Rust. Rayon makes it easy to turn sequential iterators into parallel ones. A single `.par_iter()` call distributes markdown rendering across all available cores. The same approach parallelizes template application and file output. This is a huge performance win for very little effort.

The bottleneck is purely filesystem I/O: 10,000 pages means 40,000+ syscalls (mkdir, create, write, and close per page). No amount of CPU optimization can fix that. What actually made the biggest difference was making incremental builds truly incremental. Mythic checks content hashes before rendering, so unchanged pages never reach the render, template, or output stages at all.

I also hit an interesting O(n^2) problem in the template phase. Including a list of all pages in every page's template context meant deep-cloning that list for every render. At 10,000 pages, this alone took over 5 seconds. The fix was registering collections as lazy template functions that only materialize when a template actually accesses them. Templates that don't need the page list pay zero cost, and the template phase dropped from 5,200ms to 5ms.

## Built-In Features Worth Mentioning

### Three Template Engines

Mythic supports Tera, Handlebars, and MiniJinja in the same project, detected by file extension. They coexist without configuration, which is handy when migrating from another SSG or working with people who prefer different template syntaxes.

### Build-Time Accessibility Auditing

Every build runs WCAG checks:

- Images missing alt text
- Heading hierarchy violations (jumping from h2 to h4)
- Missing `lang` attribute on `<html>`
- Form inputs without labels
- Empty links

These show up as warnings in the build output, so you catch problems early instead of finding out later from a Lighthouse audit or a user complaint. I'm surprised more SSGs don't do this. It was only a few hundred lines of HTML analysis to implement, and it means every Mythic user gets accessibility checking for free, every build, without installing anything extra.

### Content Linting

Configurable quality rules run during the build: minimum/maximum word count, required frontmatter fields, orphan page detection. On a large site it's easy to end up with pages that are too short, missing metadata, or unreachable. Mythic finds them automatically.

### Schema.org and SEO

Mythic generates JSON-LD structured data from your frontmatter. A blog post with a title, author, date, and description automatically gets a `BlogPosting` schema. A documentation page gets `Article`. The index page gets `WebPage`. Breadcrumbs get `BreadcrumbList`. It also generates sitemaps, robots.txt, and Atom/RSS/JSON feeds.

Most people don't bother with this stuff because it's tedious to maintain by hand.

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

Rhai is a safe, sandboxed scripting language designed for embedding in Rust. It can't crash the build or access the filesystem, and it runs fast enough that the overhead is negligible.

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

For CSS changes, it does hot injection. The stylesheet is swapped without a full page refresh. You see the change instantly, with no flash of unstyled content. Config and template changes are also detected automatically. When you edit `mythic.toml`, Mythic re-reads the config and triggers a full rebuild with the updated values, so no server restart is needed.

## Other Interesting Takeaways

Content hashing turned out to be a better caching strategy than dependency tracking. I tried dependency tracking first, rebuilding a page if its template or data files changed. The bookkeeping was complex and fragile. Content hashing is simpler: hash the inputs, compare to the cached hash, and skip if equal. A combined hash of the config and templates handles the "everything changed" case. It's correct by construction, and the hash comparison is essentially free compared to I/O.

Supporting multiple template engines was also easier than expected. Dispatching on file extension (`.html`/`.tera` -> Tera, `.hbs` -> Handlebars, `.jinja`/`.j2` -> MiniJinja) took maybe 50 lines of code per engine. They share the same template context and filter functions. There's no deep architectural reason other SSGs are single-engine. It's just convention.

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

This blog is built with Mythic. If you're running a large static site and incremental build times matter to you, if you want accessibility auditing and content linting without bolting on extra tools, or if you just like Rust and want an SSG written in it, give it a try.
