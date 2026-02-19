# Repository Guidelines

This is a minimalist, multilingual (DE, EN, ES) portfolio template built with Astro 5 and TailwindCSS 4. The project emphasizes simplicity, performance, and internationalization.

## Project Structure & Module Organization

```
void/
├── i18n/                  # Translation JSON files (en, es, de)
├── src/
│   ├── assets/           # Images and static files
│   ├── components/       # Astro components (Hero, Footer, etc.)
│   ├── layouts/          # Page layouts (Layout.astro)
│   ├── lib/              # Utility functions (cls, etc.)
│   ├── pages/            # Routes
│   │   ├── index.astro   # Root redirect to /en
│   │   └── [lang]/       # Localized pages
│   └── styles/           # Global CSS (TailwindCSS)
├── public/               # Static assets served directly
└── astro.config.mjs      # Astro configuration
```

**Key Files:**
- `src/pages/[lang]/index.astro` - Main localized homepage
- `src/layouts/Layout.astro` - Base HTML layout with theme support
- `i18n/*.json` - Translation files (must stay in sync across locales)
- `src/types.ts` - TypeScride types derived from i18n schema

## Build, Test, and Development Commands

```bash
bun run dev       # Start development server at localhost:4321
bun run build     # Build for production (runs i18n sync check first)
bun run preview   # Preview production build locally
bun run check-sync # Validate i18n files are synchronized
```

**Build Process:**
1. `astro-i18n-check` validates all translation keys match across locales
2. Astro generates static HTML for each language route
3. Sitemap is generated automatically

## Coding Style & Naming Conventions

**TypeScride/JavaScride:**
- Strict TypeScride configuration enabled
- Path alias: Use `@/` for imports (e.g., `@/src/components/Hero.astro`)
- Function naming: camelCase (e.g., `cls`, `useI18n`)
- File naming: PascalCase for components (e.g., `Hero.astro`)

**Astro Components:**
- One component per file
- Use TypeScride interfaces for props
- Keep client-side JavaScride minimal (islands architecture)

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

No automated tests are currently configured. When adding tests:
- Use Vitest (Astro's recommended test runner)
- Place test files alongside source: `Component.test.astro`
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
4. Use in components via `t("key.path")`

**Adding New Language:**
1. Create `i18n/{locale}.json`
2. Add locale to `getStaticPaths` in `src/pages/[lang]/index.astro`
3. Update Header component's locale list
4. Add to alternate links for SEO

**Translation File Structure:**
All JSON files must have identical keys. Build will fail if keys are out of sync.

## Architecture Notes

- **Static Site Generation (SSG):** All pages pre-rendered at build time
- **Zero JavaScride:** No client-side JS unless explicitly added
- **Theme Toggle:** Uses localStorage for persistence, respects system preference
- **Path Aliases:** `@/*` maps to repository root for clean imports
