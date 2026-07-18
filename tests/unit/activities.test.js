const test = require('node:test');
const assert = require('node:assert/strict');

let activities = {};
try {
  activities = require('../../src/services/activities.js');
} catch {
  activities = {};
}

function createFakeAccount({ kind = 'registered' } = {}) {
  const calls = [];
  const responses = new Map();
  const supabase = {
    async rpc(name, params) {
      calls.push([name, params]);
      return responses.has(name) ? responses.get(name) : { data: [], error: null };
    },
  };
  return {
    calls,
    responses,
    accountClient: {
      getIdentity() {
        return { kind };
      },
      async getSupabaseClient() {
        return supabase;
      },
    },
  };
}

test('创建活动客户端必须注入账号客户端', () => {
  assert.throws(() => activities.createActivitiesClient(), /ACCOUNT_CLIENT_REQUIRED/);
});

test('游客可读取公开活动并只获得显式页面字段', async () => {
  const fake = createFakeAccount({ kind: 'guest' });
  fake.responses.set('list_active_activities', {
    data: [{
      id: 'activity-1',
      title: '周末挑战',
      body: '完成一局五子棋。',
      cover_url: null,
      action_label: '立即游玩',
      action_url: '/gomoku/',
      publish_at: '2026-07-18T00:00:00Z',
      starts_at: '2026-07-19T00:00:00Z',
      ends_at: '2026-07-20T00:00:00Z',
      reward_amount: '25',
      claimed: false,
      claimed_at: null,
      internal_note: '不得透传',
    }],
    error: null,
  });
  const client = activities.createActivitiesClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.listActive(), [{
    id: 'activity-1',
    title: '周末挑战',
    body: '完成一局五子棋。',
    coverUrl: null,
    actionLabel: '立即游玩',
    actionUrl: '/gomoku/',
    publishAt: '2026-07-18T00:00:00Z',
    startsAt: '2026-07-19T00:00:00Z',
    endsAt: '2026-07-20T00:00:00Z',
    rewardAmount: 25,
    claimed: false,
    claimedAt: null,
  }]);
  assert.deepEqual(fake.calls, [['list_active_activities', undefined]]);
});

test('游客领奖和管理员接口全部先拒绝且不发 RPC', async () => {
  const fake = createFakeAccount({ kind: 'guest' });
  const client = activities.createActivitiesClient({ accountClient: fake.accountClient });

  await assert.rejects(client.claimReward('activity-1', 'request-1'), /REGISTERED_ACCOUNT_REQUIRED/);
  await assert.rejects(client.adminList(), /REGISTERED_ACCOUNT_REQUIRED/);
  await assert.rejects(client.adminSave({}), /REGISTERED_ACCOUNT_REQUIRED/);
  await assert.rejects(client.adminUnpublish('activity-1'), /REGISTERED_ACCOUNT_REQUIRED/);
  assert.deepEqual(fake.calls, []);
});

test('领奖提交活动和请求 ID 并映射奖励结果', async () => {
  const fake = createFakeAccount();
  fake.responses.set('claim_activity_reward', {
    data: [{
      reward_amount: '30',
      balance: '230',
      claimed_at: '2026-07-18T08:00:00Z',
      ignored: true,
    }],
    error: null,
  });
  const client = activities.createActivitiesClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.claimReward('activity-1', 'request-1'), {
    rewardAmount: 30,
    balance: 230,
    claimedAt: '2026-07-18T08:00:00Z',
  });
  assert.deepEqual(fake.calls, [[
    'claim_activity_reward',
    { p_activity_id: 'activity-1', p_request_id: 'request-1' },
  ]]);
});

test('管理员列表补充管理字段并过滤未知字段', async () => {
  const fake = createFakeAccount();
  fake.responses.set('admin_list_activities', {
    data: [{
      id: 'activity-2',
      title: '夏日活动',
      body: '活动正文',
      cover_url: 'https://example.com/cover.png',
      action_label: null,
      action_url: null,
      publish_at: '2026-07-18T00:00:00Z',
      starts_at: '2026-07-18T00:00:00Z',
      ends_at: '2026-07-25T00:00:00Z',
      reward_amount: '50',
      is_active: true,
      created_by: 'admin-1',
      created_at: '2026-07-17T00:00:00Z',
      updated_at: '2026-07-18T00:00:00Z',
      claim_count: '12',
      secret: '不得透传',
    }],
    error: null,
  });
  const client = activities.createActivitiesClient({ accountClient: fake.accountClient });

  assert.deepEqual(await client.adminList(), [{
    id: 'activity-2',
    title: '夏日活动',
    body: '活动正文',
    coverUrl: 'https://example.com/cover.png',
    actionLabel: null,
    actionUrl: null,
    publishAt: '2026-07-18T00:00:00Z',
    startsAt: '2026-07-18T00:00:00Z',
    endsAt: '2026-07-25T00:00:00Z',
    rewardAmount: 50,
    claimed: false,
    claimedAt: null,
    active: true,
    createdBy: 'admin-1',
    createdAt: '2026-07-17T00:00:00Z',
    updatedAt: '2026-07-18T00:00:00Z',
    claimCount: 12,
  }]);
  assert.deepEqual(fake.calls, [['admin_list_activities', undefined]]);
});

test('管理员保存传递十个参数和空值并可下架活动', async () => {
  const fake = createFakeAccount();
  fake.responses.set('admin_save_activity', {
    data: [{ id: 'activity-3', title: '新活动', reward_amount: 0, is_active: true }],
    error: null,
  });
  fake.responses.set('admin_unpublish_activity', {
    data: [{ id: 'activity-3', title: '新活动', reward_amount: 0, is_active: false }],
    error: null,
  });
  const client = activities.createActivitiesClient({ accountClient: fake.accountClient });
  const input = {
    id: null,
    title: '新活动',
    body: '正文',
    coverUrl: null,
    actionLabel: null,
    actionUrl: null,
    publishAt: '2026-07-20T00:00:00Z',
    startsAt: '2026-07-21T00:00:00Z',
    endsAt: '2026-07-22T00:00:00Z',
    rewardAmount: 0,
  };

  assert.equal((await client.adminSave(input)).active, true);
  assert.equal((await client.adminUnpublish('activity-3')).active, false);
  assert.deepEqual(fake.calls, [
    ['admin_save_activity', {
      p_id: null,
      p_title: '新活动',
      p_body: '正文',
      p_cover_url: null,
      p_action_label: null,
      p_action_url: null,
      p_publish_at: '2026-07-20T00:00:00Z',
      p_starts_at: '2026-07-21T00:00:00Z',
      p_ends_at: '2026-07-22T00:00:00Z',
      p_reward_amount: 0,
    }],
    ['admin_unpublish_activity', { p_activity_id: 'activity-3' }],
  ]);
});

test('single-row activity RPCs reject missing successful responses', async () => {
  const fake = createFakeAccount();
  fake.responses.set('claim_activity_reward', { data: null, error: null });
  fake.responses.set('admin_save_activity', { data: [], error: null });
  fake.responses.set('admin_unpublish_activity', { data: null, error: null });
  const client = activities.createActivitiesClient({ accountClient: fake.accountClient });

  await assert.rejects(
    client.claimReward('activity-1', 'request-1'),
    { message: 'INVALID_ACTIVITY_RESPONSE' },
  );
  await assert.rejects(client.adminSave({}), { message: 'INVALID_ACTIVITY_RESPONSE' });
  await assert.rejects(
    client.adminUnpublish('activity-1'),
    { message: 'INVALID_ACTIVITY_RESPONSE' },
  );
  assert.equal(
    activities.mapActivitiesError(new Error('INVALID_ACTIVITY_RESPONSE')),
    '活动服务返回了无效数据，请稍后重试',
  );
});

test('activity writes reject empty rows, missing required fields, and missing RPC envelopes', async () => {
  const missingEnvelope = createFakeAccount();
  missingEnvelope.responses.set('claim_activity_reward', undefined);
  const missingEnvelopeClient = activities.createActivitiesClient({
    accountClient: missingEnvelope.accountClient,
  });
  await assert.rejects(
    missingEnvelopeClient.claimReward('activity-1', 'request-1'),
    { message: 'INVALID_ACTIVITY_RESPONSE' },
  );

  const fake = createFakeAccount();
  fake.responses.set('claim_activity_reward', { data: {}, error: null });
  fake.responses.set('admin_save_activity', { data: [{}], error: null });
  fake.responses.set('admin_unpublish_activity', {
    data: { id: 'activity-1' },
    error: null,
  });
  const client = activities.createActivitiesClient({ accountClient: fake.accountClient });
  await assert.rejects(
    client.claimReward('activity-1', 'request-1'),
    { message: 'INVALID_ACTIVITY_RESPONSE' },
  );
  await assert.rejects(client.adminSave({}), { message: 'INVALID_ACTIVITY_RESPONSE' });
  await assert.rejects(
    client.adminUnpublish('activity-1'),
    { message: 'INVALID_ACTIVITY_RESPONSE' },
  );
});

test('活动错误码映射成稳定中文提示', () => {
  const expected = new Map([
    ['REGISTERED_ACCOUNT_REQUIRED', '请先登录正式账号'],
    ['ADMIN_REQUIRED', '需要管理员权限'],
    ['ACTIVITY_NOT_FOUND', '活动不存在'],
    ['ACTIVITY_DISABLED', '活动已下架'],
    ['ACTIVITY_NOT_PUBLISHED', '活动尚未发布'],
    ['ACTIVITY_NOT_STARTED', '活动尚未开始'],
    ['ACTIVITY_ENDED', '活动已结束'],
    ['ACTIVITY_ALREADY_CLAIMED', '活动奖励已经领取'],
  ]);
  for (const [code, message] of expected) {
    assert.equal(activities.mapActivitiesError(new Error(code)), message);
  }
  assert.equal(
    activities.mapActivitiesError(new Error('unexpected')),
    '活动服务暂时不可用，请稍后重试',
  );
});
