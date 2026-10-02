# 迷你车库 · 制作资料归档

游戏交付目录：[public/games/mini-garage-prototype](../../../public/games/mini-garage-prototype/README.md)。现行游戏协议、入口和验证说明以交付目录的 README 为准。本目录不参与游戏运行，也不随 `public/` 发布。

## 入口贴纸

- `entry-sticker/approved-original.png`：用户确认的极简小车生成原图，1254×1254，透明 PNG，按原字节保存。SHA-256：`7cb2379f89a481432792b7e25a9cdc162141420620d2d66e550fc8099290ed72`。
- `entry-sticker/rejected-detailed-original.png`：被用户否定的复杂玩具车版本，只保留制作记录，不得用作 App 入口。
- 正式素材：[`icon.png`](../../../public/games/mini-garage-prototype/icon.png) 与协议入口 [`icon.svg`](../../../public/games/mini-garage-prototype/icon.svg)。保留获批图案，缩为 512×512，不重绘、不加描边。SVG 内嵌 PNG，确保作为 `<img>` 加载时无需任何外部资源；不是纯矢量描摹。
- 导出工具：`tools/mini-garage-art/build-entry-sticker.cjs`，通过 `SHARP_MODULE` 指定已有 Sharp 安装位置。原图从不覆盖。

## 制作资料

| 路径 | 内容 |
| --- | --- |
| `art-assets/*original.png` | 早期车库、俯视小车和配置组合原图 |
| `art-assets/car-top-sprite.png` | 早期样板用小车精灵，非现行比赛素材 |
| `art-assets/track-kit/originals/` | 车辆、部件与材质生成原图 |
| `art-assets/track-kit/manifest.json` | 赛道素材规格；`assets[].file` 相对 `runtimeBase`，`originals[].file` 相对本清单目录 |
| `art-prototype.html`、`track-kit-preview.js/css` | 美术评审样板，运行图复用交付目录，不重复复制 |
| `art-review/` | 历轮美术/玩法截图与联系表 |
| `ART-STUDY.md`、`TRACK-KIT.md`、`PLAYABLE-ART.md`、`PROTOTYPE.md` | 历史设计和验证记录，旧路径与旧运行方式不代表现状 |

通过以仓库根为目录的静态服务打开 `docs/game/mini-garage/art-prototype.html` 可查看归档样板；相对路径可同时访问归档原图和 `public/games/` 中的现役图片。当前仅服务游戏目录的 4173 端口不提供 docs 文件。

## 分界

游戏运行所需的 4 张配车主图、4 张赛车图、路面/赛道部件/特效与装置图标留在交付目录。这些不是“制作过程废稿”，不可移到 docs，否则会破坏自包含交付和离线游玩。归档调整没有切换主 App 游戏槽位，也没有改动游戏玩法。
