import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        outDir: 'dist',
        write: true,
        emptyOutDir: false,
        copyPublicDir: true,
        reportCompressedSize: false,
        manifest: false,
        lib: false,
        sourcemap: false,
        minify: false, // [NEW] esbuild minify 압축 크래시 우회 처리
        rollupOptions: {
          output: {
          }
        }
      }
    };
});
