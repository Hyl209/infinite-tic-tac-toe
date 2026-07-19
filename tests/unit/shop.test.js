const test = require('node:test');
const assert = require('node:assert/strict');

let shop = {};
try {
  shop = require('../../src/services/shop.js');
} catch {
  shop = {};
}

function createFakeAccount({ kind = 'registered' } = {}) {
  const calls = [];
  const responses = new Map();
  const supabase = {
    async rpc(name, params) {
      calls.push([name, params]);
      return responses.get(name) || { data: null, error: null };
    },
  };
  return {
    calls,
    responses,
    accountClient: {
      getIdentity() {
        return { kind, username: kind === 'registered' ? 'player_01' : null };
      },
      async getSupabaseClient() {
        return supabase;
      },
    },
  };
}

test('商城客户端公开固定方法并映射稳定错误码', () => {
  const fake = createFakeAccount();
  assert.deepEqual(Object.keys(shop.createShopClient({ accountClient: fake.accountClient })).sort(), [
    'adminListProducts', 'adminUpdateProduct', 'buy', 'getInventory', 'listProducts',
  ]);
  const messages = {
    PRODUCT_NOT_FOUND: '商品不存在',
    PRODUCT_INACTIVE: '商品已下架',
    PRODUCT_PRICE_INVALID: '商品价格无效',
    PURCHASE_LIMIT_REACHED: '已达到限购数量',
    INSUFFICIENT_COINS: '金币不足',
    ITEM_NOT_FOUND: '道具不存在',
    INSUFFICIENT_ITEMS: '道具数量不足',
    INVALID_PRODUCT_CONFIG: '商品配置无效',
  };
  for (const [code, message] of Object.entries(messages)) {
    assert.equal(shop.mapShopError(new Error(code)), message);
  }
});

test('商品列表映射公开模型和限购状态', async () => {
  const fake = createFakeAccount();
  fake.responses.set('list_shop_products', { data: [{
    sku: 'makeup_card', name: '补签卡', description: '抵扣补签费用', price: '20',
    is_active: true, per_user_limit: 3, purchased_count: '3', remaining_limit: '0',
  }], error: null });
  const client = shop.createShopClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.listProducts(), [{
    sku: 'makeup_card',
    name: '补签卡',
    description: '抵扣补签费用',
    price: 20,
    active: true,
    purchaseLimit: 3,
    purchasedCount: 3,
    remainingLimit: 0,
  }]);
  assert.deepEqual(fake.calls, [['list_shop_products', undefined]]);
});

test('背包固定映射两种道具并把缺失行补零', async () => {
  const fake = createFakeAccount();
  fake.responses.set('get_player_inventory', {
    data: [{ sku: 'rename_card', quantity: '2' }], error: null,
  });
  const client = shop.createShopClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.getInventory(), { makeupCard: 0, renameCard: 2 });
  assert.deepEqual(fake.calls, [['get_player_inventory', undefined]]);
});

test('购买只提交 SKU 和 request ID 并映射服务端可信结果', async () => {
  const fake = createFakeAccount();
  fake.responses.set('buy_shop_product', { data: [{
    sku: 'rename_card', price_paid: '50', balance: '75', quantity: '2', remaining_limit: 1,
  }], error: null });
  const client = shop.createShopClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.buy('rename_card', 'req-1'), {
    sku: 'rename_card', pricePaid: 50, balance: 75, quantity: 2, remainingLimit: 1,
  });
  assert.deepEqual(fake.calls, [[
    'buy_shop_product', { p_sku: 'rename_card', p_request_id: 'req-1' },
  ]]);
});

test('管理员列表与更新使用固定字段并保留空限购', async () => {
  const fake = createFakeAccount();
  const row = {
    sku: 'rename_card', name: '改名卡', description: '修改游戏名', price: '80',
    is_active: false, per_user_limit: null, sort_order: 20, updated_at: '2026-07-19T00:00:00Z',
  };
  fake.responses.set('admin_list_shop_products', { data: [row], error: null });
  fake.responses.set('admin_update_shop_product', { data: [row], error: null });
  const client = shop.createShopClient({ accountClient: fake.accountClient });

  assert.equal((await client.adminListProducts())[0].purchaseLimit, null);
  assert.equal((await client.adminUpdateProduct({
    sku: 'rename_card', price: 80, active: false, purchaseLimit: null,
  })).updatedAt, '2026-07-19T00:00:00Z');
  assert.deepEqual(fake.calls, [
    ['admin_list_shop_products', undefined],
    ['admin_update_shop_product', {
      p_sku: 'rename_card', p_price: 80, p_is_active: false, p_per_user_limit: null,
    }],
  ]);
});

test('游客只能读取公开商品列表且私有方法不触碰 Supabase', async () => {
  const fake = createFakeAccount({ kind: 'guest' });
  fake.responses.set('list_shop_products', { data: [], error: null });
  const client = shop.createShopClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.listProducts(), []);
  for (const call of [
    () => client.getInventory(),
    () => client.buy('makeup_card', 'req-1'),
    () => client.adminListProducts(),
    () => client.adminUpdateProduct({ sku: 'makeup_card' }),
  ]) {
    await assert.rejects(call, { message: 'REGISTERED_ACCOUNT_REQUIRED' });
  }
  assert.deepEqual(fake.calls, [['list_shop_products', undefined]]);
});
