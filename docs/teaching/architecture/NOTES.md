# 教学备注

- 用户回答 1:A、2:A：以判断 AI 架构方案为目标，基本不读代码。不要用 TypeScript 术语测基础。
- 使命来自上述明确回答；课程在独立目录内保存，保留现有 Cloudflare 工作区。
- 第一课：module 的价值在于调用者少操心，不在于增加文件。案例选择提议发布。
- 已核实：Proposals.vue onPublish 调 publish 后 reload；showPublishBtn 合并角色、deriveCardView、publishGate；useProposals.publish 内部重新门禁，再校验、追加兑换项、更新提议；proposalState.canPublish 复用 deriveState。
- 不把以上代码包装成完美架构：页面未消费 publish 返回结果；追加兑换项和保存提议是顺序写入，不声称事务原子性或云端一致性。
- 课程采用既有教学 CSS 与 quiz.js；架构 assets/lesson.css 是本课程的入口，导入既有样式，避免复制。
- 已提供第一课不等于学会；待用户回答练习后再创建理解记录。下一轮先反馈理由，再决定是否进入 interface / seam。
- 视觉范围：Read 模式，扩充现有教材，保留单栏排版、站点图、小测，不启动 App 视觉设计或改造。
- 检查：HTML 本地链接全部存在，选择题三选项字数一致。已运行设计 detector；它未识别间接导入的既有 CSS，误报标题正文均 16px（源码为正文 17px、h1 1.7rem、h2 1.3rem）。本地无 Playwright，未做浏览器截图与交互验证；open 命令成功，不证明用户已看到页面。
- git status 中已有 src/router/index.ts、src/styles/variables.css 修改和 public/parent/、PrototypeExplain.vue、PrototypeSticker.vue 未跟踪内容，均未触碰。
