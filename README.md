# Void - Minimalist Multilingual Portfolio Template

A clean, minimalist portfolio template built with Astro and TailwindCSS, featuring full internationalization support using `@ariaskit/astro-i18n`.

![Hero](.github/571_1x_shots_so.png)

## ✨ Features

- **🌍 Multilingual Support** - Built-in i18n with English, Spanish, and German
- **⚡ Astro 5** - Fast, modern static site generation
- **🎨 TailwindCSS 4** - Utility-first styling with dark mode
- **📱 Responsive Design** - Mobile-first approach
- **🔍 SEO Optimized** - Sitemap, meta tags
- **🚀 Zero JS by Default** - Minimal JavaScript for optimal performance
- **📝 TypeScript** - Full type safety throughout

## 🛠 Tech Stack

- **Framework**: [Astro](https://astro.build/)
- **Styling**: [TailwindCSS](https://tailwindcss.com/)
- **Icons**: [Lucide](https://lucide.dev/)
- **Internationalization**: [@ariaskit/astro-i18n](https://github.com/JorgeRosbel/astro-i18n)
- **Package Manager**: Bun

## 🚀 Quick Start

### Prerequisites

- Bun 1.3+

### Installation

```bash
# Clone the repository
git clone https://github.com/JorgeRosbel/void.git
cd void

# Install dependencies
bun install

# Start development server
bun run dev
```

Your site will be available at `http://localhost:4321`.

### Build & Deploy

```bash
# Build for production
bun run build

# Preview production build
bun run preview
```

## 🌐 Internationalization

This template uses `@ariaskit/astro-i18n` for seamless multilingual support. The i18n system is configured for:

- **English** (`en`) - Default locale
- **Spanish** (`es`)
- **German** (`de`)

### Adding New Languages

1. Create a new JSON file in `/i18n/` (e.g., `fr.json`)
2. Copy the structure from `en.json`
3. Add the new locale to `src/pages/[lang]/index.astro` in the `getStaticPaths` function
4. Update the i18n library configuration if needed

### Translation Files

All translations are stored in `/i18n/`:
- `en.json` - English translations
- `es.json` - Spanish translations  
- `de.json` - German translations

Each file contains the same structure with keys for:
- Navigation items
- Hero section content
- Project descriptions
- Experience details
- Contact information

## 📁 Project Structure

```
void/
├── public/              # Static assets
├── src/
│   ├── assets/         # Images and static files
│   ├── components/     # Astro components
│   │   ├── Hero.astro
│   │   ├── Projects.astro
│   │   ├── Experience.astro
│   │   └── ...
│   ├── layouts/        # Page layouts
│   ├── pages/          # Route pages
│   │   ├── index.astro      # Root redirect
│   │   └── [lang]/          # Localized pages
│   └── styles/         # Global styles
├── i18n/               # Translation files
├── astro.config.mjs    # Astro configuration
└── package.json        # Dependencies
```

## 🎨 Customization

### Personal Information

Edit the translation files in `/i18n/` to update:
- Personal name and title
- Project descriptions
- Experience details
- Contact information

### Styling

The template uses TailwindCSS with a dark theme. Customize colors and styles in:
- Global CSS classes in components
- Tailwind configuration (if needed)

### Adding New Sections

1. Create new components in `/src/components/`
2. Add translation keys to all i18n files
3. Import and use components in `/src/pages/[lang]/index.astro`

## 🔧 Configuration

### Site Configuration

Update `astro.config.mjs` to change:
- Site URL (`site` property)
- Add/remove integrations

### Package Scripts

- `bun run dev` - Start development server
- `bun run build` - Build for production (includes i18n validation)
- `bun run preview` - Preview production build

### Spotify Widget Setup

The Now Playing widget reads from `src/pages/api/spotify.ts`. Credentials stay server-side.

1. Create an app at https://developer.spotify.com/dashboard.
2. In the app settings, add this Redirect URI (exactly): `http://127.0.0.1:4321/callback`
3. Open this URL in your browser (replace `YOUR_CLIENT_ID`):

```text
https://accounts.spotify.com/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A4321%2Fcallback&scope=user-read-currently-playing%20user-read-recently-played&show_dialog=true
```

4. Approve access and copy the `code` query parameter from the redirect URL.
5. Exchange that code for tokens:

```bash
curl -X POST "https://accounts.spotify.com/api/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=PASTE_CODE_HERE&redirect_uri=http://127.0.0.1:4321/callback&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"
```

6. Copy `refresh_token` from the JSON response and create a `.env` file in project root:

```bash
SPOTIFY_CLIENT_ID=YOUR_CLIENT_ID
SPOTIFY_CLIENT_SECRET=YOUR_CLIENT_SECRET
SPOTIFY_REFRESH_TOKEN=YOUR_REFRESH_TOKEN
# optional: defaults to .spotify/refresh-token.json
SPOTIFY_TOKEN_STORE_PATH=.spotify/refresh-token.json
# optional: server-side response cache (default 300000ms / 5 min)
SPOTIFY_RESPONSE_CACHE_TTL_MS=300000
# optional: cache time when Spotify API errors (default 5000ms)
SPOTIFY_RESPONSE_ERROR_CACHE_TTL_MS=5000
# optional: cache time when credentials are missing (default 60000ms)
SPOTIFY_UNCONFIGURED_CACHE_TTL_MS=60000
```

7. Restart the server: `bun run dev`
8. Verify: open `http://127.0.0.1:4321/api/spotify`

## 🌍 Deployment

This template works great with:

- **Vercel** - Zero-config deployment
- **Netlify** - Simple static site hosting
- **GitHub Pages** - Free static hosting
- **Cloudflare Pages** - Global CDN


## 📝 License

MIT License - feel free to use this template for your projects!

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📚 Learn More

- [Astro Documentation](https://docs.astro.build/)
- [TailwindCSS Documentation](https://tailwindcss.com/docs)
- [@ariaskit/astro-i18n Documentation](https://github.com/JorgeRosbel/astro-i18n)

---

**Built with ❤️ using Astro and TailwindCSS**
