# Repository Guidelines

This is a minimalist, multilingual (DE, EN, ES) portfolio template built with Astro 7 and TailwindCSS 4. The project emphasizes simplicity, performance, and internationalization.

## Project Structure & Module Organization

```
homepage/
├── i18n/                  # Translation JSON files (en, es, de)
├── src/
│   ├── assets/           # Images and static files
│   ├── components/       # Shared Astro components and page content
│   ├── layouts/          # Page layouts (Layout.astro)
│   ├── lib/              # Locale dictionaries and monitoring types
│   ├── pages/            # Routes
│   │   ├── [...path].astro # Static localized pages
│   │   └── api/          # Live weather, Spotify and Beszel endpoints
│   └── styles/           # Global CSS (TailwindCSS)
├── public/               # Static assets served directly
└── astro.config.mjs      # Astro configuration
```

**Key Files:**
- `src/pages/[...path].astro` - Static route generation for all pages and locales
- `src/layouts/Layout.astro` - Base HTML layout with theme support
- `i18n/*.json` - Translation files (must stay in sync across locales)
- `src/lib/i18n.ts` - Typed locale dictionaries and localized paths

## Build, Test, and Development Commands

```bash
bun run dev       # Start development server at localhost:4321
bun run build     # Build for production (runs i18n sync check first)
bun run preview   # Preview production build locally
bun run check-sync # Validate i18n files are synchronized
bun run check     # Check Astro and TypeScript diagnostics
bun run test      # Run API regression checks
```

**Build Process:**
1. `scripts/check-i18n.ts` validates translation keys, types, and array structure
2. Astro generates static HTML for each language route; API endpoints use the standalone Node adapter
3. Sitemap is generated automatically

## Coding Style & Naming Conventions

**TypeScript/JavaScript:**
- Strict TypeScript configuration enabled
- Path alias: Use `@/` for imports (e.g., `@/src/components/Header.astro`)
- Function naming: camelCase (e.g., `localePath`)
- File naming: PascalCase for components (e.g., `Header.astro`)

**Astro Components:**
- One component per file
- Use TypeScript interfaces for props
- Keep client-side JavaScript minimal (islands architecture)

**CSS/Styling:**
- TailwindCSS utility classes preferred
- Custom CSS variables in `src/styles/global.css`
- Dark mode support via `.dark` class on `<html>`

**Example Component Structure:**
```astro
---
import Type from "package";

interface Props {
  title: string;
}

const { title } = Astro.props as Props;
---

<section class="tailwind-classes">
  {title}
</section>
```

## Testing Guidelines

API regression tests are configured with Vitest (`bun run test`). When adding tests:
- Use Vitest (Astro's recommended test runner)
- Place test files alongside source: `*.test.ts` (keep tests out of `src/pages/` to avoid generating routes)
- Test critical user paths and i18n functionality

## Commit & Pull Request Guidelines

**Commit Messages:**
Use conventional commits format with emojis:
- `✨ feat:` - New features
- `📝 docs:` - Documentation changes  
- `💄 style:` - UI/styling changes
- `📦 build:` - Build system changes
- `👷 ci:` - CI/CD changes
- `🌐 feat:` - i18n/translation updates

**Pull Requests:**
1. Update all i18n files when adding/modifying content
2. Run `bun run check-sync` before submitting
3. Ensure build succeeds: `bun run build`
4. Update README.md if adding new features or changing structure

## Internationalization (i18n)

**Adding New Content:**
1. Add translation keys to `i18n/en.json`
2. Copy structure to `i18n/es.json` and `i18n/de.json`
3. Translate values in each file
4. Use the typed dictionaries via `messages[locale]`

**Adding New Language:**
1. Create `i18n/{locale}.json`
2. Add the locale and dictionary to `src/lib/i18n.ts`; static paths are generated from that list
3. Update the Header component’s language name map
4. Add to alternate links for SEO

**Translation File Structure:**
All JSON files must have identical keys. Build will fail if keys are out of sync.

## Architecture Notes

- **Static Site Generation (SSG):** All pages pre-rendered at build time
- **Client JavaScript:** Limited to terminal animation, keyboard shortcuts, theme selection and live widgets
- **Theme Toggle:** Uses localStorage for persistence, respects system preference
- **Path Aliases:** `@/*` maps to repository root for clean imports
