import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@wemd/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
  plugins: [
    react(),
    VitePWA({
      // 注册与激活由应用的安全更新流程负责，不能在编辑期间自动接管。
      registerType: "prompt",
      injectRegister: false,
      includeAssets: [
        "favicon-dark.png",
        "favicon-dark.svg",
        "favicon-light.svg",
        "pwa/icon-192.png",
        "pwa/icon-512.png",
        "pwa/icon-maskable-512.png",
        "licenses/**/*",
        "fonts/**/LICENSE",
        "fonts/**/*.txt",
        "libs/mathjax/LICENSE",
      ],
      manifest: {
        name: "RadishInk · 萝卜墨笺",
        short_name: "萝卜墨笺",
        description:
          "专注写作，轻松排版。Markdown 写作与微信公众号排版工具，本地保存，无需登录。",
        lang: "zh-CN",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#f9f9f9",
        theme_color: "#f9f9f9",
        icons: [
          { src: "pwa/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
        importScripts: ["pwa-update-guard.js"],
        // 本地打包的字体（woff2）与 MathJax 一起预缓存，保证离线写作与公式链路
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2,webmanifest}"],
        // tex-svg.js 为 2.11 MB，超过默认 2 MiB 上限；公式图片化是复制链路核心，必须离线可用
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
        // 所有版本与子路径的 API 都不得回退为 HTML 或进入运行时缓存。
        navigateFallbackDenylist: [/\/api(?:\/|$)/],
        runtimeCaching: [
          { urlPattern: /\/api(?:\/|$)/, handler: "NetworkOnly" },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          codemirror: [
            "codemirror",
            "@codemirror/lang-markdown",
            "@codemirror/language",
            "@codemirror/state",
            "@codemirror/view",
            "@uiw/codemirror-theme-github",
          ],
        },
      },
    },
  },
});
