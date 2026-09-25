import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// (the config runs in Node; declared here so the project needs no @types/node)
declare const process: { env: Record<string, string | undefined> };

/**
 * Public address of the site (with the trailing slash). Used for the canonical link, social
 * previews, robots.txt and sitemap.xml. Build with SITE_URL= (empty) for hosts where the
 * address is not known in advance (e.g. the itch.io ZIP): those files are then left out.
 */
const DEFAULT_SITE_URL = process.env.SITE_URL ?? 'https://dunmaer.github.io/Xibka/';

function seo(SITE_URL: string): Plugin {
  return {
    name: 'seo',
    apply: 'build',
    transformIndexHtml(html) {
      if (!SITE_URL) return html;
      const ld = {
        '@context': 'https://schema.org',
        '@type': 'VideoGame',
        name: 'Infernal Certificate',
        url: SITE_URL,
        image: `${SITE_URL}media/poster.jpg`,
        description:
          'A free browser ritual: write a name, the reason and the punishment, drop the note on the infernal altar and get a unique magic circle and a sealed certificate of curse.',
        genre: ['Casual', 'Interactive toy'],
        gamePlatform: 'Web browser',
        applicationCategory: 'Game',
        operatingSystem: 'Any (web browser)',
        inLanguage: ['en', 'ru', 'hy'],
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      };
      return html
        .replace('content="./media/poster.jpg"', `content="${SITE_URL}media/poster.jpg"`)
        .replace(
          '</head>',
          `    <link rel="canonical" href="${SITE_URL}" />\n` +
            `    <meta property="og:url" content="${SITE_URL}" />\n` +
            `    <script type="application/ld+json">${JSON.stringify(ld)}</script>\n  </head>`,
        );
    },
    generateBundle() {
      if (!SITE_URL) return;
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source:
          'User-agent: *\nAllow: /\n\n' +
          '# ChatGPT search\nUser-agent: OAI-SearchBot\nAllow: /\n\n' +
          `Sitemap: ${SITE_URL}sitemap.xml\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          `  <url><loc>${SITE_URL}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n` +
          '</urlset>\n',
      });
    },
  };
}

// `npm run build:itch` (mode "itch") builds the itch.io version: no fixed address.
export default defineConfig(({ mode }) => ({
  plugins: [react(), seo(mode === 'itch' ? '' : DEFAULT_SITE_URL)],
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: { host: true },
}));
