import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two entry points: debug.html is the app (prompt console + visual novel);
// index.html only redirects / to it — the old standalone galgame frontend was
// removed on 2026-09-24.
// 卡带带来的页面(素材筛选页一类):文件在才打包 —— 生成公开版时卡带连同它的页面一起删掉
const CARTRIDGE_PAGES = ['sfx.html'].filter((f) => existsSync(resolve(__dirname, f)))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        debug: resolve(__dirname, 'debug.html'),
        ...Object.fromEntries(CARTRIDGE_PAGES.map((f) => [f.replace(/\.html$/, ''), resolve(__dirname, f)])),
      },
    },
  },
})
