(function initPlayerShop(globalScope) {
  'use strict';

  const SKUS = ['makeup_card', 'rename_card'];
  const ERROR_MESSAGES = {
    ACCOUNT_CLIENT_REQUIRED: '账号服务不可用',
    REGISTERED_ACCOUNT_REQUIRED: '请先注册并登录账号',
    ADMIN_REQUIRED: '需要管理员权限',
    INVALID_REQUEST_ID: '请求标识无效，请重试',
    PRODUCT_NOT_FOUND: '商品不存在',
    PRODUCT_INACTIVE: '商品已下架',
    PRODUCT_PRICE_INVALID: '商品价格无效',
    PURCHASE_LIMIT_REACHED: '已达到限购数量',
    INSUFFICIENT_COINS: '金币不足',
    ITEM_NOT_FOUND: '道具不存在',
    INSUFFICIENT_ITEMS: '道具数量不足',
    INVALID_PRODUCT_CONFIG: '商品配置无效',
  };

  function number(value) {
    const result = Number(value ?? 0);
    return Number.isFinite(result) ? result : 0;
  }

  function nullableNumber(value) {
    return value == null ? null : number(value);
  }

  function firstRow(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function mapShopError(error) {
    const source = [error?.code, error?.message, error?.cause?.message]
      .filter(Boolean)
      .join(' ');
    const code = Object.keys(ERROR_MESSAGES).find((item) => source.includes(item));
    return code ? ERROR_MESSAGES[code] : '商城服务暂时不可用，请稍后重试';
  }

  function mapProduct(row) {
    return {
      sku: row.sku,
      name: row.name,
      description: row.description,
      price: number(row.price),
      active: Boolean(row.is_active),
      purchaseLimit: nullableNumber(row.per_user_limit),
      purchasedCount: number(row.purchased_count),
      remainingLimit: nullableNumber(row.remaining_limit),
    };
  }

  function mapAdminProduct(row) {
    return {
      sku: row.sku,
      name: row.name,
      description: row.description,
      price: number(row.price),
      active: Boolean(row.is_active),
      purchaseLimit: nullableNumber(row.per_user_limit),
      sortOrder: number(row.sort_order),
      updatedAt: row.updated_at || null,
    };
  }

  function createShopClient({ accountClient = null } = {}) {
    if (!accountClient?.getSupabaseClient || !accountClient?.getIdentity) {
      throw new Error('ACCOUNT_CLIENT_REQUIRED');
    }

    function requireRegistered() {
      if (accountClient.getIdentity().kind !== 'registered') {
        throw new Error('REGISTERED_ACCOUNT_REQUIRED');
      }
    }

    async function callRpc(name, params) {
      const supabase = await accountClient.getSupabaseClient();
      if (!supabase?.rpc) throw new Error('ACCOUNT_CLIENT_REQUIRED');
      const result = await supabase.rpc(name, params);
      if (result?.error) throw result.error;
      return result?.data;
    }

    async function listProducts() {
      const rows = await callRpc('list_shop_products');
      return (rows || []).map(mapProduct);
    }

    async function getInventory() {
      requireRegistered();
      const inventory = { makeupCard: 0, renameCard: 0 };
      const rows = await callRpc('get_player_inventory');
      for (const row of rows || []) {
        if (row.sku === 'makeup_card') inventory.makeupCard = number(row.quantity);
        if (row.sku === 'rename_card') inventory.renameCard = number(row.quantity);
      }
      return inventory;
    }

    async function buy(sku, requestId) {
      requireRegistered();
      if (!SKUS.includes(sku)) throw new Error('PRODUCT_NOT_FOUND');
      if (typeof requestId !== 'string' || !requestId) throw new Error('INVALID_REQUEST_ID');
      const row = firstRow(await callRpc('buy_shop_product', {
        p_sku: sku,
        p_request_id: requestId,
      })) || {};
      return {
        sku: row.sku,
        pricePaid: number(row.price_paid),
        balance: number(row.balance),
        quantity: number(row.quantity),
        remainingLimit: nullableNumber(row.remaining_limit),
      };
    }

    async function adminListProducts() {
      requireRegistered();
      const rows = await callRpc('admin_list_shop_products');
      return (rows || []).map(mapAdminProduct);
    }

    async function adminUpdateProduct(input = {}) {
      requireRegistered();
      const row = firstRow(await callRpc('admin_update_shop_product', {
        p_sku: input.sku,
        p_price: number(input.price),
        p_is_active: Boolean(input.active),
        p_per_user_limit: nullableNumber(input.purchaseLimit),
      })) || {};
      return mapAdminProduct(row);
    }

    return {
      listProducts,
      getInventory,
      buy,
      adminListProducts,
      adminUpdateProduct,
    };
  }

  const playerShop = { SKUS, createShopClient, mapShopError };
  if (typeof module !== 'undefined' && module.exports) module.exports = playerShop;
  globalScope.PlayerShop = playerShop;
})(typeof window !== 'undefined' ? window : globalThis);
