import { defineConfig } from '@rspress/core';

const repository = 'https://github.com/umbrella22/rs_lvgl';
const base = process.env.RSPRESS_BASE || '/rs_lvgl_website/';

export default defineConfig({
  root: 'docs',
  outDir: 'doc_build',
  base,
  builderConfig: {
    performance: {
      // Rspress virtual site data also changes when the environment selects a base.
      buildCache: { cacheDigest: [base] },
    },
  },
  lang: 'zh',
  title: 'rs_lvgl',
  description:
    'LVGL 9.6 for embedded Rust. Build with Cargo, try widgets on the desktop, and connect your device display and input.',
  logo: '/logo.svg',
  logoText: 'rs_lvgl',
  icon: '/favicon.svg',
  locales: [
    {
      lang: 'zh',
      label: '简体中文',
      title: 'rs_lvgl 文档',
      description:
        '为 Rust 嵌入式项目接入 LVGL 9.6：用 Cargo 构建，在桌面调试，再连接设备的显示与输入。',
    },
    {
      lang: 'en',
      label: 'English',
      title: 'rs_lvgl documentation',
      description:
        'LVGL 9.6 for embedded Rust. Build with Cargo, try widgets on the desktop, and connect your device display and input.',
    },
  ],
  route: {
    localeRedirect: 'never',
  },
  search: {
    mode: 'local',
    codeBlocks: true,
  },
  themeConfig: {
    search: true,
    darkMode: 'auto',
    socialLinks: [{ icon: 'github', mode: 'link', content: repository }],
    footer: {
      message: 'MIT licensed. LVGL and bundled dependencies retain their own licenses.',
    },
  },
});
