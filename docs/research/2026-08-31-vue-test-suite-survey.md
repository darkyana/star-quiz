# 研究：成熟 Vue 项目测试套样板盘点（对标报告）

- 票据：[#97](https://github.com/darkyana/star-quiz/issues/97)（Part of #96 wayfinder 地图）
- 调查日期：2026-08-31。对象：**vuejs/core**（Vue 框架本体）、**vuejs/pinia**（官方状态管理库）、**vueuse**（组合式工具库）三个仓库的 `main`/`v4` 分支。
- 方法：一手来源 = 各仓库 GitHub 上的真实文件（package.json 脚本、vitest 配置、`__tests__/` 目录清单、测试文件原文，经 git trees API 全量统计）。所有数量为当日粗数，口径随注；查证不到的项标「未核实」。注意：**pinia 的默认分支已从 `main` 改为 `v4`**，文中 pinia 链接均指 v4。
- 读者：非程序员背景的产品老板。本报告回答一件事——**成熟的 Vue 开源项目，测试到底怎么分层、放哪、怎么写**，作为教学课程的样板素材。少术语，多「他们为什么这么做」。

---

## 0. 一页结论（对比总表）

| 维度 | vuejs/core（框架本体） | pinia（状态库） | vueuse（工具库） |
|---|---|---|---|
| 测试文件总数 | 196 个 spec（183 单元/组件 + 13 e2e） | 18 个 spec + 10 类型测试 | 222 个 test（130 单元 + 90 浏览器 + 2 服务端） |
| **e2e / 页面级占比** | **~7%**（13/196，puppeteer/Playwright 驱动真实应用页面） | **无传统 e2e**（仅 1 个 Nuxt 模块冒烟） | **无传统 e2e**（Playwright 是测试驱动器，不是 e2e 套件） |
| 组件级占比（挂真组件） | runtime-dom 的 jsdom 测试为主力之一（16 个 spec） | **8/18 文件含 mount 真组件**（约 46 处） | 有共享 mount 助手，demo.vue 可直接被浏览器测试渲染 |
| 文件组织 | 各包自己的 `__tests__/`，内部**镜像源码子目录** | 包级 `__tests__/` **按主题命名**（非镜像） | **测试挨着源码**：每个功能文件夹四件套（源码+测试+demo+文档） |
| 命名 | 全部 `*.spec.ts` | 全部 `*.spec.ts` | 全部 `index.test.ts`（环境编码在后缀：`.browser.test.ts`） |
| 快照用不用 | **编译器侧大量用**（约 475 处）；运行时侧基本不用 | 几乎不用（仅 SSR 测试 4 处内联快照） | 基本不用（唯一成体系快照是「产物出口」检查） |
| DOM 怎么模拟 | jsdom 为主，Transition/hydration 下沉真浏览器 | happy-dom（比 jsdom 更轻） | jsdom + Vitest 浏览器模式（Playwright 真浏览器跑 90 个文件） |
| 配置位置 | **根级一份** vitest.config.ts，projects 分层 | 根级一份，projects 分层 | 根级一份，projects 分层 |

**三个共性结论（教学要点）**：

1. **「金字塔」是真实形态，但尖顶很小**：三家都是「海量快速单元/组件测试 + 极少量真浏览器 e2e」。e2e 慢、脆、贵，只留给「模拟不了的场景」（core 的动画时序、页面级真实交互）；能在毫秒级 jsdom 里测的绝不进 e2e。
2. **测试文件长在源码旁边，而不是集中扔进一个 tests 大箩筐**：三种变体（镜像子目录 / 按主题命名 / 四件套同文件夹），共同点是「改哪个文件，测试就在手边」，且**一份根级 vitest 配置用 projects 机制分层路由**，测试文件本身不用声明自己跑在哪。
3. **断言测「对外行为」，快照只用在「输出即产物」的地方**：抽査的全部样本都断言「调用之后用户可见的结果变了」（状态值、渲染出的文本、DOM 属性），不断言内部实现；快照集中在编译器输出这类「产物对比」场景，行为测试里几乎不用。

---

## 1. vuejs/core：分层最全的样本（单元 + jsdom 组件 + e2e 三层齐备）

### 1.1 形态

- **三层齐全**：单元/组件测试在各包的 `__tests__/`（共 196 个 `*.spec.ts`，其中 e2e 13 个）；类型测试在 [packages-private/dts-test](https://github.com/vuejs/core/tree/main/packages-private/dts-test)（24 个文件，`tsc` 编译即验证）；e2e 在 [packages/vue/__tests__/e2e/](https://github.com/vuejs/core/tree/main/packages/vue/__tests__/e2e)。
- **e2e 长什么样**：先构建出浏览器的整包产物，再用 **puppeteer** 打开 `examples/` 下的完整示例应用（todomvc、grid、markdown…），像真人一样输入、勾选、过滤，断言页面内容——例：[todomvc.spec.ts](https://github.com/vuejs/core/blob/main/packages/vue/__tests__/e2e/todomvc.spec.ts)。动画类的 Transition/TransitionGroup 单独走 **Playwright 真浏览器**（[vitest.config.ts](https://github.com/vuejs/core/blob/main/vitest.config.ts) 的 `e2e-browser` project）。
- **配比**：e2e 13/196 ≈ **7%**；其余 183 个全是快速测试。分包粗数：runtime-core 44、compiler-core 20、compiler-sfc 19、vue 18、server-renderer 17、reactivity 16、runtime-dom 16…
- **组织**：一律 `*.spec.ts`，放各包 `__tests__/`，内部**镜像源码子目录**（如 `__tests__/transforms/vFor.spec.ts` 对应 `src/transforms/`）；快照放同级 `__snapshots__/`（34 个 `.snap`）。

### 1.2 为什么这么做（给老板的解读）

- **「哪些测试下沉到 e2e」有明文规则**：vitest.config.ts 的 coverage 排除列表里写着 [hydration 和 Transition 的注释](https://github.com/vuejs/core/blob/main/vitest.config.ts)——"tested via e2e"（已由 e2e 覆盖）。**判断标准不是「重要不重要」，而是「jsdom 模拟不模拟得了」**：数字逻辑毫秒可测，动画时序/真实水合只有真浏览器才算数。
- **快照用在该用的地方**：编译器的职责就是「输入模板 → 输出代码」，输出即产物，所以 [codegen.spec.ts](https://github.com/vuejs/core/blob/main/packages/compiler-core/__tests__/codegen.spec.ts) 这类文件大量用快照对比（全仓约 475 处、45 个文件，集中在编译器包）；而运行时包（reactivity、runtime-dom）以行为断言为主，`expect()` 约 4300 次远多于快照。**工具没有好坏，看测的对象是不是「产物」**。
- **行为断言范本**：[reactivity/__tests__/ref.spec.ts](https://github.com/vuejs/core/blob/main/packages/reactivity/__tests__/ref.spec.ts)（776 行）——只断言「改了值之后，依赖它的计算结果跟着变」，配 `vi.fn()` 计数「效应触发了几次」；[patchClass.spec.ts](https://github.com/vuejs/core/blob/main/packages/runtime-dom/__tests__/patchClass.spec.ts)——直接建真实 DOM 元素、调补丁函数、断言 `className` 变了。**全程不看内部字段怎么摆**。

### 1.3 教学可引用链接

- 分层配置（一份根配置管全仓）:https://github.com/vuejs/core/blob/main/vitest.config.ts
- e2e 真实页面测试:https://github.com/vuejs/core/blob/main/packages/vue/__tests__/e2e/todomvc.spec.ts
- 行为断言样本:https://github.com/vuejs/core/blob/main/packages/reactivity/__tests__/ref.spec.ts
- 快照主力场景:https://github.com/vuejs/core/blob/main/packages/compiler-core/__tests__/codegen.spec.ts
- 贡献规范(要求新功能带测试):https://github.com/vuejs/core/blob/main/.github/contributing.md

## 2. vuejs/pinia：组件级测试怎么写的最佳样本

> 口径:默认分支已是 **v4**(2026-08-31 核实),以下链接均为 v4。

### 2.1 形态

- **主体 18 个 `*.spec.ts`** 全在 [packages/pinia/__tests__/](https://github.com/vuejs/pinia/tree/v4/packages/pinia/__tests__),vitest 4 + **happy-dom**(比 jsdom 更轻的 DOM 模拟);[根级 vitest.config.ts](https://github.com/vuejs/pinia/blob/v4/vitest.config.ts) 用 projects 区分 pinia/nuxt/testing 三块。
- **组件级与单元级混在同一批文件里,不单设目录**:18 个文件中 **8 个挂了真组件**(共约 46 处 `mount`),需要验证「组件渲染 + 响应式联动」时才挂组件,纯逻辑(如 [actions.spec.ts](https://github.com/vuejs/pinia/blob/v4/packages/pinia/__tests__/actions.spec.ts))零组件。
- **无传统 e2e**(全仓无 cypress/playwright);唯一带 e2e 色彩的是 [nuxt 包的模块冒烟](https://github.com/vuejs/pinia/blob/v4/packages/nuxt/test/nuxt.spec.ts)——起一个真实 Nuxt 应用验证「模块能装上」。
- **类型测试** 10 个([test-dts/](https://github.com/vuejs/pinia/tree/v4/packages/pinia/test-dts));**产物冒烟** [dist-import.mjs](https://github.com/vuejs/pinia/blob/v4/packages/pinia/__tests__/dist-import.mjs) 直接 node 导入构建产物验证没坏。

### 2.2 组件级测试的标准写法（教学范本）

典型三步,见 [store.spec.ts](https://github.com/vuejs/pinia/blob/v4/packages/pinia/__tests__/store.spec.ts):

1. 内联定义一个小组件(template 字符串里用上 store);
2. `mount()` 挂载,把 pinia 当插件装进去;
3. **改 store / 调 action → nextTick → 断言页面上渲染出的文字变了**。

一句话:不是「检查零件」,而是「**装好整机,拨一下开关,看灯亮没亮**」。mount 用得最多的是 [storePlugins.spec.ts](https://github.com/vuejs/pinia/blob/v4/packages/pinia/__tests__/storePlugins.spec.ts)(15 处)与 [mapHelpers.spec.ts](https://github.com/vuejs/pinia/blob/v4/packages/pinia/__tests__/mapHelpers.spec.ts)。

### 2.3 其他取舍

- **组织按主题命名而非镜像源码**(getters/subscriptions/hmr/ssr…),共享的假数据抽到 [__tests__/pinia/stores/](https://github.com/vuejs/pinia/tree/v4/packages/pinia/__tests__/pinia/stores)。
- **快照几乎不用**:全仓 `toMatchSnapshot` 0 处,仅 [ssr.spec.ts](https://github.com/vuejs/pinia/blob/v4/packages/pinia/__tests__/ssr.spec.ts) 4 处内联快照(服务端渲染输出的 HTML 对比——又是一个「输出即产物」场景)。
- 未核实项:仓库无 CONTRIBUTING.md、README 无测试指引(均核实不存在)。

## 3. vueuse：「测试挨着源码」的组织范本

> 口径:main @ a5696badc(2026-08-30)。

### 3.1 形态

- **四件套约定**:每个功能一个文件夹——`index.ts`(源码)、`demo.vue`(演示)、`index.test.ts`(测试)、`index.md`(文档),官方写进 [CONTRIBUTING.md](https://github.com/vueuse/vueuse/blob/main/CONTRIBUTING.md),模板在 [packages/core/_template/](https://github.com/vueuse/vueuse/tree/main/packages/core/_template)。**新功能的测试是文件夹的默认组成部分,贡献者不需要决策「测试放哪」**。
- **全仓 222 个测试文件**:core 125、shared 60、math 17、integrations 9、router 3、firebase 1。按运行环境分:**130 个普通单测(jsdom)+ 90 个 `.browser.test.ts`(Playwright 真浏览器)+ 2 个 `.server.test.ts`(Node)**。
- **环境编码在文件名后缀里**:[根 vitest.config.ts](https://github.com/vueuse/vueuse/blob/main/vitest.config.ts) 用 projects 按通配符路由(`.browser.test.ts` → Vitest 浏览器模式),测试文件零配置。
- **无传统 e2e**:Playwright 是测试驱动器而非 e2e 套件;CI([ci.yml](https://github.com/vueuse/vueuse/blob/main/.github/workflows/ci.yml))按层跑 test:unit / test:browser / test:exports。
- **配比不是 1:1**:core 147 个功能目录 103 个带测试(~70%),没测试的多是强依赖硬件的 API(电池、定位、摄像头…);`useLocalStorage` 没有独立测试——它是 `useStorage` 的别名,测试写在被别名的那里。**「每个功能必须有测试」不是铁律,「值得测的逻辑必须有」才是**。

### 3.2 断言风格（教学范本）

- [useToggle/index.test.ts](https://github.com/vueuse/vueuse/blob/main/packages/shared/useToggle/index.test.ts):纯行为断言,「默认值 → toggle() → 结果」,无 mock 无快照。
- [useStorage/index.browser.test.ts](https://github.com/vueuse/vueuse/blob/main/packages/core/useStorage/index.browser.test.ts):手写一个假的 storage(`vi.fn` 包 Map),断言「值变了之后确实写进了 storage」。
- 定时器类一律 `vi.useFakeTimers()` + 快进时间(如 [useTimeoutFn](https://github.com/vueuse/vueuse/blob/main/packages/shared/useTimeoutFn/index.test.ts))——**不真等 3 秒,测试永远毫秒级**。
- 第三方依赖全部用 `vi.mock` 桩掉(router 包手写假 route、firebase 包模拟回调),**测试只测自己的逻辑,不测别人的库**。

---

## 4. 三个项目合起来看：教学样板要点

1. **分层配比(回答「各占多少」)**:单元/组件测试占 90%+,e2e 占 0–7%。pinia/vueuse 这种库根本没有传统 e2e——**e2e 不是「认真做测试」的标配,是「有模拟不了的真实环境」时才买的保险**。
2. **组件级 vs 页面级的取舍(回答「在哪层测」)**:默认在**最便宜能测的一层**测——纯逻辑直接调函数(pinia actions.spec);要看渲染就挂组件断言文本(pinia store.spec);只有真实浏览器才暴露的问题才上 e2e(core 的 Transition)。core 的 coverage 排除注释把这个原则写成了明文。
3. **文件组织(回答「放哪、怎么命名」)**:三种可行变体,共同点是**测试与源码同址 + 根级一份配置分层路由**。对 star-quiz 这种应用,四件套/镜像都过重,「按主题命名 + 源码旁 `__tests__/`」的 pinia 变体最贴近现状(本仓库已是 `src/**/__tests__/` 共置 + `tests/acceptance/` 编号验收,方向一致)。
4. **断言风格(回答「怎么断言」)**:一律行为断言——「操作之后,可见结果是什么」;快照只出现在「输出即产物」的场合(编译器代码、SSR 的 HTML)。交互不用录制回放,直接调 action/改状态再 nextTick 看渲染。
5. **mock 的纪律**:自己的逻辑真测,别人的依赖(router、firebase、storage)全桩掉;时间用假时钟快进。**测试慢、脆的根源几乎都是「测了不属于自己的东西」**。

## 5. 未核实与口径说明

- core 的 `e2eTCP` 目录在当前 main 文件树已不存在(旧资料中的路径),现况以本文链接为准。
- vueuse「功能测试不用快照」为抽样结论,未逐文件 grep;包级 vitest.config 被 projects 引用但树中不存在,疑为预留 glob。
- pinia 的 `trigger('click')` 型交互断言未做精确计数;core 快照 475 处/45 文件为全量逐文件统计。
- 三家均为「库/框架」而非业务应用:**业务应用的「页面级测试」最接近的样板是 core 的 e2e 形态(对完整示例应用做真实交互断言)**,教学时可直引其 todomvc.spec.ts。

---

*调研:三个并行研究员分别对三个仓库做 git trees 全量统计 + 抽查原始测试文件,全部结论可经文中 GitHub 链接直达核对。*
