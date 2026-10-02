# AI 产出小游戏的类型与打包形态调研

> 回答 wayfinder 票 [darkyana/star-quiz#221](https://github.com/darkyana/star-quiz/issues/221)（隶属地图 #220）。
> 场景约束：自包含 web 静态资产、同源 iframe 嵌入 GitHub Pages 上的 Vue 本地优先家庭应用、单局 1–3 分钟、AI 单会话产出达到「成品级」（有音效动效、有分数、输了想再来一局）、玩家为小学年龄段孩子、游戏资产与 App 数据零耦合。
> 面向决策者；2026-09-08。

## 结论 gist（三行）

1. **单 HTML 不是硬上限，而是「甜点区」**：AI 一次会话稳定产出的是「单屏 Canvas + requestAnimationFrame 循环 + WebAudio 合成音效 + emoji/矢量绘制」的街机型小游戏；多文件目录在同仓库下完全可行（每游戏一个自包含子目录），迁独立仓库仅当游戏数量多到需要独立部署节奏时才值得。
2. **音效/美术用 AI 生成（程序化合成 + Canvas/SVG/emoji）即可到「成品级」下限**，外部 CC0 素材库（Kenney、Freesound）是可选增强而非必需；天花板在于音乐和角色动画，不在音效。
3. **类型可选范围比想象的大**：反应/闪避/弹幕/节拍/切分等「一屏一机制」类是低风险稳出区；平台跳跃、物理类可做需打磨；3D、多人联网、长线养成是高风险慎选区。

---

## 1. 可行游戏类型清单（按 AI 产出成品感 / 实现风险分层）

行业实践已验证这一模式：[fable-arcade](https://github.com/sorrycc/fable-arcade/blob/main/README.md) 收录了一批「每个都是 Claude 一次性生成的单文件 HTML 游戏」；[htmlvault 的 AI 游戏分类](https://www.htmlvault.net/category/games)、[localgames.fun](https://localgames.fun/) 也以「one HTML file, AI-assisted」为收录标准；有人用 Claude Code 在 [LittleJS 引擎上量产了 50 个街机游戏](https://www.reddit.com/r/aigamedev/comments/1tolm7y/)，其总结正是「单文件让 AI 上下文可控、每个游戏可独立测试」。共同的技术底座是：全屏 Canvas + `requestAnimationFrame` 游戏循环 + 键盘/指针输入 + 程序化音效（[ArcadeLab 的单文件模板定义](https://arcadelab.ai/learn/single-file-html-game-template)）。

「冲击感/刺激体验」的实现不靠类型本身，靠 **juice 层**：屏幕震动、粒子爆裂、hitstop（顿帧）、squash & stretch、合成音效、递进式庆祝动画——这套手法在 web 上有成熟 playbook（[Game feel on the web: squash, shake, and the art of juice](https://valdemird.com/blog/game-feel-on-the-web/)、[Juice: The Feel Layer in Game Design](https://falcon.so/resources/game-design/juice)，源自经典的 [Juice it or lose it](https://falcon.so/resources/game-design/juice) 传统）。对一个「一屏一机制」的游戏，AI 把 juice 层加满后成品感可以远超机制复杂度。

### 🟢 低风险稳出（单会话即可成品级，优先从这里选）

| 类型 | 代表玩法 | 冲击感来源 | 为什么 AI 稳 |
|---|---|---|---|
| 反应/点击 | 打地鼠、看准了再按、颜色 Stroop | 限时压迫 + hit 反馈 + 连击音效 | 无物理、无 AI 对手，逻辑 100–300 行 |
| 闪避/接物 | 接水果、躲陨石、左右移动躲障碍 | 速度递增 + 擦身而过 + 爆炸粒子 | 单轴输入，碰撞是 AABB 矩形判断 |
| 弹幕/射击 | 太空射击、打砖块、炮台防守 | 射击音 + 屏幕震动 + 满屏粒子（[实例](https://freefrontend.com/code/neon-retro-canvas-space-shooter-2026-04-27/)） | 规则明确、历史范例多，AI 训练分布内的「最甜点」 |
| 贪吃蛇/生长类 | 贪吃蛇、流沙生长、发光尾迹蛇（[霓虹蛇实例](https://andressy.dev/snippets/cyber-snake-juego-retro-alto-rendimiento-html5-canvas-game-loop-adaptativo)） | 越长越危险 + 尾迹残影 + 加速心跳 | 网格逻辑，天然适合 canvas |
| 记忆序列 | Simon Says、翻牌配对 | 递进音阶 + 全对庆祝爆发 | 状态机简单，音效即玩法的一部分 |
| 节奏/时机 | 按节拍按空格、完美时机切水果 | 音乐驱动 + Perfect 判定的爽感 | 用 WebAudio 时钟做判定即可 |
| 一笔画/路径解谜 | 连线、滑块、光路反射 | 解谜成功的连锁动画 | 无实时物理，回合制容错高 |

### 🟡 可做需打磨（1–3 会话迭代，或需人在环验收）

| 类型 | 代表玩法 | 风险点 |
|---|---|---|
| 平台跳跃 | 一屏跳跃闯关、无尽跳跃（Doodle Jump 式） | 手感（coyote time、跳跃曲线）是玄学，AI 一次写不出好手感，需反复试玩反馈；[实践者记录](https://www.reddit.com/r/VibeCodersNest/comments/1rf0d33/)也是多轮对话修出来的 |
| 物理弹射 | 愤怒的小鸟式、弹球、桌球 | 需要物理库（Matter.js）或自己写积分器，调参占 80% 工作量 |
| 双摇杆/多键操作 | 字母密幕、双手协调 | 小学年龄段学习成本高，操作映射要人工设计 |
| 轻量塔防/放置 | 单路塔防 | 数值平衡 AI 做不好，需要人调 |
| 竞速/追逐 | 伪 3D 公路追逐 | 视差与透视手绘需要打磨 |

### 🔴 高风险慎选（单会话几乎到不了成品级）

| 类型 | 为什么不行 |
|---|---|
| 3D / WebGL（Three.js） | 能出 demo（[有单文件 3D WebGL 的先例](https://www.reddit.com/r/ClaudeWorkflows/comments/1v6jeao/)），但「成品级手感」需要相机、光照、建模打磨；孩子端设备性能也存疑 |
| 多人联网 | 与「本地优先、无账号」场景冲突，且需要服务器 |
| 剧情冒险/RPG | 内容量远超单会话，文本+美术+系统三重工作量 |
| 精细角色动画平台游戏 | 需要骨骼动画/精灵图，AI 画的精灵图质量不稳定（见 §3） |
| 音游（精确谱面） | 谱面设计是专业工种，程序生成谱面体验差 |

**给小学年龄段的额外筛选**：输入尽量单键/单击/滑动；3 分钟内可理解规则；失败即时重来（这恰好和 1–3 分钟单局约束一致）。

## 2. 打包形态结论

**单 HTML 不是硬上限，是甜点区。**

- **为什么单文件香**：无资产加载问题、无路径问题、iframe 同源嵌入即 `<iframe src="...">` 完事；AI 单次输出即可携带全部逻辑+样式+音效参数。实践上 [8000 行的单文件 HTML 游戏拿到了 2500 万次游玩](https://www.reddit.com/r/ClaudeAI/comments/1t5ui23/)，单文件上探空间很大。
- **但多文件在同仓库下完全可行且更可维护**。GitHub Pages 是纯静态托管，多文件无任何限制（[GitHub Pages 发布 push 上去的所有静态文件](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site?apiVersion=2022-11-28)）。推荐组织：

  ```
  public/games/<slug>/          # 每个游戏一个自包含目录
    index.html                  # 入口，iframe 直接指向它
    game.js                     # 逻辑（可再拆，但建议 ≤3 个 JS）
    assets/                     # 仅当用了外部素材（图/音频）
  ```

  约束三条：① **相对路径**引用资源（`./assets/x.png`），不用根绝对路径——项目站点部署在 `/<repo>/` 子路径下，根绝对路径是 [GitHub Pages 子路径部署的经典坑](https://github.com/orgs/community/discussions/188844)；本 App 若经 Vite 打包，放 `public/` 下的文件会原样拷贝、不经构建，零耦合天然成立。② **不进 Vite 模块图**：游戏 JS 用普通 `<script>` 引入而非 import，保证「删掉整个目录即下架一个游戏」。③ 音效若走 WebAudio 合成则 `assets/` 可能为空目录——那就根本不需要 assets。

- **何时值得迁独立仓库**：只有当「游戏发布节奏」与「App 发布节奏」需要解耦时——例如要给外部人投稿游戏、或游戏数量（>10+）让主仓库 `public/` 膨胀、或需要独立的 Pages 域名/自定义加载页。代价是多一个部署面（多一条 Pages 配置、多一份 CI 心智、iframe 跨源后 `postMessage` 沟通成本）。**在当前规模（几个示范游戏、同一个家庭应用）下不值得**；先同仓库子目录，膨胀了再整体搬走（目录级搬运是零成本的，因为已经零耦合）。

## 3. 音效/美术资源来源

### 音效：程序化合成（AI 生成）是主路线

- **WebAudio 振荡器直写**：`OscillatorNode` + `GainNode` 包络 + 噪声缓冲，零资产文件合成街机音效，浏览器内建支持（[How to Add Sound to a Browser Game](https://dinogame.gg/blog/how-to-add-sound-to-browser-game/)、[Procedural BGM and SFX with the Web Audio API](https://js2devlog.com/en/devlog/web-audio-synthesis-bgm-sfx)）。AI 写这类代码非常稳，参数即代码。
- **sfxr 系预设**：[jsfxr](https://github.com/chr15m/jsfxr)（npm 包）提供 `pickupCoin / laserShoot / explosion / powerUp / hitHurt / jump / blipSelect` 等预设，一行代码生成并播放；[sfxr.me](https://sfxr.me/) 可以人工调好后把 JSON 参数抄进游戏。整个 sfxr 生态是 MIT 协议、无版权负担（[SFXR 历史](https://fr.wikipedia.org/wiki/SFXR)）。
- **天花板**：音效合成可达「像样的复古街机」水准；**背景音乐**是短板——程序生成 BGM 可行但听感重复（[实践讨论](https://www.reddit.com/r/proceduralgeneration/comments/1fubme4)）。对 1–3 分钟单局，短循环 chiptune 或干脆无 BGM 都可接受。
- 注意：浏览器自动播放策略要求首次用户交互后才能创建/恢复 `AudioContext`——AI 偶尔忘写，验收时按一条「点击开始前无声音」的检查项即可。

### 美术：emoji / Canvas 绘制 / SVG 是主路线

- **emoji 当精灵**：成本为零、孩子喜欢、风格天然统一；短板是「AI 设计的图标总是正方形里放个 emoji」的廉价感（[量产 50 游戏的作者的抱怨](https://www.reddit.com/r/aigamedev/comments/1tolm7y/)）。
- **Canvas 程序化绘制 + 发光（shadowBlur/glow）**：霓虹风、粒子风在 web 上有大量可抄的实现，是「冲击感」性价比最高的画风（[game feel on the web](https://valdemird.com/blog/game-feel-on-the-web/)）。
- **SVG**：AI 写几何风格 SVG 插画的能力不错，适合菜单/角色立绘，不适合逐帧动画。
- **天花板**：程序化美术到不了「精致卡通角色 + 逐帧动画」。如果某个游戏必须要这种美术，才考虑外部素材。

### 外部素材库：可选增强，非必需

- [Kenney.nl](https://kenney.nl/assets)：全部 CC0 公有领域，含 UI 音效包、2D 精灵包，质量高且无署名义务（[License 说明](https://kenney.nl/support)）。
- [Freesound.org](https://freesound.org/)：CC0 过滤后可用（[协议构成](https://en.wikipedia.org/wiki/Freesound)）；[OpenGameArt.org](https://opengameart.org/) 同理含 CC0 过滤器。
- 结论：**默认零外部素材**（保持自包含、零版权心智）；仅当选中的游戏类型明确需要精灵动画时，从 Kenney 拉一包 CC0 放进该游戏的 `assets/`。**不要用有 CC-BY 义务的素材**——家庭应用不值得背署名管理成本。

## 4. 给「示范游戏选型」票的输入：候选清单

评估维度：冲击感（孩子的「哇」）/ 风险 / 单会话可实现性（直觉分，★=低 ★★★=高）。

| # | 候选 | 玩法一句话 | 冲击感 | 风险 | 单会话可实现性 |
|---|---|---|---|---|---|
| 1 | **霓虹弹幕打陨石** | 底部飞船左右移动，射碎下落陨石，速度递增 | ★★★（爆炸粒子+屏幕震动+合成爆炸音） | 低 | ★★★（训练分布正中心，历史上 AI 一次成功率最高） |
| 2 | **完美时机切水果** | 物体抛起，划/按在完美窗口切开，切开爆果汁粒子 | ★★★（slice 手感 + 慢动作完美判定） | 低-中 | ★★（轨迹抛物线简单；「完美窗口」判定需 1–2 轮调参） |
| 3 | **接星星（闪避+收集）** | 顶部掉星星接住、炸弹躲开，连击加倍 | ★★（连击音阶递进 + 炸弹爆闪） | 低 | ★★★（单轴输入，最简单稳出的一档） |
| 4 | **节拍跳跃（节奏跑酷）** | 角色自动前进，按节拍跳过障碍，音乐驱动 | ★★★（音乐+判定合一，音效即玩法） | 中 | ★（节拍同步与手感需多轮打磨，建议排在第二批） |
| 5 | **Simon 音阶记忆** | 四色按钮播放音阶序列，复述递进序列 | ★★（递进音阶的紧张感天然自带） | 低 | ★★★（状态机极简，音效驱动，几乎零风险） |

推荐首发组合：**1 + 3 + 5**（三档输入方式：多键 / 单键 / 纯记忆，覆盖不同孩子偏好，且全部 🟢 低风险区）。

---

## 参考来源

- [fable-arcade：Claude 一次性生成的单文件 HTML 游戏合集](https://github.com/sorrycc/fable-arcade/blob/main/README.md)
- [htmlvault：AI 生成单文件游戏 22 例](https://www.htmlvault.net/category/games) · [localgames.fun](https://localgames.fun/)
- [用 Claude Code 在 LittleJS 上量产 50 个游戏](https://www.reddit.com/r/aigamedev/comments/1tolm7y/)
- [ArcadeLab：单文件 HTML 游戏模板](https://arcadelab.ai/learn/single-file-html-game-template)
- [Game feel on the web: squash, shake, and the art of juice](https://valdemird.com/blog/game-feel-on-the-web/) · [Juice: The Feel Layer in Game Design](https://falcon.so/resources/game-design/juice)
- [jsfxr（npm）](https://www.npmjs.com/package/jsfxr) · [sfxr.me](https://sfxr.me/) · [SFXR 维基（MIT 协议）](https://fr.wikipedia.org/wiki/SFXR)
- [How to Add Sound to a Browser Game (Web Audio API)](https://dinogame.gg/blog/how-to-add-sound-to-browser-game/) · [Procedural BGM and SFX with the Web Audio API](https://js2devlog.com/en/devlog/web-audio-synthesis-bgm-sfx)
- [GitHub Pages 创建文档](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site?apiVersion=2022-11-28) · [GitHub Pages 子路径 base path 讨论](https://github.com/orgs/community/discussions/188844)
- [Kenney.nl 资产（CC0）](https://kenney.nl/assets) · [Kenney License 说明](https://kenney.nl/support) · [Freesound（维基，协议构成）](https://en.wikipedia.org/wiki/Freesound) · [OpenGameArt（维基）](https://en.wikipedia.org/wiki/OpenGameArt.org)
- [霓虹贪吃蛇实现示例](https://andressy.dev/snippets/cyber-snake-juego-retro-alto-rendimiento-html5-canvas-game-loop-adaptativo) · [霓虹太空射击示例](https://freefrontend.com/code/neon-retro-canvas-space-shooter-2026-04-27/)
- [单文件 HTML 游戏 2500 万游玩的实践记录](https://www.reddit.com/r/ClaudeAI/comments/1t5ui23/) · [AI 编写 3D WebGL 单文件游戏的工作流](https://www.reddit.com/r/ClaudeWorkflows/comments/1v6jeao/)
