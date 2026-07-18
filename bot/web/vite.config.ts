import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // @beast-mode/web/frontend externalizes react / react-dom / react-router-dom
    // as peers, and the lib's built files live in the linked @beast-mode/web
    // package (which carries its own copies for building). Without dedupe, Vite
    // would realpath into that package and bundle a SECOND React -> "invalid hook
    // call". Dedupe forces all three (incl. react/jsx-runtime) to resolve from
    // THIS app's node_modules — a single React instance.
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3847',
      '/auth': 'http://localhost:3847',
    },
  },
  build: {
    outDir: 'dist',
  },
})
