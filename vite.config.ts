import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig } from 'vite';
import dotenv from 'dotenv';
import express from 'express';
import { VitePWA } from 'vite-plugin-pwa';
import { apiRouter } from './server/apiRouter';

dotenv.config();

// In Google AI Studio, the user's Secrets / Environment Variables are injected into the running
// dev server process (tracked in /app/.dev.pid), while `compile_applet` (`vite build`) may run in
// a clean child shell. Hydrate missing runtime variables from the active dev server process
// so `vite build` always receives `VITE_META_APP_ID` and `VITE_META_EMBEDDED_SIGNUP_CONFIG_ID`.
try {
  if (!process.env.META_APP_ID && !process.env.VITE_META_APP_ID) {
    const allowedRuntimeKeys = [
      'META_APP_ID',
      'VITE_META_APP_ID',
      'META_EMBEDDED_SIGNUP_CONFIG_ID',
      'VITE_META_EMBEDDED_SIGNUP_CONFIG_ID',
      'META_APP_SECRET',
      'WHATSAPP_APP_SECRET',
      'WHATSAPP_VERIFY_TOKEN',
      'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
      'WHATSAPP_ACCESS_TOKEN',
    ];
    let targetPid = '';
    if (fs.existsSync('/app/.dev.pid')) {
      targetPid = fs.readFileSync('/app/.dev.pid', 'utf8').trim();
    }
    const candidatePids: string[] = [];
    if (targetPid) candidatePids.push(targetPid);
    if (fs.existsSync('/proc')) {
      for (const d of fs.readdirSync('/proc')) {
        if (/^\d+$/.test(d) && !candidatePids.includes(d)) {
          candidatePids.push(d);
        }
      }
    }
    for (const pid of candidatePids) {
      try {
        const envRaw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
        const map: Record<string, string> = {};
        for (const entry of envRaw) {
          const idx = entry.indexOf('=');
          if (idx > 0) map[entry.slice(0, idx)] = entry.slice(idx + 1);
        }
        if (map.META_APP_ID || map.VITE_META_APP_ID) {
          for (const k of allowedRuntimeKeys) {
            if (map[k] && !process.env[k]) {
              process.env[k] = map[k];
            }
          }
          break;
        }
      } catch {
        // ignore inaccessible proc entries
      }
    }
  }
} catch {
  // non-fatal fallback
}

// Ensure frontend VITE_META_* variables are synchronized at build time if only META_* is set.
// Never expose META_APP_SECRET or WHATSAPP_APP_SECRET to Vite client env.
if (process.env.META_APP_ID && !process.env.VITE_META_APP_ID) {
  process.env.VITE_META_APP_ID = process.env.META_APP_ID;
}
if (process.env.VITE_META_APP_ID && !process.env.META_APP_ID) {
  process.env.META_APP_ID = process.env.VITE_META_APP_ID;
}
if (
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID &&
  !process.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID
) {
  process.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID =
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
}
if (
  process.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID &&
  !process.env.META_EMBEDDED_SIGNUP_CONFIG_ID
) {
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID =
    process.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID;
}

const expressApp = express();
expressApp.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
expressApp.use('/api', apiRouter);

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: [
          'favicon-32x32.png',
          'apple-touch-icon.png',
          'icon.svg',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'manifest.json',
        ],
        manifest: {
          id: '/',
          name: 'STOQO',
          short_name: 'STOQO',
          description: 'Smart Stock. Smarter Business.',
          theme_color: '#0D2149',
          background_color: '#07132B',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          scope: '/',
          categories: ['business', 'finance', 'productivity', 'food'],
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,json}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api/],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              // Strictly NetworkOnly for dynamic API and Firebase/Firestore endpoints
              urlPattern: /^\/api\/.*|https:\/\/(?:firestore|identitytoolkit|securetoken|firebasestorage)\.googleapis\.com\/.*/i,
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      {
        name: 'api-server',
        configureServer(server) {
          server.middlewares.use(expressApp);
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      port: 3000,
      host: '0.0.0.0',
      strictPort: true,
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
