const test = require('node:test');
const assert = require('node:assert/strict');

let economy = {};
try {
  economy = require('../../src/services/economy.js');
} catch {
  economy = {};
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
        return {
          kind,
          username: kind === 'registered' ? 'player_01' : null,
          displayName: kind === 'registered' ? '棋手甲' : '匿名玩家·ABCD',
        };
      },
      async getSupabaseClient() {
        return supabase;
      },
    },
  };
}

test('兑换码会移除分隔符、转为大写并按四位分组显示', () => {
  assert.equal(economy.normalizeRedeemCode(' abcd-efgh 2345 '), 'ABCDEFGH2345');
  assert.equal(economy.formatRedeemCode('abcdefgh2345'), 'ABCD-EFGH-2345');
  assert.equal(economy.isValidRedeemCode('ABCD-EFGH-2345'), true);
  assert.equal(economy.isValidRedeemCode('ABCD-IO01-2345'), false);
});

test('游客余额固定为零且不能兑换金币', async () => {
  const fake = createFakeAccount({ kind: 'guest' });
  const client = economy.createEconomyClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.refresh(), { balance: 0, isAdmin: false, loaded: true });
  await assert.rejects(client.redeemCode('ABCD-EFGH-2345'), /REGISTERED_ACCOUNT_REQUIRED/);
  assert.deepEqual(fake.calls, []);
});

test('注册玩家刷新余额并把结果通知订阅者', async () => {
  const fake = createFakeAccount();
  fake.responses.set('get_economy_snapshot', {
    data: [{ balance: 120, is_admin: true }],
    error: null,
  });
  const snapshots = [];
  const client = economy.createEconomyClient({ accountClient: fake.accountClient });
  client.subscribe((snapshot) => snapshots.push(snapshot));

  assert.deepEqual(await client.refresh(), { balance: 120, isAdmin: true, loaded: true });
  assert.deepEqual(fake.calls, [['get_economy_snapshot', undefined]]);
  assert.deepEqual(snapshots.at(-1), { balance: 120, isAdmin: true, loaded: true });
});

test('兑换金币提交规范化兑换码并更新本地余额', async () => {
  const fake = createFakeAccount();
  fake.responses.set('redeem_coin_code', {
    data: [{ granted_amount: 50, balance: 150 }],
    error: null,
  });
  const client = economy.createEconomyClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.redeemCode('abcd-efgh-2345'), {
    grantedAmount: 50,
    balance: 150,
  });
  assert.deepEqual(fake.calls, [[
    'redeem_coin_code',
    { p_code: 'ABCDEFGH2345' },
  ]]);
  assert.equal(client.getSnapshot().balance, 150);
});

test('管理员接口传递创建参数并支持列表和停用', async () => {
  const fake = createFakeAccount();
  fake.responses.set('create_redeem_code', {
    data: [{ id: 'code-1', code: 'ABCD-EFGH-2345', amount: 200 }],
    error: null,
  });
  fake.responses.set('list_redeem_codes', {
    data: [{ id: 'code-1', code_hint: 'ABCD-****-2345', amount: 200 }],
    error: null,
  });
  fake.responses.set('disable_redeem_code', { data: null, error: null });
  const client = economy.createEconomyClient({ accountClient: fake.accountClient });

  assert.equal((await client.createRedeemCode({
    amount: 200,
    maxClaims: 10,
    expiresAt: '2026-12-31T00:00:00.000Z',
  })).code, 'ABCD-EFGH-2345');
  assert.equal((await client.listRedeemCodes())[0].codeHint, 'ABCD-****-2345');
  await client.disableRedeemCode('code-1');

  assert.deepEqual(fake.calls, [
    ['create_redeem_code', {
      p_amount: 200,
      p_max_claims: 10,
      p_expires_at: '2026-12-31T00:00:00.000Z',
    }],
    ['list_redeem_codes', undefined],
    ['disable_redeem_code', { p_code_id: 'code-1' }],
  ]);
});

test('经济错误码映射成明确中文提示', () => {
  assert.equal(economy.mapEconomyError(new Error('INSUFFICIENT_COINS')), '金币不足');
  assert.equal(economy.mapEconomyError(new Error('CODE_ALREADY_REDEEMED')), '这个兑换码你已经领取过了');
  assert.equal(economy.mapEconomyError(new Error('ADMIN_REQUIRED')), '需要管理员权限');
  assert.equal(economy.mapEconomyError(new Error('unexpected')), '金币服务暂时不可用，请稍后重试');
});
