---
title: "Building a Static Site Generator That's Faster Than Hugo"
date: "2026-04-05"
tags:
  - rust
  - mythic
  - static-site-generator
  - performance
categories:
  - projects
---

Static site generators tend to make you choose: fast or flexible. Hugo builds quickly, but can be rigid. Eleventy gives you freedom, but slows down on large sites. Jekyll is another option, but I left it out of the benchmarks below due to its slower performance relative to the others.

I built [Mythic](https://github.com/joshburgess/mythic) because I like Rust, and I wanted to see if I could get both speed and flexibility. It turned out well — 10,000 pages build in 1.6 seconds, incremental rebuilds with no changes finish in 125ms, and it includes things like accessibility auditing, content linting, and Schema.org generation out of the box.

## The Speed Story

Here are the numbers from my benchmarks:

### Full Build (Cold)

| Pages  | Mythic  | Hugo    | Eleventy |
|--------|---------|---------|----------|
| 1,000  | 150ms   | 171ms   | 300ms    |
| 5,000  | 740ms   | 851ms   | 1,510ms  |
| 10,000 | 1,614ms | 2,925ms | 3,860ms  |

On these synthetic benchmarks, Mythic came out ahead of Hugo at every scale I tested. Real-world results will vary depending on template complexity and content. If performance is a priority, MiniJinja is the best choice of the three engines — its `Value` type uses reference counting internally, which makes context passing significantly cheaper than Tera's deep-clone approach at scale.

### Incremental Build (No Content Changes)

| SSG      | 1k     | 5k     | 10k     |
|----------|--------|--------|---------|
| Mythic   | 10ms   | 58ms   | 125ms   |
| Hugo     | 171ms  | 851ms  | 2,925ms |
| Eleventy | ~300ms | ~1,510ms | ~3,860ms |

This is the number I care about most. When you're writing, you save a file, switch to the browser, and want to see the result. You do this constantly, and Hugo re-processes everything every time. Mythic skips unchanged content entirely — no re-rendering, no re-templating, and no re-writing.

### Why It's Fast

I profiled the 10,000-page build to understand where time was actually being spent:

- **Discovery** (parse frontmatter): 121ms (7%)
- **Markdown rendering**: 161ms (10%)
- **Template application**: 5ms (<1%)
- **File output I/O**: 1,348ms (83%)

The CPU work is almost free, thanks largely to [rayon](https://github.com/rayon-rs/rayon), a data-parallelism library for Rust. Rayon makes it easy to turn sequential iterators into parallel ones — a single `.par_iter()` call distributes markdown rendering across all available cores. The same approach parallelizes template application and file output. The ergonomics are excellent — you get meaningful speedups with very little code change.

The bottleneck is purely filesystem I/O: 10,000 pages means 40,000+ syscalls (mkdir, create, write, and close per page). No amount of CPU optimization can fix that. The real breakthrough was making incremental builds truly incremental — Mythic checks content hashes before rendering, so unchanged pages never reach the render, template, or output stages at all.

I also hit an interesting O(n^2) problem in the template phase. Including a list of all pages in every page's template context meant deep-cloning that list for every render. At 10,000 pages, this alone took over 5 seconds. The fix was registering collections as lazy Tera functions that only materialize when a template actually accesses them. Templates that don't need the page list pay zero cost, and the template phase dropped from 5,200ms to 5ms.

## What Makes It Different

### Three Template Engines

Mythic supports Tera, Handlebars, and MiniJinja in the same project, detected by file extension. Put your layout in `base.html` (Tera), your partials in `card.hbs` (Handlebars), and your components in `widget.jinja` (MiniJinja). They coexist without configuration.

This is useful when migrating from another SSG or working with a team where different people prefer different template syntaxes.

### Build-Time Accessibility Auditing

Every build runs WCAG checks:

- Images missing alt text
- Heading hierarchy violations (jumping from h2 to h4)
- Missing `lang` attribute on `<html>`
- Form inputs without labels
- Empty links

These show up as warnings in the build output. You catch accessibility issues before deployment, not after a Lighthouse audit or a user complaint. I'm surprised more SSGs don't do this — it was only a few hundred lines of HTML analysis to implement, and it means every Mythic user gets accessibility checking for free, every build, without installing anything extra.

### Content Linting

Configurable quality rules that run during the build:

- Minimum/maximum word count per page
- Required frontmatter fields (every blog post must have a description)
- Orphan page detection (pages with no incoming links)

```toml
[lint]
min_word_count = 100
required_fields = ["title", "description"]
warn_orphans = true
```

When you have 500 pages, it's easy to end up with a dozen that are too short, missing metadata, or otherwise unreachable. Mythic finds them automatically.

### Schema.org and SEO

Mythic generates JSON-LD structured data from your frontmatter. A blog post with a title, author, date, and description automatically gets a `BlogPosting` schema. A documentation page gets `Article`. The index page gets `WebPage`. Breadcrumbs get `BreadcrumbList`. It also generates sitemaps, robots.txt, and Atom/RSS/JSON feeds.

This is the kind of SEO work that everyone knows they should do, and nobody wants to maintain by hand.

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

For CSS changes, it does hot injection — the stylesheet is swapped without a full page refresh. You see the change instantly, with no flash of unstyled content. Config and template changes are also detected automatically. When you edit `mythic.toml`, Mythic re-reads the config and triggers a full rebuild with the updated values — no server restart needed.

## What I Learned

**Content hashing is the right caching strategy for SSGs.** I tried dependency tracking first — rebuilding a page if its template or data files changed. The bookkeeping was complex and fragile. Content hashing is simpler: hash the inputs, compare to the cached hash, and skip if equal. A combined hash of the config and templates handles the "everything changed" case. It's correct by construction, and the hash comparison is essentially free compared to I/O.

**Multi-engine templates are surprisingly easy.** Dispatching on file extension (`.html`/`.tera` -> Tera, `.hbs` -> Handlebars, `.jinja`/`.j2` -> MiniJinja) took maybe 50 lines of code per engine. They share the same template context and filter functions. There's no deep architectural reason other SSGs are single-engine — it's just convention.

## Try It

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

Mythic is a 6-crate Rust workspace. The [source](https://github.com/joshburgess/mythic) and [documentation](https://github.com/joshburgess/mythic/tree/main/docs) cover everything from getting started to plugin development to migration from other SSGs. A GitHub Action for deployment is included — it works with GitHub Pages, Netlify, Vercel, and Cloudflare Pages.

This blog is built with Mythic. If you're running a large static site and incremental build times matter to you, or if you want accessibility auditing and content linting without bolting on extra tools, give it a try.
