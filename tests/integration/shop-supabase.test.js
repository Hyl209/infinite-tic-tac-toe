const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationPath = './database/supabase/migrations/20260724_shop.sql';
const setupPath = './database/supabase/setup.sql';

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

test('shop migration and complete setup are present', () => {
  assert.equal(fs.existsSync(migrationPath), true, `missing ${migrationPath}`);
  assert.equal(fs.existsSync(setupPath), true, `missing ${setupPath}`);
});

for (const [label, path] of [
  ['shop migration', migrationPath],
  ['complete setup', setupPath],
]) {
  test(`${label} defines shop tables and RPC surface`, () => {
    const sql = clean(read(path));
    for (const table of ['shop_products', 'shop_purchases', 'player_items', 'item_ledger']) {
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
    const sql = clean(read(path));
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

  test(`${label} restricts shop writes to authenticated RPCs`, () => {
    const sql = clean(read(path));
    for (const rpc of [
      'get_player_inventory', 'buy_shop_product', 'admin_list_shop_products',
      'admin_update_shop_product', 'rename_with_item',
    ]) {
      assertAuthenticatedOnly(sql, rpc);
    }
    assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.list_shop_products\s*\([^;]*\)\s+to\s+anon\s*,\s*authenticated/i);
    for (const table of ['shop_products', 'shop_purchases', 'player_items', 'item_ledger']) {
      assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
      assert.match(sql, new RegExp(`revoke\\s+(?:insert|update|delete|all)[^;]*on\\s+table\\s+public\\.${table}[^;]*from\\s+anon\\s*,\\s*authenticated`, 'i'));
    }
  });
}
