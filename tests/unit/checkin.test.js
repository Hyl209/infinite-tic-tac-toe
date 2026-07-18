'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCheckinClient,
  mapCheckinError,
} = require('../../src/services/checkin');

function fakeAccount({ kind = 'registered', rpcResults = [] } = {}) {
  const calls = [];
  let getSupabaseClientCalls = 0;
  const supabase = {
    async rpc(name, params) {
      calls.push({ name, params });
      return rpcResults.shift() || { data: null, error: null };
    },
  };
  return {
    calls,
    get getSupabaseClientCalls() { return getSupabaseClientCalls; },
    getIdentity() { return { kind }; },
    async getSupabaseClient() {
      getSupabaseClientCalls += 1;
      return supabase;
    },
  };
}

function checkinResultRow(overrides = {}) {
  return {
    checkin_date: '2026-07-18',
    reward_amount: '0',
    balance: 0n,
    checkin_type: 'daily',
    payment_method: 'none',
    payment_amount: 0,
    ...overrides,
  };
}

function checkinRuleRow(overrides = {}) {
  return {
    id: 4n,
    effective_from: '2026-08-01',
    monday_reward: '1',
    tuesday_reward: '2',
    wednesday_reward: '3',
    thursday_reward: '4',
    friday_reward: '5',
    saturday_reward: '6',
    sunday_reward: '7',
    makeup_cost: '20',
    created_by: 'admin-1',
    created_at: 'created',
    ...overrides,
  };
}

test('requires wrapped account client and maps stable errors to Chinese strings', () => {
  assert.throws(() => createCheckinClient(), { message: 'ACCOUNT_CLIENT_REQUIRED' });
  const accountClient = fakeAccount();
  assert.deepEqual(Object.keys(createCheckinClient({ accountClient })).sort(), [
    'adminCreateRule', 'adminListRules', 'checkIn', 'getMonth', 'makeUp',
  ]);

  for (const code of [
    'ACCOUNT_CLIENT_REQUIRED', 'REGISTERED_ACCOUNT_REQUIRED', 'ADMIN_REQUIRED',
    'INVALID_CHECKIN_MONTH', 'INVALID_REQUEST_ID', 'CHECKIN_ALREADY_DONE',
    'MAKEUP_DATE_INVALID', 'MAKEUP_OUTSIDE_CURRENT_MONTH', 'ITEM_PAYMENT_UNAVAILABLE',
    'INVALID_PAYMENT_METHOD', 'INVALID_CHECKIN_RULE', 'CHECKIN_RULE_DATE_INVALID',
    'CHECKIN_RULE_DATE_EXISTS', 'INSUFFICIENT_COINS',
  ]) {
    const mapped = mapCheckinError({ code, message: 'raw' });
    assert.equal(typeof mapped, 'string');
    assert.notEqual(mapped, 'raw');
  }
  assert.equal(mapCheckinError({ code: 'REGISTERED_ACCOUNT_REQUIRED' }), '请先登录正式账号');
  assert.equal(mapCheckinError({ code: 'UNKNOWN', message: 'raw' }), '签到失败，请稍后重试');
});

test('getMonth normalizes YYYY-MM and valid dates and maps explicit day fields', async () => {
  const row = {
    checkin_date: '2026-07-18', reward_amount: '8', checked_in: 1,
    checkin_type: 'daily', payment_method: null, payment_amount: null,
    is_today: true, can_makeup: false, makeup_cost: '20', ignored: true,
  };
  const accountClient = fakeAccount({ rpcResults: [
    { data: [row], error: null },
    { data: [], error: null },
  ] });
  const client = createCheckinClient({ accountClient });

  const days = await client.getMonth('2026-07');
  await client.getMonth('2026-07-31');

  assert.deepEqual(accountClient.calls, [
    { name: 'get_checkin_month', params: { p_month: '2026-07-01' } },
    { name: 'get_checkin_month', params: { p_month: '2026-07-01' } },
  ]);
  assert.deepEqual(days[0], {
    checkinDate: '2026-07-18', rewardAmount: 8, checkedIn: true,
    checkinType: 'daily', paymentMethod: null, paymentAmount: null,
    isToday: true, canMakeup: false, makeupCost: 20,
  });
});

test('getMonth rejects malformed, impossible, and Date values before RPC', async () => {
  const accountClient = fakeAccount();
  const client = createCheckinClient({ accountClient });

  for (const month of ['2026-7', '2026-13', '2026-02-30', new Date('2026-07-01')]) {
    await assert.rejects(() => client.getMonth(month), { message: 'INVALID_CHECKIN_MONTH' });
  }
  assert.equal(accountClient.calls.length, 0);
  assert.equal(accountClient.getSupabaseClientCalls, 0);
});

test('guest identity rejects all five methods before Supabase or RPC', async () => {
  const accountClient = fakeAccount({ kind: 'guest' });
  const client = createCheckinClient({ accountClient });
  const calls = [
    () => client.getMonth('2026-07'),
    () => client.checkIn('req-1'),
    () => client.makeUp('2026-07-01', 'coins', 'req-2'),
    () => client.adminListRules(),
    () => client.adminCreateRule({}),
  ];
  for (const call of calls) {
    await assert.rejects(call, { message: 'REGISTERED_ACCOUNT_REQUIRED' });
  }
  assert.equal(accountClient.calls.length, 0);
  assert.equal(accountClient.getSupabaseClientCalls, 0);
});

test('checkIn sends request id and maps a table result', async () => {
  const accountClient = fakeAccount({ rpcResults: [{
    data: [checkinResultRow({ reward_amount: '5', balance: '105', extra: true })],
    error: null,
  }] });
  const client = createCheckinClient({ accountClient });

  assert.deepEqual(await client.checkIn('req-1'), {
    checkinDate: '2026-07-18', rewardAmount: 5, balance: 105,
    checkinType: 'daily', paymentMethod: 'none', paymentAmount: 0,
  });
  assert.deepEqual(accountClient.calls, [
    { name: 'perform_daily_checkin', params: { p_request_id: 'req-1' } },
  ]);
});

test('makeUp supports coins exactly and rejects item, invalid method, or invalid date locally', async () => {
  const accountClient = fakeAccount({ rpcResults: [{ data: {
    checkin_date: '2026-07-01', reward_amount: 3n, balance: 97n,
    checkin_type: 'makeup', payment_method: 'coins', payment_amount: 10n,
  }, error: null }] });
  const client = createCheckinClient({ accountClient });

  assert.deepEqual(await client.makeUp('2026-07-01', 'coins', 'req-2'), {
    checkinDate: '2026-07-01', rewardAmount: 3, balance: 97,
    checkinType: 'makeup', paymentMethod: 'coins', paymentAmount: 10,
  });
  await assert.rejects(() => client.makeUp('2026-07-02', 'item', 'req-3'), { message: 'ITEM_PAYMENT_UNAVAILABLE' });
  await assert.rejects(() => client.makeUp('2026-07-02', 'card', 'req-4'), { message: 'INVALID_PAYMENT_METHOD' });
  await assert.rejects(() => client.makeUp('2026-02-30', 'coins', 'req-5'), { message: 'MAKEUP_DATE_INVALID' });
  assert.deepEqual(accountClient.calls, [{
    name: 'perform_makeup_checkin',
    params: { p_date: '2026-07-01', p_payment_method: 'coins', p_request_id: 'req-2' },
  }]);
});

test('admin lists explicit rules and creates one with nine parameters', async () => {
  const row = checkinRuleRow({ ignored: true });
  const accountClient = fakeAccount({ rpcResults: [
    { data: [row], error: null },
    { data: [row], error: null },
  ] });
  const client = createCheckinClient({ accountClient });
  const input = {
    effectiveFrom: '2026-08-01', mondayReward: 1, tuesdayReward: 2,
    wednesdayReward: 3, thursdayReward: 4, fridayReward: 5,
    saturdayReward: 6, sundayReward: 7, makeupCost: 20,
  };

  const listed = await client.adminListRules();
  const created = await client.adminCreateRule(input);
  const expected = {
    id: 4, effectiveFrom: '2026-08-01', mondayReward: 1, tuesdayReward: 2,
    wednesdayReward: 3, thursdayReward: 4, fridayReward: 5,
    saturdayReward: 6, sundayReward: 7, makeupCost: 20,
    createdBy: 'admin-1', createdAt: 'created',
  };
  assert.deepEqual(listed[0], expected);
  assert.deepEqual(created, expected);
  assert.deepEqual(accountClient.calls, [
    { name: 'admin_list_checkin_rules', params: undefined },
    { name: 'admin_create_checkin_rule', params: {
      p_effective_from: '2026-08-01', p_monday_reward: 1, p_tuesday_reward: 2,
      p_wednesday_reward: 3, p_thursday_reward: 4, p_friday_reward: 5,
      p_saturday_reward: 6, p_sunday_reward: 7, p_makeup_cost: 20,
    } },
  ]);
});

test('single-row check-in RPCs reject missing successful responses', async () => {
  const accountClient = fakeAccount({ rpcResults: [
    { data: null, error: null },
    { data: [], error: null },
    { data: null, error: null },
  ] });
  const client = createCheckinClient({ accountClient });

  await assert.rejects(() => client.checkIn('req-1'), { message: 'INVALID_CHECKIN_RESPONSE' });
  await assert.rejects(
    () => client.makeUp('2026-07-01', 'coins', 'req-2'),
    { message: 'INVALID_CHECKIN_RESPONSE' },
  );
  await assert.rejects(
    () => client.adminCreateRule({}),
    { message: 'INVALID_CHECKIN_RESPONSE' },
  );
  assert.equal(
    mapCheckinError({ code: 'INVALID_CHECKIN_RESPONSE' }),
    '签到服务返回了无效数据，请稍后重试',
  );
});

test('check-in writes reject empty rows and missing required fields', async () => {
  const accountClient = fakeAccount({ rpcResults: [
    { data: {}, error: null },
    { data: [{}], error: null },
    { data: { id: 1 }, error: null },
  ] });
  const client = createCheckinClient({ accountClient });

  await assert.rejects(() => client.checkIn('req-1'), { message: 'INVALID_CHECKIN_RESPONSE' });
  await assert.rejects(
    () => client.makeUp('2026-07-01', 'coins', 'req-2'),
    { message: 'INVALID_CHECKIN_RESPONSE' },
  );
  await assert.rejects(
    () => client.adminCreateRule({}),
    { message: 'INVALID_CHECKIN_RESPONSE' },
  );
});

test('check-in response schema rejects invalid numbers and partial rules while preserving zero', async () => {
  const accountClient = fakeAccount({ rpcResults: [
    { data: [checkinResultRow({ reward_amount: 'bad' })], error: null },
    { data: [checkinResultRow({ balance: Infinity })], error: null },
    { data: [checkinResultRow({ payment_amount: '' })], error: null },
    { data: [{ id: 4n, effective_from: '2026-08-01' }], error: null },
    { data: [checkinRuleRow({ friday_reward: 'bad' })], error: null },
    { data: [checkinResultRow()], error: null },
  ] });
  const client = createCheckinClient({ accountClient });

  for (const requestId of ['bad-reward', 'bad-balance', 'empty-payment']) {
    await assert.rejects(() => client.checkIn(requestId), { message: 'INVALID_CHECKIN_RESPONSE' });
  }
  await assert.rejects(() => client.adminCreateRule({}), { message: 'INVALID_CHECKIN_RESPONSE' });
  await assert.rejects(() => client.adminCreateRule({}), { message: 'INVALID_CHECKIN_RESPONSE' });
  assert.deepEqual(await client.checkIn('zero-values'), {
    checkinDate: '2026-07-18', rewardAmount: 0, balance: 0,
    checkinType: 'daily', paymentMethod: 'none', paymentAmount: 0,
  });
});
