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
      output: {
        // 打开页面就要的模块(入口静态 import 到的,$initial)都放进同一个包 app:点开才用的页面单独打包以后
        // (lib/lazyPage.ts),打包器会把它们和首屏共用的小模块拆成十几个小文件,样式表也跟着拆开、先后顺序变掉。
        // react、lib/api.ts 和 vite 给每个页面加的 modulepreload 补丁另放一个 api 包(和拆包前一样):
        // 卡带页面(sfx.html)只用到这些,不用带上整个游戏。入口文件本身不收(收进来的话三个页面都会去加载 app)
        codeSplitting: {
          groups: [
            {
              name: 'api',
              tags: ['$initial'],
              priority: 2,
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]|[\\/]src[\\/]debug[\\/]lib[\\/]api\.ts$|[\\/]voice-sfx[\\/]api\.ts$|modulepreload-polyfill/,
            },
            {
              name: 'app',
              tags: ['$initial'],
              priority: 1,
              test: (id) => !/([\\/]voice-sfx[\\/]review[\\/]|[\\/]src[\\/]debug[\\/]main\.tsx$|\.html$)/.test(id),
            },
          ],
        },
      },
    },
  },
})
