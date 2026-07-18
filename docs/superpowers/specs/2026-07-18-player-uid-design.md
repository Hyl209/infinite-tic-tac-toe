# 玩家 UID 与双入口好友搜索设计

## 状态

已确认。作为第二阶段“好友关系与游戏邀请”的补充设计实施。

## 目标

- 每个正式注册玩家获得一个全站唯一、不可修改的 6 位 UID。
- UID 从 `000000` 开始，按注册顺序递增。
- 现有管理员账号固定回填为 `000000`，当前第二个账号回填为 `000001`。
- 好友搜索同时保留两种精确入口：6 位 UID、完整规范化用户名。

## 非目标

- 不改变用户名登录方式。
- 不提供模糊搜索、前缀搜索或全站玩家目录。
- 不允许用户选择、重置或修改自己的 UID。

## 数据模型与分配

`profiles` 新增：

```text
player_uid integer unique not null check 0..999999
```

数据库新增专用序列，使用 `MINVALUE 0`、`START 0`、`MAXVALUE 999999`。UID 在数据库中保存为整数，在 RPC 和前端统一格式化为 6 位字符串，例如 `0 -> "000000"`。

迁移现有账号时：

1. 管理员账号优先；多个管理员按 `profiles.created_at, profiles.id` 排序。
2. 其余账号按 `profiles.created_at, profiles.id` 排序。
3. 使用从 0 开始的连续序号回填。
4. 当前数据必须验收为管理员 `000000`、第二个账号 `000001`。
5. 序列移动到已分配最大值之后，后续注册继续递增。

新 profile 插入时由数据库触发器分配 UID。并发注册依赖序列原子性，不使用 `max(player_uid) + 1`。更新触发器拒绝任何 UID 变化。序列耗尽时返回稳定错误 `PLAYER_UID_EXHAUSTED`，不得回收已删除账号的 UID。

## 账号接口

账号身份模型增加：

```js
{
  kind: 'registered',
  uid: '000000',
  username,
  displayName,
  needsProfile,
}
```

游客身份的 `uid` 为 `null`。账号服务读取 profile 时必须包含 `player_uid`，但客户端注册和资料更新 payload 不得提交该字段。

## 好友搜索接口

保留现有精确用户名 RPC，并新增精确 UID RPC：

```text
search_player_by_username(p_username text)
search_player_by_uid(p_player_uid integer)
```

`friendsClient.searchExact(value)` 作为统一前端入口：

- 输入恰好 6 位 ASCII 数字时，按 UID 搜索。
- 其他输入按既有用户名规范化规则搜索。
- 两种搜索均只返回精确匹配，不自动降级为模糊搜索。
- 返回安全字段：玩家内部 ID、6 位 UID、用户名、游戏名，以及调用者与目标之间必要的好友/申请状态。

两个 RPC 都使用 `security definer`、固定 `search_path`、正式账号校验和显式 revoke/grant。普通用户不能直接读取其他人的 `profiles` 表，也不能枚举 UID 区间。

## 界面

- 玩家中心摘要、好友搜索结果、好友列表和申请列表显示 `UID 000000`。
- 搜索提示为“输入 6 位 UID 或完整用户名”。
- UID 仅作为稳定识别码；主要显示名仍为游戏名，用户名用于登录和第二搜索入口。
- 不增加与本阶段无关的公开用户目录、排行榜筛选或批量搜索。

## 错误处理

```text
INVALID_PLAYER_UID
PLAYER_NOT_FOUND
PLAYER_UID_EXHAUSTED
REGISTERED_ACCOUNT_REQUIRED
```

UID 必须是 6 位数字；前端可先提示格式错误，数据库 RPC 仍是最终校验边界。

## 测试与验收

- 迁移静态契约：序列从 0 开始、唯一/范围约束、不可修改触发器、精确 UID RPC 权限。
- 真实 Supabase 回填：当前管理员为 `000000`，第二个账号为 `000001`。
- 并发注册：多个新 profile 获得不同且递增的 UID。
- 不可变性：客户端和 RPC 均不能修改已分配 UID。
- 双入口搜索：UID 和完整用户名都能找到同一玩家；部分 UID、部分用户名和模糊输入不能命中。
- 安全：游客不能搜索；普通用户不能枚举 profiles 或绕过 RPC。
- 前端：所有相关列表使用统一 6 位显示，不丢失前导零。

## 第二阶段计划调整

- Task 1 增加 UID 序列、回填、不可变性、账号模型和 `search_player_by_uid` 契约红测。
- Task 2 在社交迁移中先完成 UID 回填与分配，再创建好友搜索 RPC。
- Task 3 将 `searchExact(username)` 扩展为统一 `searchExact(value)`，保留用户名行为并增加 UID 映射。
- Task 4 更新玩家中心搜索提示、结果、好友与申请列表。
- Task 7 的真实 Supabase 验收增加既有账号顺序、并发分配和双入口搜索。
