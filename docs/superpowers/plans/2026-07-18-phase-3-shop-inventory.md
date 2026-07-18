# 第三阶段：商城、背包与功能道具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 上线管理员可调价的固定功能道具商城、玩家背包、补签卡支付和改名卡消费，并保证金币与道具数量在并发和重试下守恒。

**Architecture:** 商品价格和状态由数据库保存，购买、扣币、入包、用卡和改名全部通过事务 RPC。新增不可变道具流水，与现有不可变金币流水互相校验。前端只提交 SKU、目标和请求 ID，不提交可信价格或余额。

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js test runner, Supabase PostgreSQL/RLS/RPC, existing economy/checkin/account services

---

## 前置条件

- 第一阶段玩家中心、管理中心、签到与金币补签已上线。
- 第二阶段可独立存在，但商城不依赖好友数据。
- 现有 `player_wallets`、`coin_ledger`、`apply_coin_delta` 和账号资料更新流程通过测试。

## 固定业务规则

- 商品 SKU 仅允许 `makeup_card` 和 `rename_card`，管理员不能创建第三种未知道具。
- 管理员可设置金币价格、上下架状态和可选的每人终身限购数量。
- 商品首次迁移时均为下架；上线前由管理员设置价格后手动上架，避免未经确认的经济参数进入生产。
- 每次购买数量固定为 `1`；服务端读取当前价格并原子扣币、写购买记录、增加背包和写道具流水。
- 下架只阻止新购买，已持有道具仍可使用。
- 补签时用户在金币和补签卡之间明确选择；补签卡支付不再扣金币，仍发放漏签日奖励。
- 注册时设置游戏名免费；注册完成后的每次真实改名消耗 `1` 张改名卡。
- 新名称与当前名称相同时直接返回成功且不消耗道具；响应丢失后的重复提交因此不会重复耗卡。
- 背包数量不得为负；道具流水不可更新或删除。

## 公共接口契约

```text
PlayerShop.createShopClient({ accountClient })
  .listProducts()
  .getInventory()
  .buy(sku, requestId)
  .adminListProducts()
  .adminUpdateProduct(input)

PlayerCheckin.createCheckinClient({ accountClient })
  .makeUp(date, 'coins' | 'item', requestId)

PlayerAccount.createAccountClient(...)
  .updateGameName(gameName)
```

`updateGameName()` 的外部方法名保持不变；内部从直接 upsert 改为调用 `rename_with_item`。

RPC 名称固定为：

```text
list_shop_products
get_player_inventory
buy_shop_product
admin_list_shop_products
admin_update_shop_product
rename_with_item
```

内部数据库函数固定为：

```text
apply_item_delta
prevent_item_ledger_mutation
```

### Task 1: 锁定商城、背包和改名契约测试

**Files:**
- Create: `tests/integration/shop-supabase.test.js`
- Modify: `tests/integration/structure.test.js`
- Modify: `tests/integration/player-center.test.js`
- Modify: `tests/integration/admin-center.test.js`
- Modify: `tests/unit/account.test.js`
- Modify: `tests/unit/checkin.test.js`

- [ ] **Step 1: 写数据库契约失败测试**

读取 `database/supabase/migrations/20260724_shop.sql` 和 `setup.sql`，断言：

```js
const tables = [
  'shop_products',
  'shop_purchases',
  'player_items',
  'item_ledger',
];

const rpcs = [
  'list_shop_products',
  'get_player_inventory',
  'buy_shop_product',
  'admin_list_shop_products',
  'admin_update_shop_product',
  'rename_with_item',
];
```

同时断言：SKU check、非负库存、购买 request ID 唯一、道具流水幂等键唯一、不可变 trigger、购买和用卡使用 `for update`、购买从表读取价格、改名与补签调用 `apply_item_delta`、所有写接口仅 authenticated。

- [ ] **Step 2: 扩展结构守卫**

加入：

```text
src/services/shop.js
tests/unit/shop.test.js
tests/integration/shop-supabase.test.js
```

- [ ] **Step 3: 写前端失败测试**

玩家中心必须增加 `shop` 和 `inventory` tab；管理中心必须增加商品配置区；账号改名文案必须说明消耗改名卡；签到补签确认必须同时支持 coins/item。

- [ ] **Step 4: 验证测试先失败**

```powershell
node --test tests/integration/shop-supabase.test.js tests/integration/player-center.test.js tests/integration/admin-center.test.js tests/unit/account.test.js tests/unit/checkin.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add tests
git commit -m "test: define shop and inventory contracts"
```

### Task 2: 创建商城与道具数据库迁移

**Files:**
- Create: `database/supabase/migrations/20260724_shop.sql`
- Modify: `database/supabase/setup.sql`
- Test: `tests/integration/shop-supabase.test.js`

- [ ] **Step 1: 创建商品、购买、库存和流水表**

固定结构：

```text
shop_products
  sku text primary key check ('makeup_card','rename_card')
  name varchar(40)
  description text
  price bigint check price >= 0
  is_active boolean default false
  per_user_limit integer null check > 0
  sort_order integer
  updated_by uuid -> auth.users
  created_at / updated_at

shop_purchases
  id uuid primary key
  request_id uuid unique
  user_id uuid -> auth.users
  sku text -> shop_products
  unit_price bigint
  quantity integer default 1 check quantity=1
  total_price bigint
  created_at

player_items
  user_id uuid -> auth.users
  sku text -> shop_products
  quantity bigint check quantity >= 0
  updated_at
  primary key (user_id, sku)

item_ledger
  id bigint identity primary key
  user_id uuid
  sku text
  delta bigint check delta <> 0
  quantity_after bigint check quantity_after >= 0
  event_type text
  reference_id text
  idempotency_key text unique
  created_at
```

- [ ] **Step 2: 种下固定商品但保持下架**

```text
makeup_card / 补签卡 / 抵扣一次补签金币费用 / price 0 / inactive / sort 10
rename_card / 改名卡 / 修改一次注册账号游戏名 / price 0 / inactive / sort 20
```

使用 `insert ... on conflict do update` 时只补齐固定名称、说明和排序，不覆盖管理员已设置的价格、上下架和限购。

- [ ] **Step 3: 实现不可变道具流水和原子增减**

`apply_item_delta(p_user,p_sku,p_delta,p_event_type,p_reference_id,p_idempotency_key)` 必须：

```text
锁定 player_items 行；无行时按 0 创建
若幂等键已存在，返回已有 quantity_after
拒绝结果数量小于 0
更新库存并插入 item_ledger
返回最新数量
```

`item_ledger` 使用与金币流水相同的 update/delete 阻断 trigger。

- [ ] **Step 4: 实现商城列表和管理员配置 RPC**

公开列表仅返回已上架且 `price >= 1` 的固定商品，并为注册用户返回已购数量和剩余限购。

管理员更新必须验证：

```text
SKU 在固定集合内
price 为 0..1000000
is_active=true 时 price >= 1
per_user_limit 为 null 或 1..100000
```

- [ ] **Step 5: 实现购买事务 RPC**

`buy_shop_product(p_sku text, p_request_id uuid)` 流程固定为：

```text
要求正式账号
按 SKU for update 锁商品
若 request_id 已完成，返回原购买和当前余额/库存
校验商品上架和价格
统计该用户 SKU 历史购买数并校验限购
apply_coin_delta(..., -price, 'shop_purchase', purchase_id, 'shop_purchase:' || request_id)
写 shop_purchases
apply_item_delta(..., +1, 'shop_purchase', purchase_id, 'shop_item:' || request_id)
返回 sku, price_paid, balance, quantity, remaining_limit
```

不得接受客户端价格参数。

- [ ] **Step 6: 实现改名卡事务 RPC**

`rename_with_item(p_game_name text, p_request_id uuid)` 必须复用现有游戏名校验：1..16 字符、无控制字符。流程：

```text
锁定 profiles 行
名称与当前值相同则直接返回，不写流水
apply_item_delta(user,'rename_card',-1,'rename',user_id,'rename:' || request_id)
更新 profiles.game_name
返回 username, game_name, rename_card_quantity
```

任一步失败必须整体回滚。

- [ ] **Step 7: 扩展补签 RPC 支持道具支付**

覆盖第一阶段 `perform_makeup_checkin` 的最终定义：

```text
p_payment_method='coins'：保持原扣币逻辑
p_payment_method='item'：扣 1 张 makeup_card，payment_amount=1
两种方式都按历史规则发放该日奖励
未知支付方式抛 INVALID_MAKEUP_PAYMENT
```

道具幂等键使用 `makeup_item:<user_id>:<checkin_date>`；签到唯一键仍是最终防重复边界。

- [ ] **Step 8: 锁定权限并同步 setup.sql**

业务表启用 RLS，撤销客户端直接写；玩家读取库存和商品通过 RPC，管理员配置通过 admin RPC。把迁移完整同步到 `setup.sql` 最新位置。

- [ ] **Step 9: 运行数据库测试并提交**

```powershell
node --test tests/integration/shop-supabase.test.js tests/integration/engagement-supabase.test.js tests/integration/supabase.test.js
git add database/supabase tests/integration
git commit -m "feat: add shop and inventory database"
```

Expected: PASS，第一阶段签到契约更新为同时支持 coins/item。

### Task 3: 实现商城服务客户端

**Files:**
- Create: `src/services/shop.js`
- Create: `tests/unit/shop.test.js`

- [ ] **Step 1: 写失败测试**

覆盖商品映射、库存映射、购买参数、管理员更新、游客限制、限购状态和错误映射。

期望商品模型：

```js
{
  sku,
  name,
  description,
  price,
  active,
  purchaseLimit,
  purchasedCount,
  remainingLimit,
}
```

期望库存模型：

```js
{
  makeupCard: 0,
  renameCard: 0,
}
```

- [ ] **Step 2: 验证测试先失败**

```powershell
node --test tests/unit/shop.test.js
```

- [ ] **Step 3: 实现客户端**

`buy(sku, requestId)` 只提交 `p_sku` 和 `p_request_id`。客户端不得计算可信扣款；成功后使用 RPC 返回的余额和库存更新页面。

- [ ] **Step 4: 实现错误映射**

至少包含：

```text
PRODUCT_NOT_FOUND
PRODUCT_INACTIVE
PRODUCT_PRICE_INVALID
PURCHASE_LIMIT_REACHED
INSUFFICIENT_COINS
ITEM_NOT_FOUND
INSUFFICIENT_ITEMS
INVALID_PRODUCT_CONFIG
```

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test tests/unit/shop.test.js
git add src/services/shop.js tests/unit/shop.test.js
git commit -m "feat: add shop service client"
```

### Task 4: 在玩家中心增加商城和背包

**Files:**
- Modify: `player/index.html`
- Modify: `src/routes/player.js`
- Modify: `assets/styles/player.css`
- Modify: `tests/integration/player-center.test.js`

- [ ] **Step 1: 增加稳定页面结构**

```text
player-tab-shop
player-tab-inventory
shop-product-list
shop-purchase-dialog
inventory-list
shop-message
inventory-message
```

- [ ] **Step 2: 渲染商品和购买状态**

商品显示名称、说明、当前金币价格、已购/限购和购买按钮。余额不足、达到限购、提交中时禁用按钮，并显示准确原因。

- [ ] **Step 3: 实现购买确认和请求幂等**

打开确认框时生成 `requestId`，同一次确认重试复用该 ID；只有用户取消或 RPC 明确失败后才清除。成功后同时刷新余额、商品限购和背包。

- [ ] **Step 4: 渲染背包**

背包固定显示两种道具，即使数量为 0；改名卡提供“去修改游戏名”，补签卡提供“去签到月历”。下架商品不影响背包入口。

- [ ] **Step 5: 覆盖响应式和无障碍**

购买 dialog 具备标题、价格、确认/取消、Escape 行为；状态变化使用 `aria-live`。移动端商品列表不得横向溢出。

- [ ] **Step 6: 运行测试并提交**

```powershell
node --test tests/unit/shop.test.js tests/integration/player-center.test.js
git add player src/routes/player.js assets/styles/player.css tests
git commit -m "feat: add shop and inventory to player center"
```

### Task 5: 在管理中心增加商品配置

**Files:**
- Modify: `admin/index.html`
- Modify: `src/routes/admin.js`
- Modify: `assets/styles/admin.css`
- Modify: `tests/integration/admin-center.test.js`

- [ ] **Step 1: 增加商城管理分区**

固定展示补签卡和改名卡两行，每行包含价格、上架开关、可选每人限购、保存按钮和最近更新时间。

- [ ] **Step 2: 实现校验顺序**

前端先校验整数范围；上架时价格必须至少 1；空限购转换为 `null`。服务端错误仍需显示，不把前端校验当安全边界。

- [ ] **Step 3: 防止误上架**

从下架切换到上架时显示确认框，明确商品、价格和限购；保存成功后重新拉取服务端状态。

- [ ] **Step 4: 运行测试并提交**

```powershell
node --test tests/integration/admin-center.test.js tests/unit/shop.test.js
git add admin src/routes/admin.js assets/styles/admin.css tests
git commit -m "feat: add shop product administration"
```

### Task 6: 将补签卡接入签到流程

**Files:**
- Modify: `src/services/checkin.js`
- Modify: `tests/unit/checkin.test.js`
- Modify: `src/routes/player.js`
- Modify: `assets/styles/player.css`
- Modify: `tests/integration/player-center.test.js`

- [ ] **Step 1: 更新签到服务测试**

删除第一阶段 `item` 必须失败的预期，改为断言：

```js
client.makeUp('2026-07-10', 'item', requestId)
// RPC params: p_date, p_payment_method: 'item', p_request_id
```

并映射 `INSUFFICIENT_ITEMS`。

- [ ] **Step 2: 扩展补签确认框**

显示两个互斥选项：

```text
使用 N 金币
使用 1 张补签卡（当前持有 M）
```

补签卡为 0 时该选项禁用并提供商城链接；默认选择金币，不自动消耗卡。

- [ ] **Step 3: 成功后同步三类状态**

金币支付刷新月历和余额；道具支付刷新月历、余额和背包。任何失败都保留原页面数据并允许用户重新选择支付方式。

- [ ] **Step 4: 覆盖并发和重复点击 UI 测试**

提交期间两个支付选项和确认按钮均禁用；同一 request ID 不得产生两次 UI 成功提示。

- [ ] **Step 5: 运行测试并提交**

```powershell
node --test tests/unit/checkin.test.js tests/integration/player-center.test.js
git add src/services/checkin.js src/routes/player.js assets/styles/player.css tests
git commit -m "feat: support makeup cards for missed checkins"
```

### Task 7: 将改名卡接入账号流程

**Files:**
- Modify: `src/services/account.js`
- Modify: `tests/unit/account.test.js`
- Modify: `src/routes/account-panel.js`
- Modify: `index.html`
- Modify: `game/index.html`
- Modify: `player/index.html`
- Modify: `admin/index.html`
- Modify: `tests/integration/game.test.js`
- Modify: `tests/integration/portal.test.js`

- [ ] **Step 1: 重写账号服务测试契约**

保留注册首次保存资料的测试；把“修改游戏名直接 upsert”改为：

```text
updateGameName 调用 rename_with_item
成功返回更新后的身份和剩余改名卡数量
名称相同不报错
INSUFFICIENT_ITEMS 映射为“需要一张改名卡”
```

- [ ] **Step 2: 修改 updateGameName 实现**

客户端仍先做名称格式校验，然后调用：

```js
supabase.rpc('rename_with_item', {
  p_game_name: gameName,
  p_request_id: crypto.randomUUID(),
});
```

不得再从客户端直接 upsert 已注册用户的 `profiles.game_name`。注册流程的首次 `saveProfile` 保持不变。

- [ ] **Step 3: 更新账号弹窗文案与库存显示**

注册表单仍显示“设置游戏名”；已注册资料表单显示“修改游戏名，消耗 1 张改名卡”，同时显示当前卡数和商城入口。

- [ ] **Step 4: 防止响应丢失重复耗卡**

账号表单一次提交期间复用 request ID；若用户因响应丢失再次提交同一名称，服务端同名短路保证不再耗卡。

- [ ] **Step 5: 运行账号与页面测试并提交**

```powershell
node --test tests/unit/account.test.js tests/integration/portal.test.js tests/integration/game.test.js tests/integration/player-center.test.js tests/integration/admin-center.test.js
git add src/services/account.js src/routes/account-panel.js index.html game/index.html player/index.html admin/index.html tests
git commit -m "feat: require rename cards after registration"
```

### Task 8: 真实 Supabase 守恒和端到端验收

**Files:**
- Create: `database/supabase/verify-shop.sql`

- [ ] **Step 1: 在测试项目应用商城迁移**

确认两种商品初始为下架；用管理员把补签卡和改名卡设置测试价格并上架。

- [ ] **Step 2: 验证购买守恒**

```text
购买前余额 B、库存 Q
购买价格 P
购买后余额 B-P、库存 Q+1
coin_ledger 恰好一笔 shop_purchase
item_ledger 恰好一笔 shop_purchase
重复同 request ID 返回同一结果，不新增流水
并发购买在余额或限购边界只能成功允许的次数
```

- [ ] **Step 3: 验证补签卡守恒**

补签卡支付后卡数减 1、金币不扣补签费用、签到奖励只加一次；库存为 0 时整笔回滚，不产生签到或金币奖励。

- [ ] **Step 4: 验证改名卡守恒**

改名成功卡数减 1、资料更新；无卡改名失败且资料不变；提交当前同名不耗卡；并发两个不同新名称最多按实际成功次数消耗对应卡数，库存永不为负。

- [ ] **Step 5: 验证管理员与限购**

普通用户不能配置商品；下架阻止购买但不阻止用卡；达到终身限购后继续购买失败；管理员调价只影响后续购买，历史 `unit_price` 保持不变。

- [ ] **Step 6: 运行全量自动测试**

```powershell
node --test
git diff --check -- . ':!assets/vendor/**'
```

Expected: 全部通过，0 fail，无新增空白错误。

- [ ] **Step 7: 浏览器验收**

管理员配置并上架商品；普通用户购买、查看背包、选择补签卡补签、使用改名卡改名；移动端和键盘完成同样流程；刷新页面后余额、库存、名字和限购均与数据库一致。

- [ ] **Step 8: Final commit**

```powershell
git add database src player admin index.html game/index.html assets tests
git commit -m "feat: deliver shop inventory and utility items"
```

## 第三阶段完成标准

- 管理员只能配置两个固定商品，可调价格、上下架和终身限购。
- 玩家购买时价格由服务端决定，金币扣除、购买记录、入包和双流水原子完成。
- 玩家可明确选择金币或补签卡补签；两种方式都不会重复发奖励。
- 注册后的真实改名必须消耗改名卡，注册首次命名仍免费，同名提交不耗卡。
- 下架商品仍可使用已持有道具；并发和网络重试不会导致负库存、重复扣币或重复耗卡。
- 全量 Node 测试、真实 Supabase 守恒验证和桌面/移动/键盘验收全部通过。
