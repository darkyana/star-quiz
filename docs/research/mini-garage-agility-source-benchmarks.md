# 迷你车库 re-calibrate：敏捷游戏原作源码基准

> 范围：独立一手来源研究；仅新增本文件，不修改游戏。Chrome Dino 由另一项研究负责，这里不重复。目标是先建立真正敏捷游戏的时间尺度，再做孩子试玩微调；不是先假设一个慢速儿童档。

## 结论先行

1. **Canabalt 原团队公开的 2010 iOS 源码足以建立可计算基准**：在 480 逻辑像素横向视野、300／400／600 逻辑 px/s 的速度截面，跨屏时间分别为 **1.60／1.20／0.80 秒**。恒速、60 FPS、稳定镜头下，静态障碍从右边缘首次露出到玩家前缘接触的几何预警约 **1.46／1.08／0.69 秒**。这些是本文算数，不是实测反应时间，也不是作者推荐值。[C1][C2][C3][C4][C5]
2. **不能把缺口持续时间冒充挑战间隔**：Canabalt 在这些截面的楼间缺口约持续 **0.16–0.44 秒**，但普通楼段的“上一屋顶末端→下一屋顶末端”间隔约 **0.85–4.64 秒**，还会插入屋顶杂物、特殊建筑与高度变化。[C6]
3. **Hexagon／Super Hexagon 原作源码证据不足，不填臆测数值。** Open Hexagon 是另一位作者的作品；原作者支持仿作也不能使其成为原作参数来源。[H1][H2][H3][H4]
4. **Terry Cavanagh 本人 MIT 原作 Triangle Run 可作连续横移辅助对照**：公开代码中直行 25 m/s，边向前边横移时每轴约 17.68 m/s，横移 5 m 约 0.283 秒。但该公开版本存在调试关卡提前返回，不把它的关卡节奏当成发行版基准。[T1][T2][T3][T4]
5. 因而，可以把**约 1 秒上下的可见接近过程、亚秒级动作和秒级挑战节奏**作为敏捷原作的量级参照；不能据此宣布车库必须直接使用 0.69 秒预警。连续横移、软地抓地与组合路径的动作预算必须一起重校。

## 1. 来源身份、版本与授权

| 对象 | 一手身份与本次状态 | 能否进入数值基准 |
|---|---|---|
| Canabalt iOS | Eric Johnson 的原团队仓库；README 标记 2010-12-29 源码发布、Semi Secret Software 版权；GDC 官方会议页确认 Johnson 是该工作室联合创始人、Canabalt 开发讲者。[C0][C1] | **是**，只代表该 iOS 公开版本，不冒充最初 Flash 版或今日所有移植版。 |
| Canabalt HaxeFlixel | 移植作者本人发布说明称获 Adam 提供 AS3 原码、获准公开移植源码。[C9] | 可继续核验的官方移植线索；本表不用它混算 iOS 参数。该发布页全文抓取返回 403，搜索索引可见作者声明。 |
| Hexagon／Super Hexagon | 原作者页面可确认作品关系，但本次未核实到原作者公开游戏源码。[H1][H2][H3] | **否**，不填写旋转速度、墙速、生成间隔等数值。 |
| Triangle Run | 原作者 itch.io 页面、本人 GitHub 仓库，README 标记 jam game v1.1，MIT 版权为 Terry Cavanagh。[T1][T2] | **有限可用**：运动学；不是知名度与发行状态都等价于 Super Hexagon 的替代品。 |
| rRootage | Kenta Cho 官网明确链接 `abagames/rrootage` 原码，描述控制飞船躲弹幕，仓库保留作者授权。[R1][R2] | 候选；本次未完成单位与调度闭环，不硬凑 px/s。 |

**“源码公开”不等于“整个游戏 MIT 开源”。** Canabalt 2010 README 允许游戏代码个人娱乐／教育使用，但禁止再分发原游戏代码；只有 `flixel-ios` 引擎采用 MIT。本研究提炼参数与公式，不搬运游戏代码或素材。[C1]

Canabalt 下列源码链接统一固定到提交 **`ef43b7d522d744a19bf687bb0575e18fbf3d8e96`**。Triangle Run 固定到 **`2327a7d9d88b919fbd6d8565133646b40e1bb537`**。来源的 API／README／博客可能另为浮动链接，按各条范围使用。

## 2. 先统一比较口径

以下是本文的测量定义，不是行业标准：

- **跨屏时间** `T_screen = L_axis / v_relative`：沿危险接近轴跨过一整个逻辑画面需要多久。Canabalt 是屏宽；车库若纵向滚动则是屏高对应的世界距离。必须匹配坐标，不比物理显示 px/s 或仪表盘 km/h。
- **几何预警** `T_geom = D_to_first_contact / v_relative`：某危险边缘刚露出后到首次接触边界的时间。实际**有效预警**还须从“玩家能辨认危险及安全路径”起算，通常比几何值短；遮挡、目标大小与注意力均未由源码静态读数解决。
- **挑战间隔** `T_event`：两次真正约束操作的事件之间的时间；障碍出生间隔、净空间隙时长、楼间洞口长度都不是自动等价物。
- **动作耗时** `T_action`：输入到碰撞体离开危险区域／到达下一安全区的时间；不能拿跳跃按住上限、动画长度或单键响应延迟替代。
- **剩余预算** `B = T_effective - T_action - T_input`：剩给辨认、决策和余量的时间。比较 B 比单独抄 T_geom 更接近难度。加速时使用 `D = ∫v(t)dt`，恒速除法只是切片。

## 3. Canabalt：源码事实

### 3.1 速度与动作

`Player.m` 的初始化和 `update` 给出：[C2]

| 源码事实 | 数值／机制 | 不应误读为 |
|---|---|---|
| 初始水平速度、最大水平速度 | 125、1000 | 平均玩家速度或全局一直保持的速度 |
| 加速度按当前速度分段 | v<100：60；100≤v<250：36；250≤v<400：24；400≤v<600：12；v≥600：4 | 每帧直接加这个数；初始化的 acceleration.x=1 也不是运行时长期加速度 |
| 玩家碰撞尺寸 | 宽 16、高 18 | 30×30 的整张精灵尺寸 |
| 重力、竖直限速 | 1200、360 | 完整跳跃固定时长 |
| 连续按住跳跃时间上限 | `min(v/2500, 0.35)` 秒 | 反应窗口或完整腾空时间 |
| 按住初段与后段 | jump<0.08 时向上速度设为 234；随后设为 360；松开／到上限后受重力作用 | 匀加速的一次性初速度模型 |
| 下一跳条件 | 落地且已松开触摸时重置 jump | 可以任意空中再次跳跃 |

单位闭环来自引擎：`FlxObject.updateMotion` 用速度乘 `FlxG.elapsed` 更新位置；`FlxGame.update` 从实际秒差得到 elapsed；因此这里是**逻辑 px/s、逻辑 px/s²**，不是 px/frame。该引擎还把单次 elapsed 限到 0.05s，严重掉帧时游戏秒与真实墙钟时间可能不再相等。[C4][C5]

`Obstacle.m` 中普通杂物重叠后将水平速度乘 **0.7** 并绊倒，不直接等同致死墙壁或深坑。因此杂物命中次数不能一律当作失败次数。[C7]

### 3.2 视野与镜头

`Canabalt.m` 使用横屏、zoom=1；`FlxGame` 根据设备和纹理缓冲缩放算逻辑尺寸。本文明确选择**旧 iPhone 的 480×320 逻辑视野**，不假称所有设备都是 480。早期非 Retina iPad 的 1024×768 经对应分支除以二，逻辑宽为 512。[C3][C5]

镜头不是简单“角色位于屏幕正中”：`PlayState` 建立 1×1 的 focus，跟随系数 15，每帧在玩家物理更新前令 `focus.x = player.x + W/2`；引擎在 state 更新前执行镜头跟随。`followAdjust(1.5,0)` 只有目标属于 FlxSprite 才加速度前瞻，而这里 focus 是 FlxObject，**不能凭这个 1.5 宣称额外前瞻 1.5 秒**。[C3][C4][C5]

**本文推算**：恒速、固定步长 Δt、镜头稳定、无边界钳制且忽略像素取整时，按上述更新顺序得到玩家碰撞体左侧屏幕位置近似：

`x_screen ≈ v × (1/15 + Δt)`

于是静态障碍危险前缘在右边界 W 首次露出时：

`D_contact ≈ W - x_screen - 16`

`T_geom ≈ (W-16)/v - (1/15 + Δt)`

这是**模型推算，不是运行捕获**。加速度、镜头初始瞬态、危险图像与碰撞边缘偏差、屏幕取整均会改变实际值；缺口真正必须起跳的时刻也早于掉落／接触截止时刻。

### 3.3 楼间间距与普通楼段节奏

`Sequence.reset` 的生成依赖生成当时速度；下式为其等价数学描述，`U,V∈[0,1)` 为随机量，tileSize=16、decSize=20：[C6]

- `g_max = 0.028125 × v`（以 tile 计），`g_min = max(4, 0.4 × g_max)`。
- `g = floor(g_min + U × (g_max-g_min))`；屋顶末端到下一屋顶起点的名义空隙为 **16g 逻辑像素**。
- `screenTiles = ceil(W/16)+2`；`m = screenTiles-g`，在 v<800 时最低为 15，否则最低为 6。
- 普通楼段宽度 `w = 16 × floor(m + V × 2m)`。注意这里随机增量为 **2m**，最终范围趋向 **m 到 3m**，不是 m 到 2m。
- 同一新楼段覆盖的“上一屋顶末端→新屋顶末端”距离为 **16g+w**。它比单看缺口更接近连续屋顶跳跃的节奏代理。

边界：该宽度规则不是所有特殊建筑的最终几何；开场两楼有固定布置，广告牌等另做尺寸调整，普通碰撞楼块还延伸 10 px。高度差、起跳点、窗户与杂物改变真正动作事件；生成速度与到达速度也可能不同。**下面不是全局随机分布统计，更不是可解性证明。**

## 4. Canabalt：可复算时间表（本文推算）

条件：W=480、稳定 60 FPS；速度恒定在列示截面；普通楼段，U/V 取值范围如上。300／400／600 是分析截面，不是作者命名的难度档位。

| 速度 v（逻辑 px/s） | 整屏跨越 | 几何预警近似 | 按住跳跃上限，非腾空时长 | 名义缺口尺寸／经过时间 | 普通楼末端→楼末端节奏代理 |
|---:|---:|---:|---:|---:|---:|
| 125（出生速度） | 3.84s | 不用稳定近似冒充开局实测 | 0.050s | 开场固定布局，不套后续随机表 | 开场固定布局 |
| 300 | 1.60s | 1.463s | 0.120s | 64–128 px／0.213–0.427s | 1.707–4.640s |
| 400 | 1.20s | 1.077s | 0.160s | 64–176 px／0.160–0.440s | 1.280–3.480s |
| 600 | 0.80s | 0.690s | 0.240s | 96–256 px／0.160–0.427s | 0.853–2.213s |
| 1000（代码上限） | 0.48s | 0.381s | 0.350s | 176–448 px／0.176–0.448s | 0.512–1.168s |

复算例：v=400 时 `g_max=11.25`、`g_min=4.5`，整数 g=4…11；`m=32-g`。最小 `16(g+m)=512`，最大在 g=4、m=28 时为 `16(4+3×28-1)=1392`，除以 400 得 1.28…3.48 秒。

解释限制：

- 1000 是程序上限，**不是推荐模拟“普通玩家成熟速度”**。不碰杂物、持续存活的分段恒加速理想估算，从125到300约5.56s、到400约9.72s、到600约26.39s、到1000约126.39s；实际命中杂物会减速。[C2][C7]
- 30 FPS 下镜头推算式比60 FPS多减约0.0167s；远小于“整屏高代替实际有效视野”等口径错误，但仍不应声称帧精确。
- 512 宽设备不能直接沿用480表：跨屏时间改为512/v；镜头几何预警相应增加约32/v；楼段生成也随 screenTiles 改变。
- **1 秒预警与1秒挑战间隔不是一回事。** 一个危险看见很早，连续两个必须执行的动作仍可能挨得很近；反之也可能长楼顶只有一次起跳。

## 5. Hexagon／Super Hexagon：明确的证据缺口

原作者在 2022-09-05 的十周年博客讨论源码发布，明确当时没有发布，并仅保留未来可能性。本次检查作者公开仓库列表，未找到这两款游戏原码；`super-hexagon-neo-issues` 的 README 明确是跨平台公共问题跟踪，不是游戏实现。[H1][H2]

早期 Hexagon 官方入口迁移到作者游戏站；作者 2012 博客说明 Super Hexagon 扩展了 jam 原作。**可玩的 Flash/SWF、本体下载、问题仓库均不足以证明原作者公开源代码。** 本次结论只是“未核实到”，不是“今后永远不公开”。[H3]

排除项：[Open Hexagon][H4] 自述 clone／受 Super Hexagon 启发；[Super-Haxagon][H5] 为仿作；[SuperHexagonRE][H6] 为逆向研究。它们可以研究自身设计，却不能给表格贴上“Terry 原作墙速／反应窗口”的标签。这里不提供任何来自这些项目的冒名参数。

## 6. 连续横移辅助：Triangle Run

### 源码事实

- 原作者页面描述为自身作品，README 说明版本，LICENSE 为 MIT、Copyright 2021 Terry Cavanagh。[T1][T2]
- `Player.gd` 设置 speed=25，注释单位 meters per second。每帧始终 direction.z 减1，左右输入 direction.x 为±1，然后将整个方向归一化、分别乘 speed、调用 move_and_slide。[T3]
- 已核对 `Player.tscn`／`Main.tscn`，未发现 speed 场景覆盖；相机 fov=80。FOV 是角度，**不是可辨认距离**。[T5]
- `coyotetime=0.2s`、`jumpqueued=0.1s` 是离台容错／跳跃输入缓冲，不是挑战频率或跳跃持续时间。[T3]
- `Main.gd` 的 placegap(size) 改变量为 -5.6×size；但本提交 randomizelevel() 开头存在 `debugsection(); return;`，后续常规生成流程不能直接当成发行版流程。[T4]

### 本文推算与用途

| 条件 | 物理结果 | 比较边界 |
|---|---|---|
| 直行 | 前进25 m/s | 本作世界单位，不与车库单位直接交换 |
| 向前且持续单侧横移 | 前向及横向均25/√2≈17.68 m/s | **转向会降低前进分量**，不是保持前速再附加横移 |
| 无碰撞横移距离 d | `T=d√2/25`；1m≈0.0566s，5m≈0.283s | d 是选定的示例距离，不冒称原作标准车道宽 |
| placegap(2) 的11.2m纵向长度 | 直走通过0.448s；持续单侧转向约0.634s | 只是距离／速度换算，不代表可见预警、跳跃可达性或发行版挑战间隔 |

它支持的方向是：**持续横移原作也可以有很快的物理避让能力**。若车库需要一秒以上才能横过某个危险组合，直接照搬 Canabalt 的亚秒预警是不公平；应同时考虑提高可控横移能力、减少所需横移距离／急反转，或给这类组合更长的预览，而不是只把前进速度全面降回缓慢档。

rRootage 暂作后续候选：原作者官网已闭环到源码，但 ship.c 的1000／500是内部速度，位置还使用移位运算；rr.h 的16ms基准与运行时 interval 需要一起核验。**本次没有给出其 px/s、跨屏时间或弹幕间隔，避免将固定点整数当像素速度。**[R1][R2][R3]

## 7. 对车库的 re-calibrate 建议（不是源码事实）

1. **将约1.0–1.5s的有效前视作为“敏捷标准档”待验证候选带，而不是预先定3秒以上。** 这是受Canabalt截面量级启发的设计提案，不是跨游戏统一标准；0.7–1.0s可留给更高挑战且路径明确的情况。先核验动作是否来得及，再决定具体档位。
2. **先报完整时间向量**：跨屏时间、可辨认→碰撞秒数、挑战事件间隔分布、典型／最坏横移耗时、输入延迟、跳跃覆盖多少组事件。不要只报速度上调百分比。
3. **从车库实际有效视野反推速度**：若经测量有效距离D=120世界单位，T=1.5／1.2／1.0秒对应v=80／100／120单位/s。这只是一组换算示例，D必须扣除接触边界与不可辨认远端；不是本研究已经批准的新参数。
4. **同步校准动作而非机械借用 runner 预警**：Canabalt 是时机式跳跃，Triangle Run 是连续横移，车库还有轮胎／路面／漂移及跳台组合。必须对每条路径算 `T_action`，检查障碍→安全位→下个目标的全程可达性，不能只看“每排有空位”。
5. **挑战节奏单独定**：可先用约1–2秒一次实际路径决策作为敏捷候选对照，不照抄Canabalt的0.16–0.44秒缺口时长充当连切节奏；必须保留有意的节奏变化与短暂空段，而非均匀狂刷障碍。
6. **区分标准档与后续适配**：这轮先建立具有速度感、短动作和连续决策的可玩基线；孩子在真实设备上的体验、失败分布与可访问性辅助属于下一轮调整依据，不拿尚未收集的儿童反应数据给慢档背书。

证据边界：本次是源码静态核验与运动学计算，未运行历史iOS程序／Triangle Run发行包，未测原作真实预警分布，未对车库新速度执行可达性回归。已满足至少一款可信原作版本的“速度＋视野＋间距／动作参数”闭环，但尚不足以称为多个同类连续横移游戏的行业统计基准。

## 一手出处

[C0]: https://gdcvault.com/play/1012837/Falling-to-Your-Death-The
[C1]: https://github.com/ericjohnson/canabalt-ios/blob/ef43b7d522d744a19bf687bb0575e18fbf3d8e96/README.TXT
[C2]: https://github.com/ericjohnson/canabalt-ios/blob/ef43b7d522d744a19bf687bb0575e18fbf3d8e96/src/Player.m
[C3]: https://github.com/ericjohnson/canabalt-ios/blob/ef43b7d522d744a19bf687bb0575e18fbf3d8e96/src/PlayState.m
[C4]: https://github.com/ericjohnson/canabalt-ios/blob/ef43b7d522d744a19bf687bb0575e18fbf3d8e96/flixel-ios/src/Flixel/FlxG.m
[C5]: https://github.com/ericjohnson/canabalt-ios/blob/ef43b7d522d744a19bf687bb0575e18fbf3d8e96/flixel-ios/src/Flixel/FlxGame.m
[C6]: https://github.com/ericjohnson/canabalt-ios/blob/ef43b7d522d744a19bf687bb0575e18fbf3d8e96/src/Sequence.m
[C7]: https://github.com/ericjohnson/canabalt-ios/blob/ef43b7d522d744a19bf687bb0575e18fbf3d8e96/src/Obstacle.m
[C9]: https://ninjamuffin99.newgrounds.com/news/post/1421207

补充引擎位置积分：[FlxObject.m](https://github.com/ericjohnson/canabalt-ios/blob/ef43b7d522d744a19bf687bb0575e18fbf3d8e96/flixel-ios/src/Flixel/FlxObject.m)；游戏尺寸配置：[Canabalt.m](https://github.com/ericjohnson/canabalt-ios/blob/ef43b7d522d744a19bf687bb0575e18fbf3d8e96/src/Canabalt.m)。

[H1]: https://distractionware.com/blog/2022/09/super-hexagon-10-years-on/
[H2]: https://github.com/TerryCavanagh/super-hexagon-neo-issues
[H3]: https://distractionware.com/blog/2012/05/the-perfect-six-sided-hexagon/
[H4]: https://github.com/vittorioromeo/SSVOpenHexagon
[H5]: https://github.com/RedTopper/Super-Haxagon
[H6]: https://github.com/sumguytho/SuperHexagonRE

补充作者入口：[Hexagon迁移页](https://distractionware.com/blog/hexagon/)；[作者公开仓库API](https://api.github.com/users/TerryCavanagh/repos?per_page=100)。

[T1]: https://terrycavanagh.itch.io/triangle-run
[T2]: https://github.com/TerryCavanagh/triangle-run/tree/2327a7d9d88b919fbd6d8565133646b40e1bb537
[T3]: https://github.com/TerryCavanagh/triangle-run/blob/2327a7d9d88b919fbd6d8565133646b40e1bb537/scripts/Player.gd
[T4]: https://github.com/TerryCavanagh/triangle-run/blob/2327a7d9d88b919fbd6d8565133646b40e1bb537/scripts/Main.gd
[T5]: https://github.com/TerryCavanagh/triangle-run/blob/2327a7d9d88b919fbd6d8565133646b40e1bb537/scenes/Player.tscn
[R1]: https://www.asahi-net.or.jp/~cs8k-cyu/windows/rr_e.html
[R2]: https://github.com/abagames/rrootage
[R3]: https://github.com/abagames/rrootage/blob/master/src/ship.c
