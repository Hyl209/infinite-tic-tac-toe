# 第二阶段：好友关系与游戏邀请 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为注册用户提供精确用户名好友搜索、好友申请、在线状态和等待房间内邀请好友加入对局的完整闭环。

**Architecture:** 好友关系、申请、在线心跳和邀请状态全部落在 Supabase。写操作仅通过事务 RPC；参与用户可在严格 RLS 下只读自己的申请和邀请，以支持 Realtime `postgres_changes` 提醒。现有房间创建、预览和加入 RPC 保持权威，不复制棋局逻辑。

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js test runner, Supabase PostgreSQL/RLS/RPC/Realtime, existing online room service

---

## 前置条件

- 第一阶段已合并，`/player/`、全站账号状态和通知入口可用。
- 现有 `online_games`、`OnlineGame.createOnlineClient()`、邀请 URL 和房间预览/加入流程通过测试。
- 只允许正式注册账号使用好友功能；匿名游客不进入好友搜索和邀请系统。

## 固定业务规则

- 只能按完整、规范化后的用户名精确搜索；不提供模糊搜索和全站用户目录。
- 禁止加自己、重复申请、反向重复申请和重复好友关系。
- 拒绝申请后删除待处理记录；删除好友后双方关系立即解除，可重新申请。
- 好友在线状态：最后心跳距当前不超过 `90` 秒为在线；页面可见时每 `45` 秒心跳一次。
- 游戏邀请只能从已经创建且仍在等待对手的房间发起；房主一次只邀请一名好友。
- 同一房间同时最多一条有效邀请；重新邀请前必须取消、拒绝或等待过期。
- 邀请有效期为房间有效期和发送后 `15` 分钟两者的较早时间。
- 点击邀请只打开现有房间预览；好友真正成功加入后，数据库触发器把邀请标记为 `accepted`。
- 邀请记录状态固定为 `pending / accepted / declined / cancelled / expired`。

## 公共接口契约

```text
PlayerFriends.createFriendsClient({ accountClient })
  .searchExact(username)
  .listFriends()
  .listRequests()
  .sendRequest(userId)
  .acceptRequest(requestId)
  .rejectRequest(requestId)
  .removeFriend(userId)
  .heartbeat()
  .listInvites()
  .sendGameInvite(gameId, friendId)
  .cancelGameInvite(inviteId)
  .declineGameInvite(inviteId)
  .subscribe(listener)
  .disconnect()

HYLGameFriends.mount({ accountPanel, onMessage })
  .setWaitingRoom(gameOrNull)
  .destroy()
```

RPC 名称固定为：

```text
search_player_by_username
list_friends
list_friend_requests
send_friend_request
accept_friend_request
reject_friend_request
remove_friend
heartbeat_player_presence
list_game_invites
send_game_invite
cancel_game_invite
decline_game_invite
```

### Task 1: 锁定好友数据库和前端结构测试

**Files:**
- Create: `tests/integration/social-supabase.test.js`
- Modify: `tests/integration/structure.test.js`
- Modify: `tests/integration/player-center.test.js`
- Modify: `tests/integration/game.test.js`

- [ ] **Step 1: 写数据库契约失败测试**

测试读取 `database/supabase/migrations/20260723_social.sql` 和 `setup.sql`，断言以下表与 RPC：

```js
const tables = [
  'friend_requests',
  'friendships',
  'player_presence',
  'game_invites',
];

const rpcs = [
  'search_player_by_username',
  'list_friends',
  'list_friend_requests',
  'send_friend_request',
  'accept_friend_request',
  'reject_friend_request',
  'remove_friend',
  'heartbeat_player_presence',
  'list_game_invites',
  'send_game_invite',
  'cancel_game_invite',
  'decline_game_invite',
];
```

同时断言：好友 canonical pair 唯一、邀请每房间仅一条 pending、`online_games` 外键、`for update`、`90 seconds`、`15 minutes`、Realtime publication、参与者只读 RLS、无客户端直接写权限。

- [ ] **Step 2: 扩展结构测试**

加入：

```text
src/services/friends.js
src/routes/game-friends.js
src/routes/social-inbox.js
tests/unit/friends.test.js
tests/integration/social-supabase.test.js
```

- [ ] **Step 3: 写玩家中心和游戏页失败测试**

玩家中心必须增加 `friends` tab、好友搜索、收到/发出申请、好友列表、邀请收件箱；游戏等待区必须增加“邀请好友”按钮和好友选择 dialog。

- [ ] **Step 4: 运行并确认仅因功能缺失而失败**

```powershell
node --test tests/integration/social-supabase.test.js tests/integration/player-center.test.js tests/integration/game.test.js tests/integration/structure.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add tests/integration
git commit -m "test: define friend and invite contracts"
```

### Task 2: 创建好友和邀请数据库迁移

**Files:**
- Create: `database/supabase/migrations/20260723_social.sql`
- Modify: `database/supabase/setup.sql`
- Test: `tests/integration/social-supabase.test.js`

- [ ] **Step 1: 创建好友申请和关系表**

固定结构：

```text
friend_requests
  id uuid primary key
  requester_id uuid -> auth.users
  recipient_id uuid -> auth.users
  created_at timestamptz
  check requester_id <> recipient_id

friendships
  user_low uuid -> auth.users
  user_high uuid -> auth.users
  created_at timestamptz
  primary key (user_low, user_high)
  check user_low::text < user_high::text
```

为申请建立 canonical pair 唯一索引：

```sql
unique (least(requester_id::text, recipient_id::text), greatest(requester_id::text, recipient_id::text))
```

接受申请时按 UUID 文本顺序写入 `friendships`，随后删除申请。拒绝申请只允许收件人执行并删除记录。

- [ ] **Step 2: 创建在线状态和游戏邀请表**

```text
player_presence
  user_id uuid primary key
  last_seen_at timestamptz

game_invites
  id uuid primary key
  game_id uuid -> online_games(id)
  sender_id uuid -> auth.users
  recipient_id uuid -> auth.users
  status text
  expires_at timestamptz
  created_at / updated_at
```

建立 `where status='pending'` 的 `game_id` 唯一部分索引，并为收件人的 `status, created_at desc` 建索引。

- [ ] **Step 3: 实现精确搜索和好友列表 RPC**

`search_player_by_username(p_username text)` 必须使用现有用户名规范化规则，只在完全匹配时返回 `user_id, username, game_name, relationship_state`；不得返回邮箱或支持 `%` 模糊匹配。

`list_friends()` 返回双方视角统一的好友 ID、用户名、游戏名、`online`、`last_seen_at`。在线判断固定为：

```sql
presence.last_seen_at >= now() - interval '90 seconds'
```

- [ ] **Step 4: 实现申请事务 RPC**

发送申请前依次校验：正式账号、目标存在、不是自己、未成为好友、两个方向都无 pending。接受时锁定申请且仅收件人可操作；并发接受只产生一条好友关系。

稳定错误码至少包含：

```text
PLAYER_NOT_FOUND
CANNOT_FRIEND_SELF
FRIEND_REQUEST_EXISTS
ALREADY_FRIENDS
FRIEND_REQUEST_NOT_FOUND
FRIEND_REQUEST_NOT_RECIPIENT
```

- [ ] **Step 5: 实现在线心跳 RPC**

`heartbeat_player_presence()` 对 `auth.uid()` upsert 当前时间；客户端不能传其他用户 ID。表不开放直接写权限。

- [ ] **Step 6: 实现游戏邀请 RPC**

`send_game_invite(p_game_id uuid, p_recipient_id uuid)` 锁定房间并校验：

```text
发送者为 x_player
发送者是正式账号
房间 status='waiting'
o_player is null
接收者与发送者为好友
接收者是正式账号
房间尚未过期
当前房间无 pending 邀请
```

邀请 `expires_at = least(room.expires_at, now() + interval '15 minutes')`。

取消仅发送者可操作；拒绝仅接收者可操作；列表 RPC 先把到期 pending 更新为 `expired`。

- [ ] **Step 7: 用触发器同步房间和邀请状态**

在 `online_games` 的 `o_player/status` 更新后：

```text
若好友成功成为 o_player：把对应 pending 邀请更新为 accepted
若房间离开 waiting：把其他 pending 邀请更新为 cancelled
```

触发器不得修改棋局字段，不得改变现有加入 RPC 返回结构。

- [ ] **Step 8: 配置只读 RLS 和 Realtime**

`friend_requests`、`friendships`、`game_invites` 只允许相关用户 SELECT；所有 INSERT/UPDATE/DELETE 均通过 RPC。将申请和邀请表加入 `supabase_realtime` publication，确保用户只能收到涉及自己的行。

- [ ] **Step 9: 同步 setup.sql 并运行测试**

```powershell
node --test tests/integration/social-supabase.test.js tests/integration/supabase.test.js
```

Expected: PASS，原房间 SQL 测试仍通过。

- [ ] **Step 10: Commit**

```powershell
git add database/supabase tests/integration
git commit -m "feat: add friend and game invite database"
```

### Task 3: 实现好友服务客户端

**Files:**
- Create: `src/services/friends.js`
- Create: `tests/unit/friends.test.js`

- [ ] **Step 1: 写 RPC 参数和状态映射失败测试**

覆盖精确搜索、好友列表、收到/发出申请、在线状态、发送/取消/拒绝邀请、游客拒绝、错误映射和 Realtime 清理。

期望模型：

```js
{
  id,
  username,
  displayName,
  online,
  lastSeenAt,
}

{
  id,
  direction: 'incoming' | 'outgoing',
  player,
  createdAt,
}

{
  id,
  gameId,
  gameType,
  roomCode,
  wagerAmount,
  sender,
  status,
  expiresAt,
}
```

- [ ] **Step 2: 验证测试先失败**

```powershell
node --test tests/unit/friends.test.js
```

- [ ] **Step 3: 实现 RPC 客户端**

客户端只接受规范化完整用户名；所有写操作调用 RPC。`subscribe()` 订阅当前用户可见的 `friend_requests` 和 `game_invites` 变更，收到事件后通知页面重新拉取，不能把 Realtime payload 当最终业务状态。

- [ ] **Step 4: 实现心跳生命周期**

登录后立即心跳；页面可见时每 45 秒执行；`visibilitychange` 回到前台立即补一次；退出、身份切换和 `disconnect()` 清理 timer/channel。

- [ ] **Step 5: 映射稳定中文错误**

除数据库错误外，覆盖房间类错误：

```text
ROOM_NOT_FOUND
ROOM_EXPIRED
ROOM_FULL
ROOM_NOT_WAITING
NOT_ROOM_OWNER
GAME_INVITE_EXISTS
GAME_INVITE_NOT_FOUND
GAME_INVITE_EXPIRED
```

- [ ] **Step 6: 运行测试并提交**

```powershell
node --test tests/unit/friends.test.js
git add src/services/friends.js tests/unit/friends.test.js
git commit -m "feat: add friends service client"
```

### Task 4: 在玩家中心完成好友管理

**Files:**
- Modify: `player/index.html`
- Modify: `src/routes/player.js`
- Modify: `assets/styles/player.css`
- Modify: `tests/integration/player-center.test.js`

- [ ] **Step 1: 新增 friends tab 和稳定 DOM ID**

```text
player-tab-friends
friend-search-form
friend-search-result
incoming-friend-requests
outgoing-friend-requests
friend-list
game-invite-list
friend-message
```

- [ ] **Step 2: 实现精确搜索和申请状态**

输入沿用用户名规则 `[a-z0-9_]{3,20}`，提交后只显示一个精确结果。结果根据 `none / outgoing / incoming / friends / self` 显示唯一有效操作。

- [ ] **Step 3: 实现申请和好友列表操作**

收到申请提供接受/拒绝；发出申请只读显示；好友列表显示在线状态、最近在线和删除按钮。删除好友必须二次确认。

- [ ] **Step 4: 实现邀请收件箱**

pending 邀请显示游戏、房主、彩头、失效时间、“进入房间”和“拒绝”。“进入房间”只导航到现有邀请 URL，房间预览仍由 `OnlineGame` 完成。

- [ ] **Step 5: 接入 Realtime 刷新**

收到申请或邀请变化时只刷新好友 tab 数据，并显示非阻塞提示；页面不在 friends tab 时记录待处理数量。

- [ ] **Step 6: 运行测试并提交**

```powershell
node --test tests/unit/friends.test.js tests/integration/player-center.test.js
git add player src/routes/player.js assets/styles/player.css tests
git commit -m "feat: add friend management to player center"
```

### Task 5: 在等待房间加入好友邀请

**Files:**
- Create: `src/routes/game-friends.js`
- Modify: `game/index.html`
- Modify: `src/routes/game.js`
- Modify: `assets/styles/game.css`
- Modify: `tests/integration/game.test.js`

- [ ] **Step 1: 写等待房邀请结构失败测试**

断言存在：

```text
invite-friend-button
friend-invite-dialog
friend-invite-list
friend-invite-message
```

按钮只在“正式账号 + 自己创建的 waiting 房间 + 尚无对手”时显示。

- [ ] **Step 2: 创建独立 game-friends 控制器**

控制器接收共享 `accountPanel`，复用其 `accountClient`，不得创建第二个 Supabase client。`setWaitingRoom(null)` 必须关闭 dialog、清除列表和 pending 状态。

- [ ] **Step 3: 在 game.js 做最小接线**

`mountGame()` 创建控制器；每次在线状态变化调用：

```js
gameFriends.setWaitingRoom(
  onlineGame?.status === 'waiting' && onlineGame.playerMark === 'X'
    ? onlineGame
    : null,
);
```

离开房间和返回游戏专区时传 `null`。不要把好友列表渲染代码写进 `game.js`。

- [ ] **Step 4: 实现邀请 dialog**

只列出已接受好友，显示在线/离线，但允许邀请离线好友。发送成功后关闭选择操作，显示“邀请已发送，等待回应”；pending 邀请存在时显示接收者和取消按钮。

- [ ] **Step 5: 处理房间状态竞争**

发送期间禁用按钮；房间已加入对手、过期或已离开时关闭 dialog 并刷新房间状态。好友接受并成功加入后，现有 Realtime 房间更新自然进入对局。

- [ ] **Step 6: 运行测试并提交**

```powershell
node --test tests/integration/game.test.js tests/unit/friends.test.js tests/unit/online.test.js
git add game src/routes/game.js src/routes/game-friends.js assets/styles/game.css tests
git commit -m "feat: invite friends from waiting rooms"
```

### Task 6: 增加全站社交提醒

**Files:**
- Create: `src/routes/social-inbox.js`
- Modify: `index.html`
- Modify: `game/index.html`
- Modify: `player/index.html`
- Modify: `src/routes/notification-bell.js`
- Modify: `tests/integration/portal.test.js`
- Modify: `tests/integration/game.test.js`
- Modify: `tests/integration/player-center.test.js`

- [ ] **Step 1: 创建社交收件箱控制器**

正式用户登录后订阅好友申请和邀请；新事件显示可关闭 toast，链接 `/player/?tab=friends`。同一个事件 ID 在当前会话只弹一次。

- [ ] **Step 2: 合并导航待处理数量**

扩展通知铃铛为：

```text
站点未读通知数 + 收到的好友申请数 + pending 游戏邀请数
```

铃铛仍进入通知页；toast 和玩家中心 friends tab 负责社交详情，避免铃铛弹层混合多种数据。

- [ ] **Step 3: 覆盖登出和多标签页**

登出立即清除订阅、toast 和社交数量；重复 Realtime 事件不得重复增加计数。重新登录后以数据库列表重算。

- [ ] **Step 4: 运行测试并提交**

```powershell
node --test tests/integration/portal.test.js tests/integration/game.test.js tests/integration/player-center.test.js
git add index.html game/index.html player/index.html src/routes tests/integration
git commit -m "feat: add realtime social inbox alerts"
```

### Task 7: 真实 Supabase 和端到端验收

**Files:**
- Create: `database/supabase/verify-social.sql`

- [ ] **Step 1: 在测试项目应用社交迁移**

确认 `supabase_realtime` publication 已包含两张新表且没有重复添加错误。

- [ ] **Step 2: 用三个注册账号验证好友生命周期**

```text
A 精确搜索 B 并发送申请
B 实时收到申请并接受
A/B 双方列表出现好友
A 不能再次申请 B，B 也不能反向申请 A
C 无法读取 A/B 的申请、关系、在线状态和邀请
A 删除 B 后双方列表同时消失
```

- [ ] **Step 3: 验证在线状态**

A 保持页面可见、B 查询为在线；停止 A 心跳超过 90 秒后，B 查询为离线并显示最后在线时间。

- [ ] **Step 4: 验证游戏邀请生命周期**

```text
A 创建等待房并邀请 B
B 实时收到邀请，点击后看到正确游戏、房主和彩头
B 加入成功后邀请变 accepted，其他 pending 被取消
非好友、普通参与者、已满房间均不能发邀请
邀请拒绝、取消、15 分钟/房间过期均不可继续加入
```

- [ ] **Step 5: 运行全量测试**

```powershell
node --test
git diff --check -- . ':!assets/vendor/**'
```

Expected: 全部通过，0 fail，无新增空白错误。

- [ ] **Step 6: 浏览器验收**

使用两个独立浏览器会话验证申请、在线状态、等待房邀请和加入；再用移动宽度检查好友列表、dialog、toast 和键盘操作。

- [ ] **Step 7: Final commit**

```powershell
git add database src player game index.html assets tests
git commit -m "feat: deliver friends and game invitations"
```

## 第二阶段完成标准

- 注册用户可按完整用户名建立、拒绝和删除好友关系。
- 只有好友能看到在线/最近在线状态。
- 房主可在等待房邀请一个好友，邀请具备实时提醒、持久记录和完整过期处理。
- 好友实际加入仍走现有房间校验，邀请不能绕过房满、游戏类型、彩头和过期规则。
- 无关用户无法读取或修改他人的好友、在线和邀请数据。
- 全量 Node 测试、真实 Supabase 多账号验证和双浏览器验收全部通过。
