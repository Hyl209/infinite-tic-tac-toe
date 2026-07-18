# 第一阶段：玩家中心与互动运营 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上线独立玩家中心和管理中心，完成排期活动、活动自动通知、全站通知金币领取、按星期签到和当月金币补签闭环。

**Architecture:** 保持原生 HTML/CSS/JavaScript 和 Supabase 架构。新增互动运营领域表与 `security definer` RPC；所有金币变动复用 `apply_coin_delta` 和稳定幂等键。活动排期通过查询时间窗口实现，不引入定时服务器。

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js test runner, Supabase PostgreSQL/RLS/RPC/Realtime, Cloudflare Pages

---

## 固定业务规则

- 站点业务时区固定为 `Asia/Hong_Kong`，数据库保存 UTC 时间，签到日期由数据库换算。
- 活动字段：标题、纯文本正文、可选封面 HTTPS URL、可选按钮文字和站内/HTTPS 链接、发布时间、开始时间、结束时间、奖励金币。
- 活动记录保存后即完成排期；到 `publish_at` 自动可见，活动有效期内每个注册用户可领取一次奖励。
- 排期活动同步创建关联通知；关联通知不重复发金币，奖励只在活动页领取。
- 独立全站通知可附带金币，每个注册用户手动领取一次；支持已读、未读和可选失效时间。
- 签到奖励按周一至周日分别配置；首个规则默认每天 `10` 金币、补签费用 `20` 金币，管理员可从指定生效日期创建新版本。
- 当天只能正常签到；补签只能补当前香港自然月内、早于今天的日期。
- 第一阶段仅支持金币补签。RPC 保留 `p_payment_method='coins'` 参数，第三阶段扩展为 `item`。
- 所有游客可浏览公开活动和通知；签到、已读、领奖、玩家中心私人数据要求正式注册账号。

## 公共接口契约

```text
PlayerActivities.createActivitiesClient({ accountClient })
  .listActive()
  .claimReward(activityId, requestId)
  .adminList()
  .adminSave(input)
  .adminUnpublish(activityId)

PlayerNotifications.createNotificationsClient({ accountClient })
  .list({ cursor, limit })
  .countUnread()
  .markRead(notificationId)
  .claimReward(notificationId, requestId)
  .subscribe(listener)
  .adminList()
  .adminPublish(input)
  .adminDisable(notificationId)

PlayerCheckin.createCheckinClient({ accountClient })
  .getMonth(month)
  .checkIn(requestId)
  .makeUp(date, paymentMethod, requestId)
  .adminListRules()
  .adminCreateRule(input)
```

RPC 名称固定为：

```text
list_active_activities
claim_activity_reward
admin_list_activities
admin_save_activity
admin_unpublish_activity
list_site_notifications
count_unread_site_notifications
mark_site_notification_read
claim_site_notification_reward
admin_list_site_notifications
admin_publish_site_notification
admin_disable_site_notification
get_checkin_month
perform_daily_checkin
perform_makeup_checkin
admin_list_checkin_rules
admin_create_checkin_rule
```

### Task 1: 先锁定数据库契约测试

**Files:**
- Create: `tests/integration/engagement-supabase.test.js`
- Modify: `tests/integration/structure.test.js`
- Test: `tests/integration/engagement-supabase.test.js`

- [ ] **Step 1: 写迁移、表、RPC、权限和时区的失败测试**

测试必须读取 `database/supabase/migrations/20260722_engagement.sql` 与 `database/supabase/setup.sql`，逐项断言：

```js
const requiredTables = [
  'activities',
  'activity_claims',
  'site_notifications',
  'notification_reads',
  'notification_claims',
  'checkin_rule_versions',
  'player_checkins',
];

const requiredRpcs = [
  'list_active_activities',
  'claim_activity_reward',
  'admin_list_activities',
  'admin_save_activity',
  'admin_unpublish_activity',
  'list_site_notifications',
  'count_unread_site_notifications',
  'mark_site_notification_read',
  'claim_site_notification_reward',
  'admin_list_site_notifications',
  'admin_publish_site_notification',
  'admin_disable_site_notification',
  'get_checkin_month',
  'perform_daily_checkin',
  'perform_makeup_checkin',
  'admin_list_checkin_rules',
  'admin_create_checkin_rule',
];
```

同时断言：唯一领取约束、`Asia/Hong_Kong`、`for update`、`apply_coin_delta`、`security definer`、固定 `search_path`、管理员校验、显式 revoke/grant、迁移不含 `drop table`/`truncate`。

- [ ] **Step 2: 把新增文件加入结构守卫**

在 `expectedFiles` 增加：

```text
player/index.html
admin/index.html
src/services/activities.js
src/services/notifications.js
src/services/checkin.js
src/routes/player.js
src/routes/admin.js
src/routes/notification-bell.js
assets/styles/player.css
assets/styles/admin.css
tests/unit/activities.test.js
tests/unit/notifications.test.js
tests/unit/checkin.test.js
tests/integration/engagement-supabase.test.js
tests/integration/player-center.test.js
tests/integration/admin-center.test.js
```

- [ ] **Step 3: 验证测试先失败**

Run:

```powershell
node --test tests/integration/engagement-supabase.test.js tests/integration/structure.test.js
```

Expected: FAIL，原因仅为新迁移、页面、服务与测试目标尚不存在。

- [ ] **Step 4: Commit**

```powershell
git add tests/integration/engagement-supabase.test.js tests/integration/structure.test.js
git commit -m "test: define engagement platform contracts"
```

### Task 2: 创建互动运营数据库迁移

**Files:**
- Create: `database/supabase/migrations/20260722_engagement.sql`
- Modify: `database/supabase/setup.sql`
- Test: `tests/integration/engagement-supabase.test.js`

- [ ] **Step 1: 创建数据表与约束**

迁移必须增量创建以下结构：

```text
activities
  id uuid primary key
  title varchar(80)
  body text
  cover_url text null
  action_label varchar(30) null
  action_url text null
  publish_at timestamptz
  starts_at timestamptz
  ends_at timestamptz
  reward_amount bigint check 0..1000000
  is_active boolean default true
  created_by uuid -> auth.users
  created_at / updated_at

activity_claims
  activity_id uuid
  user_id uuid
  reward_amount bigint
  claimed_at
  primary key (activity_id, user_id)

site_notifications
  id uuid primary key
  activity_id uuid null
  title varchar(80)
  body text
  reward_amount bigint check 0..1000000
  visible_at timestamptz
  expires_at timestamptz null
  is_active boolean default true
  created_by uuid -> auth.users
  created_at / updated_at

notification_reads
  notification_id uuid
  user_id uuid
  read_at
  primary key (notification_id, user_id)

notification_claims
  notification_id uuid
  user_id uuid
  reward_amount bigint
  claimed_at
  primary key (notification_id, user_id)

checkin_rule_versions
  id bigint identity primary key
  effective_from date unique
  monday_reward ... sunday_reward bigint check 0..1000000
  makeup_cost bigint check 0..1000000
  created_by uuid -> auth.users
  created_at

player_checkins
  user_id uuid
  checkin_date date
  checkin_type text check ('daily','makeup')
  reward_amount bigint
  payment_method text check ('none','coins','item')
  payment_amount bigint
  created_at
  primary key (user_id, checkin_date)
```

为活动可见窗口、通知列表、用户签到月历建立组合索引。活动关联通知使用唯一部分索引保证一个活动只有一条自动通知。

- [ ] **Step 2: 创建共享校验函数**

实现并复用以下内部函数：

```text
site_local_date() -> date
require_registered_user() -> uuid
require_site_admin() -> uuid
checkin_rule_for_date(date) -> checkin_rule_versions
validate_public_url(text, allow_relative boolean) -> text/null
```

`site_local_date()` 必须使用：

```sql
(now() at time zone 'Asia/Hong_Kong')::date
```

封面仅允许 `https://`；按钮链接允许 `/` 开头的站内地址或 `https://`。

- [ ] **Step 3: 实现活动 RPC**

`admin_save_activity` 必须：验证管理员、标题正文、时间顺序、奖励范围和 URL；插入或更新活动；同一事务 upsert 关联通知，通知的 `visible_at=publish_at`、`reward_amount=0`、正文链接到 `/player/?tab=activities&activity=<id>`。

`list_active_activities` 只返回 `is_active=true`、已到发布时间、尚未结束的活动，并为注册用户返回 `claimed`。

`claim_activity_reward` 必须锁定活动、校验发布时间和有效期、插入唯一领取记录，再调用：

```sql
apply_coin_delta(
  auth.uid(),
  activity.reward_amount,
  'activity_reward',
  activity.id::text,
  'activity_reward:' || activity.id || ':' || auth.uid()
)
```

奖励为 `0` 时只记录领取，不调用零金额流水。

- [ ] **Step 4: 实现通知 RPC**

列表按 `visible_at desc, id desc` 双字段游标分页，默认 20 条，最大 50 条；游客返回公开内容，正式用户额外返回 `is_read` 和 `reward_claimed`。`count_unread_site_notifications()` 必须从全部当前可见且有效的通知关联当前用户读记录计算权威未读总数，不得根据当前分页结果猜测。

`admin_list_site_notifications()` 必须返回独立通知和活动关联通知的启用/可见/失效状态、已读人数和领奖人数，供管理中心列表与停用操作使用。

独立通知领奖使用 `notification_reward:<notification_id>:<user_id>` 幂等键。已过期、停用、零奖励、重复领取分别抛出稳定错误码。

- [ ] **Step 5: 实现签到 RPC**

`get_checkin_month(p_month date)` 只接受本月或过去月份，返回目标月每天的奖励、签到状态、签到类型、今天和补签费用。

`perform_daily_checkin(p_request_id uuid)` 以香港今天为日期，锁定用户钱包，插入签到记录并发放对应星期奖励。

`perform_makeup_checkin(p_date date, p_payment_method text, p_request_id uuid)` 必须拒绝未来、今天、跨月、重复签到和第一阶段的 `item` 支付；金币补签先扣 `makeup_cost`，再发放该历史日期规则对应奖励，两个流水与签到记录在同一事务。

- [ ] **Step 6: 锁定权限与不可变记录**

业务表启用 RLS，撤销直接写权限；公开列表 RPC 可授予 `anon, authenticated`，私人和管理 RPC 仅授予 `authenticated`。领取和签到记录禁止更新、删除。

- [ ] **Step 7: 同步完整初始化脚本**

把迁移完整追加到 `setup.sql` 的现有最新补丁之后，保证全新环境和增量环境得到相同最终函数定义。

- [ ] **Step 8: 运行数据库契约测试**

```powershell
node --test tests/integration/engagement-supabase.test.js tests/integration/supabase.test.js
```

Expected: PASS。

- [ ] **Step 9: Commit**

```powershell
git add database/supabase tests/integration
git commit -m "feat: add engagement database contracts"
```

### Task 3: 实现活动、通知和签到前端服务

**Files:**
- Create: `src/services/activities.js`
- Create: `src/services/notifications.js`
- Create: `src/services/checkin.js`
- Create: `tests/unit/activities.test.js`
- Create: `tests/unit/notifications.test.js`
- Create: `tests/unit/checkin.test.js`

- [ ] **Step 1: 写服务映射与参数测试**

每个测试使用 fake `accountClient.getSupabaseClient()`，断言 RPC 名称、参数、返回映射、游客限制和稳定中文错误。请求 ID 使用调用方生成的 UUID；测试固定传入，避免依赖随机值。

必须覆盖：

```text
活动：公开列表映射、一次领取、管理员保存和下架
通知：双字段游标分页、权威未读总数、已读、领奖、管理员列表/发布/停用
签到：月份格式、当天签到、金币补签、拒绝 item 支付
```

- [ ] **Step 2: 验证单元测试先失败**

```powershell
node --test tests/unit/activities.test.js tests/unit/notifications.test.js tests/unit/checkin.test.js
```

Expected: FAIL，服务文件尚不存在。

- [ ] **Step 3: 实现统一客户端规则**

三个服务都使用：

```js
async function callRpc(name, params) {
  const supabase = await accountClient.getSupabaseClient();
  const result = await supabase.rpc(name, params);
  if (result.error) throw result.error;
  return result.data;
}
```

不得直接写业务表。日期输出统一为 `YYYY-MM-DD`，金额统一转为 `Number`，未知数据库字段不透传到 UI。

- [ ] **Step 4: 实现稳定错误映射**

至少映射：

```text
REGISTERED_ACCOUNT_REQUIRED
ADMIN_REQUIRED
ACTIVITY_NOT_STARTED
ACTIVITY_ENDED
ACTIVITY_ALREADY_CLAIMED
NOTIFICATION_EXPIRED
NOTIFICATION_ALREADY_CLAIMED
CHECKIN_ALREADY_DONE
MAKEUP_DATE_INVALID
MAKEUP_OUTSIDE_CURRENT_MONTH
ITEM_PAYMENT_UNAVAILABLE
INSUFFICIENT_COINS
```

- [ ] **Step 5: 运行单元测试并提交**

```powershell
node --test tests/unit/activities.test.js tests/unit/notifications.test.js tests/unit/checkin.test.js
git add src/services tests/unit
git commit -m "feat: add engagement service clients"
```

Expected: PASS。

### Task 4: 创建玩家中心页面骨架

**Files:**
- Create: `player/index.html`
- Create: `src/routes/player.js`
- Create: `assets/styles/player.css`
- Create: `tests/integration/player-center.test.js`

- [ ] **Step 1: 写页面结构失败测试**

断言页面加载账号、经济、活动、通知、签到服务，包含以下稳定 ID：

```text
player-summary
player-tab-checkin
player-tab-activities
player-tab-notifications
checkin-calendar
activity-list
notification-list
player-message
```

断言键盘可达 tab、`aria-live`、窄屏样式和未登录提示存在。

- [ ] **Step 2: 创建页面与路由状态**

支持：

```text
/player/?tab=checkin
/player/?tab=activities
/player/?tab=notifications
/player/?tab=activities&activity=<uuid>
```

非法 tab 回退到 `checkin`；切换 tab 使用 `history.replaceState`，不刷新页面。

- [ ] **Step 3: 接入共享账号状态**

页面创建一次 account client、economy client，并将同一 account client 注入三个新服务。游客可看活动通知，但签到区显示明确登录入口；注册用户显示游戏名和实时金币余额。

- [ ] **Step 4: 完成响应式布局**

桌面端使用左侧纵向导航和右侧内容；小于 `760px` 改为顶部横向可滚动 tab。遵循现有 Obsidian 色彩、焦点样式和 `prefers-reduced-motion`。

- [ ] **Step 5: 运行页面测试并提交**

```powershell
node --test tests/integration/player-center.test.js
git add player src/routes/player.js assets/styles/player.css tests/integration/player-center.test.js
git commit -m "feat: add player center shell"
```

### Task 5: 完成签到月历和金币补签界面

**Files:**
- Modify: `src/routes/player.js`
- Modify: `assets/styles/player.css`
- Modify: `tests/integration/player-center.test.js`

- [ ] **Step 1: 增加可测试的纯函数**

导出并测试：

```text
normalizePlayerTab(value)
buildCalendarCells(monthSnapshot)
getCheckinAction(day, today)
formatCoinDelta(value)
```

月历必须包含月初空位、当月日期、已签/补签/可补/未来状态，不能用颜色作为唯一状态提示。

- [ ] **Step 2: 接入当天签到**

当天未签显示“签到领取 N 金币”；点击生成 request UUID，调用 `checkIn`，成功后刷新月历和钱包。提交期间禁用按钮，失败保留可重试状态。

- [ ] **Step 3: 接入金币补签确认**

点击可补日期弹出确认框，显示奖励、费用和预计净变化；第一阶段只显示“使用金币补签”。成功后刷新月历和余额；余额不足不得本地伪造结果。

- [ ] **Step 4: 覆盖日期边界测试**

测试香港月初、月末、闰年 2 月、今天不可补、未来不可点、上月不可补、重复点击只提交一次。

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test tests/unit/checkin.test.js tests/integration/player-center.test.js
git add src/routes/player.js assets/styles/player.css tests
git commit -m "feat: add daily checkin and coin makeup UI"
```

### Task 6: 完成活动和通知界面

**Files:**
- Modify: `src/routes/player.js`
- Modify: `assets/styles/player.css`
- Modify: `tests/integration/player-center.test.js`

- [ ] **Step 1: 渲染活动列表与详情**

活动卡显示标题、有效期、奖励、领取状态和安全封面；正文使用 `textContent`，不得使用管理员输入拼接 `innerHTML`。按钮链接只使用服务端已校验 URL。

- [ ] **Step 2: 接入活动领奖**

零奖励活动显示“已参与/查看活动”，正奖励活动显示“领取 N 金币”。成功后更新本活动状态和钱包；重复领取显示已领取，不回滚页面。

- [ ] **Step 3: 渲染通知收件箱**

通知按时间倒序，显示未读点、正文、关联活动入口、奖励状态和失效状态。进入详情即调用 `markRead`；领奖与已读是两个独立动作。

- [ ] **Step 4: 覆盖错误和空状态**

活动空状态、通知空状态、网络失败重试、游客领奖提示、过期通知、下架活动均有明确文案。

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test tests/unit/activities.test.js tests/unit/notifications.test.js tests/integration/player-center.test.js
git add src/routes/player.js assets/styles/player.css tests
git commit -m "feat: add activity and notification views"
```

### Task 7: 增加全站通知铃铛和玩家中心入口

**Files:**
- Create: `src/routes/notification-bell.js`
- Modify: `index.html`
- Modify: `game/index.html`
- Modify: `assets/styles/portal.css`
- Modify: `assets/styles/game.css`
- Modify: `tests/integration/portal.test.js`
- Modify: `tests/integration/game.test.js`

- [ ] **Step 1: 写导航结构失败测试**

首页和游戏页都必须包含 `/player/` 入口、通知铃铛、未读数字节点，并在账号初始化后加载通知服务。

- [ ] **Step 2: 实现通知铃铛控制器**

铃铛通过 `countUnread()` 请求权威未读总数，并只拉最近通知用于入口状态；不得用当前分页列表计数。注册用户显示数字，游客只显示入口。点击进入 `/player/?tab=notifications`。页面可见时刷新，避免后台定时高频请求。

- [ ] **Step 3: 更新导航和窄屏样式**

不得挤压现有品牌和账号入口；小屏仅显示图标和可访问名称，未读数上限显示 `99+`。

- [ ] **Step 4: 运行测试并提交**

```powershell
node --test tests/integration/portal.test.js tests/integration/game.test.js
git add index.html game/index.html src/routes/notification-bell.js assets/styles tests/integration
git commit -m "feat: add player center and notification navigation"
```

### Task 8: 创建统一管理中心并迁移原管理功能

**Files:**
- Create: `admin/index.html`
- Create: `src/routes/admin.js`
- Create: `assets/styles/admin.css`
- Create: `tests/integration/admin-center.test.js`
- Modify: `game/index.html`
- Modify: `src/routes/game.js`
- Modify: `src/routes/account-panel.js`
- Modify: `tests/integration/game.test.js`
- Modify: `tests/integration/stats.test.js`

- [ ] **Step 1: 写管理中心结构失败测试**

管理中心包含六个首阶段分区：活动、签到规则、通知、赛季、兑换码、系统状态。断言非管理员状态不会渲染管理表单，并显示返回首页入口。

- [ ] **Step 2: 创建权限门禁**

页面等待 account 初始化和 economy snapshot；未登录引导登录，普通用户显示无权限，管理员才并行加载配置数据。前端门禁只改善体验，服务端 RPC 仍是最终权限边界。

- [ ] **Step 3: 实现活动排期表单**

字段与数据库契约一致；时间输入按浏览器本地显示，提交转 ISO UTC。保存成功显示“已排期，将于 … 自动发布”；列表支持编辑和提前下架。

- [ ] **Step 4: 实现签到规则版本表单**

七天奖励均为 `0..1000000` 整数，补签费用同范围，生效日期不得早于香港今天。历史版本只读，不允许覆盖过去规则。

- [ ] **Step 5: 实现独立通知表单**

字段：标题、正文、奖励金币、立即可见时间、可选失效时间。发布后通过 `adminList()` 刷新列表，显示活动关联来源、可见/失效/停用状态、已读人数、领取人数和停用按钮。

- [ ] **Step 6: 迁移赛季和兑换码管理**

把 `game/index.html` 的 `admin-view` 标记及 `game.js` 中仅服务管理页的赛季/兑换码渲染与事件迁到 `admin.js`；复用现有 `economyClient` 和 `statsClient` 公共方法，不复制 SQL 或业务规则。

`account-panel.js` 默认后台地址从：

```js
'/game/?view=admin'
```

改为：

```js
'/admin/'
```

旧 `/game/?view=admin` 解析后使用 `location.replace('/admin/')` 保持书签兼容。

- [ ] **Step 7: 运行管理中心测试并提交**

```powershell
node --test tests/integration/admin-center.test.js tests/integration/game.test.js tests/integration/stats.test.js
git add admin game src/routes assets/styles tests/integration
git commit -m "feat: add unified site administration"
```

### Task 9: 完成真实 Supabase 冒烟脚本与全量验收

**Files:**
- Create: `database/supabase/verify-engagement.sql`
- Modify: `docs/superpowers/plans/2026-07-18-phase-1-engagement-center.md` only if verified commands differ

- [ ] **Step 1: 在 Supabase 测试项目应用迁移**

按项目既有部署方式执行 `20260722_engagement.sql`。不得直接在生产项目首次试跑。

- [ ] **Step 2: 用三类账号冒烟**

准备管理员、普通注册用户、游客会话，验证：

```text
管理员可排期活动、配置七日奖励、发布带金币通知
普通用户不能调用任何 admin RPC
游客可浏览公开活动通知但不能签到或领奖
同一用户重复活动/通知领取只到账一次
并发提交当天签到只生成一条签到记录和一笔奖励
金币不足补签不产生签到记录，也不产生部分流水
香港日期跨日后当天签到日期正确
```

同时运行 `database/supabase/verify-engagement.sql` 的可失败断言，直接查询真实项目：

```text
pg_policies：业务表 RLS 与 notification_reads 本人 SELECT
pg_publication_tables：仅 site_notifications、notification_reads
information_schema.role_*_grants / has_function_privilege：表 ACL、公开列表和 authenticated-only RPC
管理通知统计：已读/领取人数与源表真实记录一致
count_unread_site_notifications：跨分页、过期和停用通知计算正确
并发活动领取/通知领取/当天签到：唯一记录和单笔流水
金币不足补签：签到、扣费、奖励全部回滚
同一 request/稳定幂等键重试：余额和流水守恒
```

- [ ] **Step 3: 运行全部自动测试**

```powershell
node --test
```

Expected: 在现有 166 项基础上新增测试全部通过，0 fail。

- [ ] **Step 4: 执行静态质量检查**

```powershell
git diff --check -- . ':!assets/vendor/**'
git status --short
```

Expected: 无新增空白错误；状态只包含第一阶段计划内文件。

- [ ] **Step 5: 浏览器验收**

桌面和移动宽度分别检查首页、游戏页、玩家中心、管理中心；键盘完成 tab 切换、签到、补签确认、通知已读和领奖；网络失败后页面可重试且不重复发币。

- [ ] **Step 6: Final commit**

```powershell
git add database player admin src assets index.html game/index.html tests
git commit -m "feat: deliver engagement and admin centers"
```

## 第一阶段完成标准

- `/player/` 和 `/admin/` 可直接访问，导航入口完整。
- 管理员能排期活动、设置七日签到奖励与补签费用、发布通知并管理原赛季/兑换码。
- 注册用户能签到、用金币补当月漏签、查看活动通知并各领取一次金币。
- 游客只有浏览权限；普通用户无法绕过 RPC 调用管理接口。
- 所有金币变化有不可变流水、稳定事件类型和幂等键。
- `node --test`、真实 Supabase 冒烟、桌面/移动/键盘验收全部通过。
