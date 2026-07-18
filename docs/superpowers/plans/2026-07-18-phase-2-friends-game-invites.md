# 第二阶段：好友关系与游戏邀请 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为注册用户提供 6 位 UID/完整用户名双入口精确好友搜索、好友申请、在线状态和等待房间内邀请好友加入对局的完整闭环。

**Architecture:** `profiles.player_uid` 由从 `0` 开始的 PostgreSQL 序列和触发器原子分配，数据库保存整数、RPC/前端显示 6 位字符串。好友关系、申请、在线心跳和邀请状态全部落在 Supabase；搜索和好友读取由 `security definer` RPC 安全连接资料，写操作仅通过事务 RPC。邀请链接携带邀请 ID，并由现有房间预览/加入 RPC 在可选参数存在时校验邀请状态；普通房间码流程保持兼容。

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js test runner, Supabase PostgreSQL/RLS/RPC/Realtime, existing online room service

---

## 前置条件

- 第一阶段已合并，`/player/`、全站账号状态和通知入口可用。
- 现有 `online_games`、`OnlineGame.createOnlineClient()`、邀请 URL 和房间预览/加入流程通过测试。
- 只允许正式注册账号使用好友功能；匿名游客不进入好友搜索和邀请系统。

## 固定业务规则

- 每个正式玩家拥有唯一、不可修改、不回收的 6 位 UID；从 `000000` 按注册顺序递增，数据库序列耗尽后稳定返回 `PLAYER_UID_EXHAUSTED`。
- 好友搜索同时支持“恰好 6 位 ASCII 数字 UID”和“完整、规范化用户名”两种精确入口；不提供模糊搜索、前缀搜索或全站用户目录。
- 禁止加自己、重复申请、反向重复申请和重复好友关系。
- 拒绝申请后删除待处理记录；删除好友后双方关系立即解除，可重新申请。
- 好友在线状态：最后心跳距当前不超过 `90` 秒为在线；页面可见时每 `45` 秒心跳一次。
- 游戏邀请只能从已经创建且仍在等待对手的房间发起；房主一次只邀请一名好友。
- 同一房间同时最多一条有效邀请；发送前必须在同一事务把已过期的旧 `pending` 更新为 `expired`，仍存在有效邀请时拒绝重复发送。
- 邀请有效期为房间有效期和发送后 `15` 分钟两者的较早时间。
- 好友邀请 URL 必须带 `invite=<uuid>`；旧邀请失效后带该 ID 的链接必须失效，未带邀请 ID 的普通房间码预览/加入保持兼容。
- 点击邀请只打开现有房间预览；好友真正成功加入后，数据库触发器先把匹配邀请标记为 `accepted`，再把其余仍为 `pending` 的邀请标记为 `cancelled`。
- 邀请记录状态固定为 `pending / accepted / declined / cancelled / expired`。

## 公共接口契约

```text
PlayerFriends.createFriendsClient({ accountClient })
  .searchExact(value)
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

OnlineGame.buildInviteUrl(currentUrl, roomCode, gameType, inviteId = null)
OnlineGame.createOnlineClient(...)
  .previewRoom(roomCode, gameType, inviteId = null)
  .joinRoom(roomCode, gameType, inviteId = null)
```

RPC 名称固定为：

```text
search_player_by_username
search_player_by_uid
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
- Modify: `tests/unit/account.test.js`
- Modify: `tests/unit/online.test.js`

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
  'search_player_by_uid',
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

同时断言：

```text
player_uid_seq 使用 MINVALUE 0 / START 0 / MAXVALUE 999999 / NO CYCLE
profiles.player_uid 为 integer unique not null 且限制 0..999999
现有 profile 按管理员优先、created_at、id 连续回填
INSERT 触发器独占分配 UID，UPDATE 触发器拒绝修改
序列和内部触发器函数不向 anon/authenticated 暴露
两个精确搜索 RPC 均 security definer、固定 search_path、显式 revoke/grant
好友 canonical pair 唯一、邀请每房间仅一条 pending
game_invites.game_id 外键 on delete cascade
for update、90 seconds、15 minutes
Realtime publication 包含 friend_requests、friendships、game_invites
参与者只读 RLS、无客户端直接写权限
preview_online_game/join_online_game 接受可选 invite ID，旧调用保持兼容
```

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

玩家中心必须增加 `friends` tab、好友搜索、收到/发出申请、好友列表、邀请收件箱，并在摘要、搜索结果、申请和好友列表显示统一 6 位 UID；游戏等待区必须增加“邀请好友”按钮和好友选择 dialog。

`tests/unit/account.test.js` 先锁定：游客 `uid=null`；注册身份读取 `player_uid` 并格式化为 6 位；注册和资料更新 payload 都不提交 `player_uid`。`tests/unit/online.test.js` 先锁定：带邀请 ID 时 URL、预览和加入 RPC 都携带 `p_invite_id`，普通房间码调用传 `null` 或省略默认值仍兼容。

- [ ] **Step 4: 运行并确认仅因功能缺失而失败**

```powershell
node --test tests/integration/social-supabase.test.js tests/integration/player-center.test.js tests/integration/game.test.js tests/integration/structure.test.js tests/unit/account.test.js tests/unit/online.test.js
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

- [ ] **Step 1: 回填并锁定玩家 UID**

先在同一迁移事务中创建专用序列和资料列：

```sql
create sequence if not exists public.player_uid_seq
  as integer minvalue 0 maxvalue 999999 start with 0 no cycle;

alter table public.profiles
  add column if not exists player_uid integer;
```

对首次迁移时仍为 `null` 的现有账号使用以下稳定顺序连续回填：管理员在前，其余账号在后；各组内按 `profiles.created_at, profiles.id` 排序。回填值为 `row_number() - 1`，随后把序列移动到已分配最大值；零账号环境必须让下一次分配得到 `0`。

```text
order by (admins.user_id is null), profiles.created_at, profiles.id
```

最后增加 `unique not null check (player_uid between 0 and 999999)`，并创建两个不可绕过的触发器：

```text
assign_player_uid before insert
  客户端显式提交 player_uid -> PLAYER_UID_SERVER_ASSIGNED
  若相同 profile.id 已存在（现有账号资料 upsert）-> 沿用原 player_uid，不调用 nextval
  nextval 达到上限 -> PLAYER_UID_EXHAUSTED

prevent_player_uid_change before update of player_uid
  new.player_uid is distinct from old.player_uid -> PLAYER_UID_IMMUTABLE
```

分配函数必须是 `security definer set search_path = public, pg_temp`；序列、分配函数和不可变函数全部 `revoke ... from public, anon, authenticated`，UID 删除后不回收。

- [ ] **Step 2: 创建好友申请和关系表**

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

- [ ] **Step 3: 创建在线状态和游戏邀请表**

```text
player_presence
  user_id uuid primary key
  last_seen_at timestamptz

game_invites
  id uuid primary key
  game_id uuid -> online_games(id) on delete cascade
  sender_id uuid -> auth.users
  recipient_id uuid -> auth.users
  status text
  expires_at timestamptz
  created_at / updated_at
```

建立 `where status='pending'` 的 `game_id` 唯一部分索引，并为收件人的 `status, created_at desc` 建索引。

- [ ] **Step 4: 实现双入口精确搜索和好友读取 RPC**

`search_player_by_uid(p_player_uid integer)` 必须拒绝 `null` 和 `0..999999` 之外的值并抛出 `INVALID_PLAYER_UID`；`search_player_by_username(p_username text)` 必须复用现有小写/去空格规范化及 `[a-z0-9_]{3,20}` 规则。两者都只允许正式账号调用，只在完全匹配时返回：

```text
user_id
player_uid = lpad(profiles.player_uid::text, 6, '0')
username
game_name
relationship_state = self | friends | incoming | outgoing | none
```

不得返回邮箱、支持 `%` 模糊匹配或暴露可枚举 profile 列表。`search_player_by_uid`、`search_player_by_username`、`list_friends`、`list_friend_requests` 和 `list_game_invites` 均使用 `security definer`、固定 `search_path`、正式账号校验和显式 revoke/grant；普通用户仍不能直接读取其他人的 `profiles`。

`list_friends()` 返回双方视角统一的好友 ID、6 位 UID、用户名、游戏名、`online`、`last_seen_at`。`list_friend_requests()` 必须返回 `incoming/outgoing` 方向，并同时返回 requester/recipient 的 ID、6 位 UID、用户名和游戏名，避免客户端二次读取 `profiles`。在线判断固定为：

```sql
presence.last_seen_at >= now() - interval '90 seconds'
```

- [ ] **Step 5: 实现申请事务 RPC**

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

- [ ] **Step 6: 实现在线心跳 RPC**

`heartbeat_player_presence()` 对 `auth.uid()` upsert 当前时间；客户端不能传其他用户 ID。表不开放直接写权限。

- [ ] **Step 7: 实现游戏邀请 RPC**

`send_game_invite(p_game_id uuid, p_recipient_id uuid)` 锁定房间并校验：

```text
发送者为 x_player
发送者是正式账号
房间 status='waiting'
o_player is null
接收者与发送者为好友
接收者是正式账号
房间尚未过期
先把 expires_at <= now() 的旧 pending 原子更新为 expired
当前房间无仍有效的 pending 邀请
```

邀请 `expires_at = least(room.expires_at, now() + interval '15 minutes')`。`list_game_invites()` 返回 `incoming/outgoing` 方向、sender/recipient 双方的 ID/6 位 UID/用户名/游戏名，以及房间类型、房间码、彩头和状态。

取消仅发送者可操作；拒绝仅接收者可操作；列表 RPC 先把到期 pending 更新为 `expired`。发送与清理必须在同一事务完成，并锁定房间后再检查唯一 pending，不能依赖唯一索引异常作为正常控制流。

- [ ] **Step 8: 让邀请 ID 参与房间预览和加入校验**

用向后兼容的可选参数替换现有 RPC 最终定义，并重新应用原 revoke/grant：

```text
preview_online_game(p_room_code text, p_game_type text, p_invite_id uuid default null)
join_online_game(p_room_code text, p_game_type text, p_guest_name text, p_invite_id uuid default null)
```

`p_invite_id is null` 时保持普通房间码现有行为；非空时必须锁定/读取对应邀请并同时校验：邀请存在、recipient 为当前正式账号、房间 ID 和房间码一致、状态为 `pending`、尚未过期。失败稳定返回 `GAME_INVITE_NOT_FOUND`、`GAME_INVITE_NOT_RECIPIENT` 或 `GAME_INVITE_EXPIRED`，不得因为链接过旧而自动降级为普通房间码加入。

- [ ] **Step 9: 用触发器同步房间和邀请状态**

在 `online_games` 的 `o_player/status` 更新后：

```text
若好友成功成为 o_player：先把该房间、该 recipient 的匹配 pending 邀请更新为 accepted
若房间离开 waiting：再把该房间其余仍为 pending 的邀请更新为 cancelled
```

触发器不得修改棋局字段，不得改变现有加入 RPC 返回结构。

- [ ] **Step 10: 配置只读 RLS 和 Realtime**

`friend_requests`、`friendships`、`game_invites` 只允许相关用户 SELECT；所有 INSERT/UPDATE/DELETE 均通过 RPC。将 `friend_requests`、`friendships`、`game_invites` 加入 `supabase_realtime` publication，确保用户只能收到涉及自己的行；`player_presence` 不直接广播，在线状态由安全列表 RPC 重新拉取。

- [ ] **Step 11: 同步 setup.sql 并运行测试**

```powershell
node --test tests/integration/social-supabase.test.js tests/integration/supabase.test.js
```

Expected: PASS，原房间 SQL 测试仍通过。

- [ ] **Step 12: Commit**

```powershell
git add database/supabase tests/integration
git commit -m "feat: add friend and game invite database"
```

### Task 3: 实现好友服务客户端

**Files:**
- Create: `src/services/friends.js`
- Create: `tests/unit/friends.test.js`
- Modify: `src/services/account.js`
- Modify: `tests/unit/account.test.js`

- [ ] **Step 1: 写账号 UID 与 RPC 参数映射失败测试**

先在 `tests/unit/account.test.js` 覆盖：

```text
游客 identity.uid === null
readProfile/select 和 saveProfile/select 都包含 player_uid
注册 identity 把整数 0 映射为字符串 "000000"
注册与 updateGameName 的 upsert payload 不包含 player_uid
非法或缺失 player_uid 不伪造 UID；缺资料账号保持 uid=null、needsProfile=true
```

再在 `tests/unit/friends.test.js` 覆盖：6 位 UID/完整用户名精确搜索的 RPC 选择和参数、好友列表、收到/发出申请、在线状态、发送/取消/拒绝邀请、游客拒绝、错误映射和 Realtime 清理。

期望模型：

```js
{
  id,
  uid,
  username,
  displayName,
  online,
  lastSeenAt,
}

{
  id,
  direction: 'incoming' | 'outgoing',
  requester,
  recipient,
  createdAt,
}

{
  id,
  gameId,
  gameType,
  roomCode,
  wagerAmount,
  sender,
  recipient,
  direction: 'incoming' | 'outgoing',
  status,
  expiresAt,
}
```

- [ ] **Step 2: 验证测试先失败**

```powershell
node --test tests/unit/account.test.js tests/unit/friends.test.js
```

- [ ] **Step 3: 扩展账号身份模型**

在 `src/services/account.js` 增加单一格式化函数：

```js
function formatPlayerUid(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 999999
    ? String(numeric).padStart(6, '0')
    : null;
}
```

`guestIdentity()` 固定 `uid: null`；`readProfile()` 和保存后的 `.select()` 读取 `player_uid`；`registeredIdentity()` 输出 `uid: formatPlayerUid(profile?.player_uid)`。`saveProfile()` 的 payload 仍只包含 `id, username, game_name`，客户端永不提交 UID。

- [ ] **Step 4: 实现 RPC 客户端**

`searchExact(value)` 使用 `/^[0-9]{6}$/` 选择入口：命中时调用 `search_player_by_uid({ p_player_uid: Number(value) })`；否则复用 `PlayerAccount.normalizeUsername/isValidUsername` 并调用 `search_player_by_username({ p_username: normalized })`。两种入口只返回一个精确结果，不互相降级。所有写操作调用 RPC。

`subscribe()` 订阅当前用户可见的 `friend_requests`、`friendships` 和 `game_invites` 变更，收到事件后通知页面重新拉取，不能把 Realtime payload 当最终业务状态。

- [ ] **Step 5: 实现心跳生命周期**

登录后立即心跳；页面可见时每 45 秒执行；`visibilitychange` 回到前台立即补一次；退出、身份切换和 `disconnect()` 清理 timer/channel。

- [ ] **Step 6: 映射稳定中文错误**

除数据库错误外，覆盖房间类错误：

```text
ROOM_NOT_FOUND
ROOM_EXPIRED
ROOM_FULL
ROOM_NOT_WAITING
NOT_ROOM_OWNER
GAME_INVITE_EXISTS
GAME_INVITE_NOT_FOUND
GAME_INVITE_NOT_RECIPIENT
GAME_INVITE_EXPIRED
INVALID_PLAYER_UID
PLAYER_UID_EXHAUSTED
```

- [ ] **Step 7: 运行测试并提交**

```powershell
node --test tests/unit/account.test.js tests/unit/friends.test.js
git add src/services/account.js src/services/friends.js tests/unit/account.test.js tests/unit/friends.test.js
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
player-summary-uid
friend-search-form
friend-search-input
friend-search-result
incoming-friend-requests
outgoing-friend-requests
friend-list
game-invite-list
friend-message
```

- [ ] **Step 2: 实现 UID/用户名双入口精确搜索和申请状态**

搜索提示固定为“输入 6 位 UID 或完整用户名”；输入恰好 6 位 ASCII 数字时按 UID 搜索，其他输入按现有用户名规则 `[a-z0-9_]{3,20}` 规范化后精确搜索。不得使用模糊查询，也不得在一种入口未命中后降级到另一入口。提交后只显示一个精确结果，结果根据 `none / outgoing / incoming / friends / self` 显示唯一有效操作。

- [ ] **Step 3: 实现申请和好友列表操作**

玩家中心摘要、搜索结果、收到/发出申请和好友列表统一显示 `UID 000000`；游戏名仍为主标题，用户名作为辅助身份。收到申请提供接受/拒绝；发出申请只读显示；好友列表显示在线状态、最近在线和删除按钮。删除好友必须二次确认。

- [ ] **Step 4: 实现邀请收件箱**

pending 邀请显示游戏、房主 UID/游戏名、彩头、失效时间、“进入房间”和“拒绝”。“进入房间”导航到同时包含 `room`、`game` 和 `invite` 的邀请 URL，房间预览仍由 `OnlineGame` 完成；若邀请已失效则显示稳定错误且不得静默删除 `invite` 参数重试。

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
- Modify: `src/services/online.js`
- Modify: `src/routes/game.js`
- Modify: `assets/styles/game.css`
- Modify: `tests/unit/online.test.js`
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

同时在 `tests/unit/online.test.js` 和 `tests/integration/game.test.js` 锁定：`resolveAppRoute()` 读取合法 UUID `invite` 参数，`buildAppUrl()` 在邀请流程中保留它；`buildInviteUrl()`、`previewRoom()` 和 `joinRoom()` 把同一个 invite ID 传到数据库，普通房间码不带该参数仍可预览/加入。

- [ ] **Step 2: 扩展线上房间可选邀请参数**

`src/services/online.js` 的 `buildInviteUrl(currentUrl, roomCode, gameType, inviteId = null)` 仅在 `inviteId` 非空时写入 `invite` 查询参数；`previewRoom`/`joinRoom` 接受同样的可选值并映射为 `p_invite_id`。`src/routes/game.js` 的 route 模型增加 `inviteId`，首次预览和确认加入复用同一个值；离开邀请流程或创建自己的房间时清除它。

- [ ] **Step 3: 创建独立 game-friends 控制器**

控制器接收共享 `accountPanel`，复用其 `accountClient`，不得创建第二个 Supabase client。`setWaitingRoom(null)` 必须关闭 dialog、清除列表和 pending 状态。

- [ ] **Step 4: 在 game.js 做最小接线**

`mountGame()` 创建控制器；每次在线状态变化调用：

```js
gameFriends.setWaitingRoom(
  onlineGame?.status === 'waiting' && onlineGame.playerMark === 'X'
    ? onlineGame
    : null,
);
```

离开房间和返回游戏专区时传 `null`。不要把好友列表渲染代码写进 `game.js`。

- [ ] **Step 5: 实现邀请 dialog**

只列出已接受好友，显示 6 位 UID 和在线/离线，但允许邀请离线好友。发送成功后关闭选择操作，显示“邀请已发送，等待回应”；pending 邀请存在时显示接收者和取消按钮。发给好友的链接必须使用 RPC 返回的邀请 ID，不得只复制普通房间码链接。

- [ ] **Step 6: 处理房间状态竞争**

发送期间禁用按钮；房间已加入对手、过期或已离开时关闭 dialog 并刷新房间状态。好友接受并成功加入后，现有 Realtime 房间更新自然进入对局。

- [ ] **Step 7: 运行测试并提交**

```powershell
node --test tests/integration/game.test.js tests/unit/friends.test.js tests/unit/online.test.js
git add game src/services/online.js src/routes/game.js src/routes/game-friends.js assets/styles/game.css tests
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

正式用户登录后订阅好友申请、好友关系和邀请；只有新的 incoming 申请/邀请显示可关闭 toast，链接 `/player/?tab=friends`。同一个“表名 + 事件 ID”在当前会话只弹一次；关系变更只触发重拉，不弹重复申请 toast。

- [ ] **Step 2: 合并导航待处理数量**

扩展通知铃铛为：

```text
站点未读通知数 + incoming 好友申请数 + incoming pending 游戏邀请数
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

确认迁移真实执行成功；从 `pg_sequences`、`information_schema.columns/table_constraints`、`pg_trigger`、`pg_policies`、`information_schema.role_*_grants` 和 `pg_publication_tables` 查询实际 catalog，验证 UID 序列/约束/触发器/权限，以及 `friend_requests`、`friendships`、`game_invites` 三张 Realtime 表。不得用迁移文本正则替代真实 catalog。

- [ ] **Step 2: 验证现有账号 UID 回填与不可变性**

按迁移规定的同一排序查询当前 profiles：管理员优先，其余按 `created_at, id`。必须确认第一行管理员为 `000000`、第二个账号为 `000001`，所有现有 UID 连续且唯一。

分别尝试通过客户端资料保存、直接 PostgREST update 和普通用户 RPC 修改 `player_uid`，均必须失败且原值不变。删除测试账号后注册新账号，确认已删除 UID 不回收。

- [ ] **Step 3: 验证并发注册和双入口搜索**

同时提交至少两个新 profile，确认获得不同且严格递增的 UID；重复执行查询确认无 `max(player_uid)+1` 竞争。用同一目标账号验证：

```text
6 位 UID 精确命中
完整规范化用户名精确命中同一 user_id
部分 UID 不按 UID 命中
部分用户名、前缀、大小写外的模糊表达式不命中
游客搜索 -> REGISTERED_ACCOUNT_REQUIRED
普通用户直接枚举 profiles 或调用 UID 序列/内部函数 -> denied
```

- [ ] **Step 4: 用三个注册账号验证好友生命周期**

```text
A 分别用 B 的 UID 和完整用户名搜索，结果 user_id/UID 一致，再发送申请
B 实时收到申请并接受
A/B 双方列表出现好友
A 不能再次申请 B，B 也不能反向申请 A
C 无法读取 A/B 的申请、关系、在线状态和邀请
A 删除 B 后双方列表同时消失
```

- [ ] **Step 5: 验证在线状态**

A 保持页面可见、B 查询为在线；停止 A 心跳超过 90 秒后，B 查询为离线并显示最后在线时间。

- [ ] **Step 6: 验证游戏邀请生命周期**

```text
A 创建等待房并邀请 B，邀请 URL 同时包含 room/game/invite
B 实时收到邀请，点击后看到正确游戏、房主 UID/游戏名和彩头
B 加入成功后邀请变 accepted，其他 pending 被取消
非好友、普通参与者、已满房间均不能发邀请
邀请拒绝、取消、15 分钟/房间过期后，旧 invite 链接均不可继续预览/加入
删除房间后关联邀请级联删除；不带 invite 的普通房间码仍保持原预览/加入兼容
```

- [ ] **Step 7: 运行全量测试**

```powershell
node --test
git diff --check -- . ':!assets/vendor/**'
```

Expected: 全部通过，0 fail，无新增空白错误。

- [ ] **Step 8: 浏览器验收**

使用三个独立浏览器会话验证 UID/用户名双入口、申请、在线状态、等待房邀请和加入；再用移动宽度检查 UID 前导零、好友列表、dialog、toast 和键盘操作。键盘必须能完成搜索、接受/拒绝申请、打开/关闭邀请 dialog 和进入房间。

- [ ] **Step 9: Final commit**

```powershell
git add database src player game index.html assets tests
git commit -m "feat: deliver friends and game invitations"
```

## 第二阶段完成标准

- 每个正式玩家拥有从 `000000` 开始、按注册顺序分配、不可修改且不回收的 6 位 UID；当前管理员为 `000000`，第二个账号为 `000001`。
- 注册用户可按 6 位 UID 或完整用户名精确找到同一玩家，并建立、拒绝和删除好友关系。
- 只有好友能看到在线/最近在线状态。
- 房主可在等待房邀请一个好友，邀请具备实时提醒、持久记录和完整过期处理。
- 好友邀请链接携带邀请 ID，失效邀请链接不能复用；普通房间码流程保持兼容。
- 好友实际加入仍走现有房间校验，邀请不能绕过房满、游戏类型、彩头和过期规则。
- 无关用户无法读取或修改他人的好友、在线和邀请数据。
- 全量 Node 测试、真实 Supabase 多账号验证和三会话浏览器验收全部通过。
