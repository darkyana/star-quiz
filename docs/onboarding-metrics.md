# 首次使用匿名次数统计（#310）

依据：[已批准的 #310](https://github.com/darkyana/star-quiz/issues/310)。依赖 #308 家长须知页；不包含 #311 及后续范围。本统计独立于 ADR 0013 的家庭×周运营导出：不复用家庭哈希、身份凭据、同步域、同步队列或家庭快照。

## 计数口径

| event | 发生点 |
| --- | --- |
| quiz_start | 首页普通「开始答题」成功创建会话；包括 normal/fresh/wrong，不包括惊喜、失败、刷新自动重开 |
| quiz_complete_10 | 普通轮 10 题全部作答，首次进入结果页成功结算；不要求全对，幂等重入不计 |
| guide_entry | 首页家长入口点击，不是页面挂载 |
| guide_back | 须知页返回点击 |
| guide_questions | 「出一套我家的题」点击 |
| guide_rewards | 「看看星星兑换」点击 |
| guide_family | 「创建我们的家」点击 |
| guide_statistics | 「数据统计说明」链接点击；关闭任何说明弹窗不计 |
| guide_dismiss | 通知视图卡片「知道了」点击（#324，通知被消费）；归档形态无此按钮，直接进入/浏览不计 |
| guide_archive | 家长页「给家长的话」进入归档形态的点击（#324，入口价值）；非 from=parent 的进入不计 |

计数不是人数、会话数、去重设备数或个体转化漏斗，不能把开始/完成次数比当作精确个人转化率。无历史回填、身份连接或防刷保证。

## 数据与故障边界

- `POST /api/metrics/onboarding` 接受且只接受 `{event, family_status}`，固定事件白名单、joined/unjoined 枚举，512 字节上限。客户端无 Cookie、Authorization、Referer；不带时间、数量、题目、答案、设备/家庭/会话 ID。
- 服务端不走设备认证、不更新 last_seen；服务器到达时间按 UTC+8 折日，D1 原子累加 `onboarding_daily_counts(day,event,family_status,count)`。无逐次事件表，无 IP/UA/原始请求或错误正文日志。
- 凭据内可选本机 `familyStatus` 是最近确认状态，不作身份上报，不参与同步、业务导出或统计导出。无凭据为 unjoined，新 pending 为 unjoined，active 配对/轮询或现有已认证 API 成功为 joined。旧凭据未确认时丢弃当次统计，不额外探测、不补报。
- 离线沿用最近确认值；generic 401 和盲 pending 无法证明移除，不清除 joined。现有明确删除凭据路径同时清掉分类；替换凭据重新分类。异步响应必须仍匹配当前 device_id+secret 才能更新，旧设备响应不能污染新设备。
- 上报不等待业务、不重试、不建队列，传输/存储异常吞掉；统计与学习、星星入账及同步的成败无依赖。Web 默认统计，无选择开关、无主动征求同意弹窗。家长须知仅提供主动点击的说明链接。
- `IS_MINITOOL` 编译门控在 reporter 顶部直接返回，说明链接不渲染；产物门禁额外拒绝 sendBeacon 和统计端点残留。

## 保留与 CSV

保留窗口为北京时间今天及之前 89 个日期桶。现有每日 UTC20（北京时间04时）Cron 全局清理过期桶，即使没有家庭也执行；清理故障不阻断家庭快照，下一次 Cron 再尝试。物理删除可能延迟到清理成功，运维需监控定时任务；导出始终独立限90日期，不能因清理延迟输出旧桶。D1自身恢复/备份生命周期应在上线核查中确认，不承诺平台备份即时抹除。

```sh
# 仅本地：初始化开发库；不要去掉 --local
cd worker
npx wrangler d1 migrations apply star-quiz-sync --local
cd ..
node tools/onboarding-metrics.mjs > onboarding.csv
# 运维获授权后才可选择生产只读导出：
# node tools/onboarding-metrics.mjs --remote > onboarding.csv
```

CSV 仅 `day,event,family_status,count` 四列，日期/事件/状态排序；没有发生的组合省略（不是独立人数）。空库输出表头。生产导出不是部署或迁移，脚本只发 SELECT。统计表不进家庭同步、快照和恢复，恢复家庭不会倒退全站计数。

## 上线门禁：平台日志尚未全部核验

2026-09-16 的只读 Cloudflare 检查：脚本设置 `logpush:false`、无 Tail Consumers；`observability` 为 null/缺省。**账户和 zone 两级 Logpush jobs 查询均 403（10000），不能据此宣称平台无日志或隐私验收已全部完成。** 本仓库将应用可控 `logpush:false`、`observability.enabled:false`、`tail_consumers:[]` 显式化，但未部署。

上线前必须由具备相应只读权限的操作者完成并记录证据：
1. 复核部署后 Worker invocation/observability、Logpush、Tail Consumers 配置确实关闭；不要用 `wrangler tail` 收集真实请求作为检查方式。
2. 检查 account/zone Logpush、HTTP 请求日志、其他日志目的地和过滤规则，确保统计端点不进入含 IP/UA/逐请求字段的保留流；同时确认平台默认保留与D1恢复窗口。403不是通过。
3. 如发现不可避免的提供商连接信息处理，明确与应用持久化统计区分；如存在冲突的保留日志，先改配置/重新审定说明，不能带着未核验承诺上线。
4. 上述门禁关闭后，再由获授权部署者执行生产迁移 0011 和 Worker/Web 发布。开发验证只用本地D1和被拦截的浏览器请求；本实现没有执行生产迁移、发布或真实统计请求。

说明文案明确：网络提供商会处理 IP 等连接信息；「统计应用不保存 IP」不等于「服务器从未处理 IP」。
