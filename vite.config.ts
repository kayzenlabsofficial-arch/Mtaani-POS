import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function productionJsObfuscator(): Plugin {
  return {
    name: 'mtaani-production-js-obfuscator',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_, bundle) {
      if (process.env.DISABLE_JS_OBFUSCATION === 'true') return;
      const mod = await import('javascript-obfuscator') as any;
      const obfuscator = mod.default || mod;

      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'chunk') continue;
        if (!asset.fileName.endsWith('.js')) continue;
        if (asset.fileName.includes('workbox') || asset.fileName.includes('sw')) continue;

        asset.code = obfuscator.obfuscate(asset.code, {
          compact: true,
          controlFlowFlattening: false,
          deadCodeInjection: false,
          disableConsoleOutput: false,
          identifierNamesGenerator: 'hexadecimal',
          renameGlobals: false,
          selfDefending: false,
          stringArray: true,
          stringArrayCallsTransform: true,
          stringArrayCallsTransformThreshold: 0.35,
          stringArrayEncoding: ['base64'],
          stringArrayRotate: true,
          stringArrayShuffle: true,
          stringArrayThreshold: 0.35,
          target: 'browser',
          transformObjectKeys: false,
        }).getObfuscatedCode();
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(), 
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
        workbox: {
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
          globPatterns: ['**/*.{js,css,html,ico,png,svg}']
        },
        manifest: {
          name: 'Mtaani POS',
          short_name: 'Mtaani',
          description: 'Premium Cloud POS for Kenyan Businesses',
          theme_color: '#2563eb',
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      }),
      productionJsObfuscator()
    ],
    define: {
      'process.env.DEFAULT_BUSINESS_CODE': JSON.stringify('MTAANI01'),
      '__BUILD_DATE__': JSON.stringify(new Date().toLocaleString('en-GB', { 
        day: '2-digit', month: 'short', year: 'numeric', 
        hour: '2-digit', minute: '2-digit' 
      })),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom'],
            'vendor-charts': ['recharts'],
            'vendor-utils': ['dexie', 'jspdf', 'html2canvas', 'lucide-react'],
          }
        }
      },
      chunkSizeWarningLimit: 1000,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâ€”file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8788',
          changeOrigin: true,
          secure: false,
        }
      }
    },
  };
});
