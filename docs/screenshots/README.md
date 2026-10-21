# Screenshots / 截图

Only the lightweight edition's images are pushed with the repository. Static
screenshots exist once per language — `README.zh-CN.md` uses the plain names,
`README.md` the `-en` ones. Both READMEs share the promo GIF.
只推送轻量版的配图。静态截图每种语言各一套：`README.zh-CN.md` 用无后缀文件，
`README.md` 用 `-en` 文件；两份 README 共用宣传 GIF。

| File / 文件 | Size / 尺寸 | Content / 内容 | Used by / 用于 |
| :--- | :--- | :--- | :--- |
| `booloo-promo.gif` | 800×450 | 30-second silent looping Bulu promo, Chinese on-screen text / 布噜 30 秒无声循环宣传片，中文画面文案 | Both READMEs / 中英文 README |
| `lightweight-pet.png` | 900×520 | The pet on a simulated desktop, zh speech bubble / 桌宠在模拟桌面上，中文气泡 | `README.zh-CN.md` |
| `lightweight-pet-en.png` | 900×520 | Same desktop, en speech bubble / 同一张桌面，英文气泡 | `README.md` |
| `lightweight-settings.png` | 960×720 | The settings panel, zh UI / 设置面板，中文界面 | `README.zh-CN.md` |
| `lightweight-settings-en.png` | 960×720 | The settings panel, en UI / 设置面板，英文界面 | `README.md` |

## Regenerating / 如何重新生成

The promo GIF is exported from the local `Booloo-promo.mp4`. The MP4 and its
`promo-video/` production files are ignored; only the README GIF is committed.
宣传 GIF 从本地 `Booloo-promo.mp4` 导出；MP4 和 `promo-video/` 制作文件已加入
`.gitignore`，仅 README 展示用 GIF 随仓库提交。

```bash
npm run build                # the screenshots render dist/renderer
npm run screenshots          # both languages
npm run screenshots -- en    # English only
npm run screenshots -- zh    # Chinese only
```

Needs a local Chrome or Edge (`BOOLOO_CHROME` overrides which one is used).
需要本机装有 Chrome 或 Edge（可用环境变量 `BOOLOO_CHROME` 指定路径）。

How the pictures are produced / 生成方式：

- **Settings panel**: the shipped `src/renderer/settings.html` is rendered in headless
  Chrome against a stub `window.__TAURI__` that answers `config_get` / `i18n_get` with a
  sample config and the real dictionary (from `src-tauri/resources/i18n.json`). It is
  therefore the real page with the real stylesheet, in the language that was asked for,
  and the script asserts the rendered DOM contains that language before saving.
  **设置面板**：用无头 Chrome 渲染真正发布的 `settings.html`，`window.__TAURI__` 由脚本桩提供，
  `config_get` / `i18n_get` 返回示例配置和真实词典；保存前会断言渲染出的 DOM 确实是目标语言。
- **Desktop**: a simulated desktop (wallpaper, a window, the taskbar, the pet and a speech
  bubble carrying `bubble.greeting`). The pet is a transparent always-on-top window, so a
  genuine screen capture would need a DWM composition pass — the README images are
  illustrations, not captures.
  **桌面图**：模拟桌面（壁纸 + 窗口 + 任务栏 + 桌宠 + 气泡，气泡文案取自词典的 `bubble.greeting`）。
- The panel is one window tall (the pages scroll inside it), so the shot is taken at
  the window's real 960×720 size and asserts the card fills it.
  面板高度等于一屏（各页在面板内滚动），所以截图按窗口真实尺寸 960×720 拍摄，并断言卡片铺满窗口。

## Not shipped / 不再推送

`pet-cat.png`, `pet-cat-en.png`, `settings-panel.png`, `settings-panel-en.png` and `demo.gif`
were produced by the pre-migration Electron build, which still had wardrobe / AI chat / PetPack
UI. They show screens the lightweight app no longer has, so `.gitignore` keeps them local.

这几张图由迁移前的 Electron 版生成，画面里还有轻量版已经没有的界面内容，因此被 `.gitignore`
留在本地，不随仓库推送。
