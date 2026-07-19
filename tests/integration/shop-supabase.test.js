const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = './database/supabase/migrations/20260724_shop.sql';
const idempotencyMigrationPath = './database/supabase/migrations/20260726_shop_rename_idempotency.sql';
const setupPath = './database/supabase/setup.sql';
const verifyPath = './database/supabase/verify-shop.sql';

function read(path) {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
}

function clean(sql) {
  return sql.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function extractFunction(sql, name) {
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?as\\s+\\$([a-z0-9_]*)\\$([\\s\\S]*?)\\$\\1\\$\\s*;`,
    'gi',
  );
  const matches = [...clean(sql).matchAll(pattern)];
  return matches.at(-1)?.[2] || '';
}

function assertAuthenticatedOnly(sql, rpc) {
  assert.match(sql, new RegExp(
    `revoke\\s+execute\\s+on\\s+function\\s+public\\.${rpc}\\s*\\([^;]*\\)\\s+from\\s+public\\s*,\\s*anon`,
    'i',
  ));
  assert.match(sql, new RegExp(
    `grant\\s+execute\\s+on\\s+function\\s+public\\.${rpc}\\s*\\([^;]*\\)\\s+to\\s+authenticated`,
    'i',
  ));
}

test('shop migrations and complete setup are present', () => {
  assert.equal(fs.existsSync(migrationPath), true, `missing ${migrationPath}`);
  assert.equal(fs.existsSync(idempotencyMigrationPath), true, `missing ${idempotencyMigrationPath}`);
  assert.equal(fs.existsSync(setupPath), true, `missing ${setupPath}`);
});

test('shop acceptance verifier is read-only and covers conservation checks', () => {
  assert.equal(fs.existsSync(verifyPath), true, `missing ${verifyPath}`);
  const sql = clean(read(verifyPath));
  assert.doesNotMatch(sql, /^\s*(?:insert|update|delete|truncate|create|alter|drop)\b/im);
  for (const token of [
    'shop_products', 'shop_purchases', 'player_items', 'item_ledger', 'rename_requests',
    'coin_ledger', 'player_wallets', 'item_ledger_immutable',
    'shop_purchase:', 'shop_item:', 'makeup_item:', 'rename_with_item',
  ]) {
    assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), token);
  }
  assert.match(sql, /sum\s*\(\s*delta\s*\)/i);
  assert.match(sql, /quantity\s*<>\s*coalesce/i);
  assert.match(sql, /wallet\.balance\s*<>\s*coalesce/i);
  for (const text of ['补签卡', '抵扣一次补签金币费用', '改名卡', '修改一次注册账号游戏名']) {
    assert.match(sql, new RegExp(text), `fixed product metadata: ${text}`);
  }
  assert.match(sql, /row\s*\(\s*product\.name(?:::text)?\s*,\s*product\.description\s*\)\s+is\s+distinct\s+from\s+row/i);
  assert.match(sql, /v_existing\.reference_id\s+is\s+distinct\s+from\s+p_reference_id/i);
  assert.match(sql, /v_user_id::text\s*\|\|\s*'+:'+\s*\|\|\s*v_game_name/i);
  for (const token of [
    'v_request.result_username', 'v_request.game_name::text', 'v_request.rename_card_quantity',
  ]) {
    assert.match(sql, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), token);
  }
  assert.match(sql, /item\.reference_id\s+is\s+distinct\s+from\s+request\.user_id::text\s*\|\|\s*':'\s*\|\|\s*request\.game_name[\s\S]*item\.reference_id\s+is\s+distinct\s+from\s+request\.user_id::text/i);
});

test('rename idempotency is delivered as a forward-compatible migration', () => {
  const sql = clean(read(idempotencyMigrationPath));
  assert.doesNotMatch(sql, /\b(?:drop\s+table|truncate|delete\s+from)\b/i);
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.rename_requests/i);
  const rename = extractFunction(sql, 'rename_with_item');
  assert.match(rename, /v_existing\.reference_id\s+is\s+not\s+distinct\s+from\s+v_user_id::text/i);
  assert.match(rename, /v_profile\.game_name\s+is\s+distinct\s+from\s+v_game_name[\s\S]*INVALID_ITEM_IDEMPOTENCY/i);
  assert.match(rename, /insert\s+into\s+public\.rename_requests[\s\S]*v_existing\.quantity_after[\s\S]*true/i);
});

for (const [label, source] of [
  ['sequential shop migrations', `${read(migrationPath)}\n${read(idempotencyMigrationPath)}`],
  ['complete setup', read(setupPath)],
]) {
  test(`${label} defines shop tables and RPC surface`, () => {
    const sql = clean(source);
    for (const table of ['shop_products', 'shop_purchases', 'player_items', 'item_ledger', 'rename_requests']) {
      assert.match(sql, new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.${table}\\b`, 'i'));
    }
    for (const rpc of [
      'list_shop_products', 'get_player_inventory', 'buy_shop_product',
      'admin_list_shop_products', 'admin_update_shop_product', 'rename_with_item',
      'apply_item_delta', 'prevent_item_ledger_mutation',
    ]) {
      assert.match(sql, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${rpc}\\b`, 'i'));
    }
  });

  test(`${label} locks inventory, idempotency, and immutable ledger contracts`, () => {
    const sql = clean(source);
    assert.match(sql, /sku\s+text\s+primary\s+key[\s\S]{0,240}check\s*\(\s*sku\s+in\s*\(\s*'makeup_card'\s*,\s*'rename_card'/i);
    assert.match(sql, /quantity\s+bigint[\s\S]{0,100}check\s*\(\s*quantity\s*>=\s*0\s*\)/i);
    assert.match(sql, /request_id\s+uuid[\s\S]{0,60}unique/i);
    assert.match(sql, /idempotency_key\s+text[\s\S]{0,60}unique/i);
    assert.match(sql, /create\s+trigger\s+item_ledger_immutable\s+before\s+update\s+or\s+delete\s+on\s+public\.item_ledger/i);
    assert.match(extractFunction(sql, 'apply_item_delta'), /for\s+update/i);
    assert.match(extractFunction(sql, 'buy_shop_product'), /from\s+public\.shop_products[\s\S]*for\s+update/i);
    assert.doesNotMatch(extractFunction(sql, 'buy_shop_product'), /p_price|p_unit_price|p_total_price/i);
    assert.match(extractFunction(sql, 'rename_with_item'), /public\.apply_item_delta\s*\(/i);
    assert.match(extractFunction(sql, 'perform_makeup_checkin'), /public\.apply_item_delta\s*\(/i);
  });

  test(`${label} binds item idempotency to the complete operation payload`, () => {
    const sql = clean(source);
    const applyItem = extractFunction(sql, 'apply_item_delta');
    for (const field of ['user_id', 'sku', 'delta', 'event_type', 'reference_id']) {
      assert.match(
        applyItem,
        new RegExp(`v_existing\\.${field}\\s+is\\s+distinct\\s+from\\s+p_${field === 'user_id' ? 'user' : field}`, 'i'),
        field,
      );
    }
    const rename = extractFunction(sql, 'rename_with_item');
    assert.match(rename, /v_user_id::text\s*\|\|\s*':'\s*\|\|\s*v_game_name/i);
  });

  test(`${label} records every rename request including same-name shortcuts`, () => {
    const sql = clean(source);
    const rename = extractFunction(sql, 'rename_with_item');
    assert.match(sql, /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.rename_requests\s*\([\s\S]*request_id\s+uuid\s+primary\s+key[\s\S]*user_id\s+uuid[\s\S]*game_name\s+varchar\s*\(\s*16\s*\)[\s\S]*result_username\s+text[\s\S]*rename_card_quantity\s+bigint[\s\S]*consumed\s+boolean/i);
    assert.match(rename, /pg_advisory_xact_lock\s*\([\s\S]*p_request_id::text/i);
    assert.match(rename, /from\s+public\.rename_requests[\s\S]*request_id\s*=\s*p_request_id/i);
    assert.match(rename, /v_request\.user_id\s+is\s+distinct\s+from\s+v_user_id[\s\S]*v_request\.game_name\s+is\s+distinct\s+from\s+v_game_name[\s\S]*INVALID_ITEM_IDEMPOTENCY/i);
    assert.match(
      rename,
      /return\s+query\s+select\s+v_request\.result_username\s*,\s*v_request\.game_name(?:::text)?\s*,\s*v_request\.rename_card_quantity\s*;\s*return\s*;/i,
    );
    assert.match(rename, /if\s+v_profile\.game_name\s*=\s*v_game_name\s+then[\s\S]*insert\s+into\s+public\.rename_requests[\s\S]*return\s+query/i);
    assert.ok(rename.indexOf('from public.rename_requests') < rename.indexOf('update public.profiles'));
  });

  test(`${label} restricts shop writes to authenticated RPCs`, () => {
    const sql = clean(source);
    for (const rpc of [
      'get_player_inventory', 'buy_shop_product', 'admin_list_shop_products',
      'admin_update_shop_product', 'rename_with_item',
    ]) {
      assertAuthenticatedOnly(sql, rpc);
    }
    assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.list_shop_products\s*\([^;]*\)\s+to\s+anon\s*,\s*authenticated/i);
    for (const table of ['shop_products', 'shop_purchases', 'player_items', 'item_ledger', 'rename_requests']) {
      assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
      assert.match(sql, new RegExp(`revoke\\s+(?:insert|update|delete|all)[^;]*on\\s+table\\s+public\\.${table}[^;]*from\\s+anon\\s*,\\s*authenticated`, 'i'));
    }
  });
}
