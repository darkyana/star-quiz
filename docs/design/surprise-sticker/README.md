# 惊喜答题入口贴纸

> **历史记录（2026-09-13，#270 交付时点）**：本文写定时贴纸是独立资产槽位（`public/stickers/surprise-quiz/` + `BUILTIN_TRIVIA_SLOT`），换色流程据此成立。随后 #287「内置题集对象化」把贴纸改为**随题集文件夹分发**（现役位 `public/trivia/current/`，槽位 `TRIVIA_SET_SLOT`），本文的路径、符号与换色脚本（`package-assets.mjs` 的写死目标）**均不再反映现状**。
> 现行的换题集 / 换贴纸流程见 `public/trivia/archive/README.md` 与 `docs/prompts/trivia-question-prompt.md`；「贴纸独立换色」拟作为独立 feature 另行立项并维护自己的活文档，届时本文退役。三色归档素材与 `package-assets.mjs` 打包能力本身仍然有效。

## 定稿

老板已确认三色全部保存，**C 晴蓝为本次正式素材**。同一胖圆问号星星造型，奶油色问号；不绑定题集内容。对应 #270，入口行为改造仍由 #269 负责。

| 配色 | 可直接替换的 SVG | PNG 原画 |
|---|---|---|
| A 软紫（备用） | `A-soft-purple.svg` | `A-soft-purple.png` |
| B 莓粉（备用） | `B-berry-pink.svg` | `B-berry-pink.png` |
| C 晴蓝（本次正式） | `C-sky-blue.svg` | `C-sky-blue.png` |

所有版本均为 512×512 透明画布，SVG 内嵌完整 PNG，无外部依赖；未画外描边，轮廓描边由宿主令牌提供。PNG 像素与已审预览一致，不重绘、不改色、不改比例。

## 正式资源与接入位

- App 使用：`public/stickers/surprise-quiz/icon.svg`。
- PNG 同步留存：`public/stickers/surprise-quiz/icon.png`。
- `src/data/builtin-trivia-questions.ts` 导出 `BUILTIN_TRIVIA_SLOT`，`id` 沿用现有入口显隐键，`icon` 为 `stickers/surprise-quiz/icon.svg`。
- #269 的宿主引用 `${import.meta.env.BASE_URL}${BUILTIN_TRIVIA_SLOT.icon}`，不硬编码颜色或归档路径；复用现有贴纸尺寸与宿主描边。
- 本次仅交付静态资源及接入配置，不改 Home、弹窗、入口显隐或答题行为；因此尚不在正式首页显示新入口。

## 以后换颜色

将本目录任意颜色的 `.svg` 复制覆盖 `public/stickers/surprise-quiz/icon.svg` 即可换图，不改组件或配置。建议同时将对应 `.png` 覆盖 `icon.png`，保持资产对一致。

或在仓库根目录执行：

```sh
node docs/design/surprise-sticker/package-assets.mjs A  # 软紫
node docs/design/surprise-sticker/package-assets.mjs B  # 莓粉
node docs/design/surprise-sticker/package-assets.mjs C  # 晴蓝（本次定稿）
```

脚本无需额外依赖，读取相邻 `surprise-sticker-preview/` 内已审 PNG，并同时打包归档三色和所选正式色。打包后按正常 App 构建/发布流程部署；已部署的静态文件不会因本地复制自动更新。

## 来源与评审

原始生成图、来源 SHA-256、生成说明、三色首屏截图与对比页保留于 `../surprise-sticker-preview/`。该目录是历史评审记录，本目录是可直接用于发布的素材集合。三色的 SVG 都使用相同正式标题「惊喜答题」，无评审字样。

资源测试：`npm test -- src/data/__tests__/surprise-sticker.test.ts`。覆盖入口键、相对资源路径、512 RGBA PNG、自包含 SVG 以及正式/归档资源对应关系；不锁死配色，未来按上述流程换色无需改测试。
