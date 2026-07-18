'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createNotificationsClient,
  mapNotificationsError,
} = require('../../src/services/notifications');

function fakeClient(options = {}) {
  let user = Object.prototype.hasOwnProperty.call(options, 'user') ? options.user : { id: 'user-1' };
  let identityKind = options.identityKind || (user ? 'registered' : 'guest');
  const rpcResults = options.rpcResults || [];
  const calls = [];
  const channels = [];
  const removed = [];
  const liveChannels = new Set();
  const identityListeners = new Set();
  let channelError = null;
  let getSupabaseClientCalls = 0;
  let getSessionCalls = 0;

  const supabase = {
    auth: {
      async getSession() {
        getSessionCalls += 1;
        return { data: { session: user ? { user } : null }, error: null };
      },
    },
    async rpc(name, params) {
      calls.push({ name, params });
      return rpcResults.shift() || { data: null, error: null };
    },
    channel(name) {
      const handlers = [];
      const channel = {
        name,
        handlers,
        on(type, filter, handler) {
          handlers.push({ type, filter, handler });
          return channel;
        },
        subscribe(callback) {
          const failed = channelError;
          queueMicrotask(() => {
            if (!failed) liveChannels.add(channel);
            callback(failed ? 'CHANNEL_ERROR' : 'SUBSCRIBED');
          });
          return channel;
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      liveChannels.delete(channel);
      removed.push(channel);
    },
  };
  return {
    calls,
    channels,
    removed,
    get getSupabaseClientCalls() { return getSupabaseClientCalls; },
    get getSessionCalls() { return getSessionCalls; },
    get identitySubscriberCount() { return identityListeners.size; },
    get liveChannelCount() { return liveChannels.size; },
    getIdentity() { return { kind: identityKind }; },
    async getSupabaseClient() {
      getSupabaseClientCalls += 1;
      return supabase;
    },
    subscribe(listener) {
      identityListeners.add(listener);
      return () => identityListeners.delete(listener);
    },
    async setIdentity(kind, nextUser) {
      identityKind = kind;
      user = nextUser;
      await Promise.all(Array.from(identityListeners, (listener) => listener({ kind })));
    },
    failNextChannel() {
      channelError = true;
    },
    recoverChannel() {
      channelError = false;
    },
  };
}

async function waitFor(predicate, timeout = 500) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('WAIT_FOR_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function adminNotificationRow(overrides = {}) {
  return {
    id: 'n1',
    activity_id: null,
    title: 'T',
    body: 'B',
    reward_amount: '8',
    visible_at: 'v',
    expires_at: null,
    action_url: null,
    is_read: null,
    reward_claimed: null,
    read_at: null,
    reward_claimed_at: null,
    is_active: true,
    created_by: 'u1',
    created_at: 'c',
    updated_at: 'u',
    read_count: '2',
    claim_count: '1',
    ...overrides,
  };
}

test('list uses defaults, paired cursor, clamped limit, and explicit public model', async () => {
  const supabase = fakeClient({
    user: null,
    rpcResults: [
      { data: [{ id: 'n1', activity_id: 'a1', title: 'T', body: null, reward_amount: '7', visible_at: 'v1', expires_at: null, action_url: null, is_read: false, reward_claimed: false, read_at: null, reward_claimed_at: null, ignored: 1 }], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ],
  });
  const notifications = createNotificationsClient({ accountClient: supabase });
  assert.deepEqual(Object.keys(notifications).sort(), [
    'adminDisable', 'adminList', 'adminPublish', 'claimReward',
    'countUnread', 'list', 'markRead', 'subscribe',
  ]);

  const rows = await notifications.list();
  await notifications.list({ cursor: { visibleAt: 'v1', id: 'n1' }, limit: 99 });
  await notifications.list({ limit: -3 });

  assert.deepEqual(supabase.calls.map(({ params }) => params), [
    { p_before_visible_at: null, p_before_id: null, p_limit: 20 },
    { p_before_visible_at: 'v1', p_before_id: 'n1', p_limit: 50 },
    { p_before_visible_at: null, p_before_id: null, p_limit: 1 },
  ]);
  assert.equal(supabase.getSupabaseClientCalls, 3);
  assert.deepEqual(rows[0], {
    id: 'n1', activityId: 'a1', title: 'T', body: null, rewardAmount: 7,
    visibleAt: 'v1', expiresAt: null, actionUrl: null, isRead: false,
    rewardClaimed: false, readAt: null, rewardClaimedAt: null,
  });
  await assert.rejects(() => notifications.list({ cursor: { id: 'n1' } }), { message: 'INVALID_NOTIFICATION_CURSOR' });
  await assert.rejects(() => notifications.list({ limit: 'bad' }), { message: 'INVALID_NOTIFICATION_LIMIT' });
});

test('countUnread converts scalar bigint and guest identity rejects private calls before Supabase', async () => {
  const registered = fakeClient({ rpcResults: [{ data: 9n, error: null }] });
  assert.equal(await createNotificationsClient({ accountClient: registered }).countUnread(), 9);

  const guest = fakeClient({ identityKind: 'guest', user: { id: 'anonymous-session-user' } });
  const notifications = createNotificationsClient({ accountClient: guest });
  await assert.rejects(() => notifications.countUnread(), { message: 'REGISTERED_ACCOUNT_REQUIRED' });
  await assert.rejects(() => notifications.markRead('n1'), { message: 'REGISTERED_ACCOUNT_REQUIRED' });
  await assert.rejects(() => notifications.claimReward('n1', 'req-1'), { message: 'REGISTERED_ACCOUNT_REQUIRED' });
  await assert.rejects(() => notifications.adminList(), { message: 'REGISTERED_ACCOUNT_REQUIRED' });
  assert.equal(guest.calls.length, 0);
  assert.equal(guest.getSupabaseClientCalls, 0);
  assert.equal(guest.getSessionCalls, 0);
});

test('markRead and claimReward call RPC and return explicit result models', async () => {
  const supabase = fakeClient({ rpcResults: [
    { data: [{ notification_id: 'n1', read_at: 'r1', extra: true }], error: null },
    { data: [{ reward_amount: '12', balance: '34', claimed_at: 'c1', extra: true }], error: null },
  ] });
  const notifications = createNotificationsClient({ accountClient: supabase });

  assert.deepEqual(await notifications.markRead('n1'), { notificationId: 'n1', readAt: 'r1' });
  assert.deepEqual(await notifications.claimReward('n1', 'req-1'), { rewardAmount: 12, balance: 34, claimedAt: 'c1' });
  assert.deepEqual(supabase.calls, [
    { name: 'mark_site_notification_read', params: { p_notification_id: 'n1' } },
    { name: 'claim_site_notification_reward', params: { p_notification_id: 'n1', p_request_id: 'req-1' } },
  ]);
});

test('admin list, publish, and disable use documented RPCs and admin model', async () => {
  const row = adminNotificationRow({ unknown: true });
  const supabase = fakeClient({ rpcResults: [
    { data: [row], error: null },
    { data: [row], error: null },
    { data: [row], error: null },
  ] });
  const notifications = createNotificationsClient({ accountClient: supabase });

  const listed = await notifications.adminList();
  const published = await notifications.adminPublish({ title: 'T', body: 'B', rewardAmount: '8', visibleAt: 'v' });
  const disabled = await notifications.adminDisable('n1');

  assert.deepEqual(listed[0], { id: 'n1', activityId: null, title: 'T', body: 'B', rewardAmount: 8, visibleAt: 'v', expiresAt: null, actionUrl: null, isRead: false, rewardClaimed: false, readAt: null, rewardClaimedAt: null, active: true, createdBy: 'u1', createdAt: 'c', updatedAt: 'u', readCount: 2, claimCount: 1 });
  assert.deepEqual(published, listed[0]);
  assert.deepEqual(disabled, listed[0]);
  assert.deepEqual(supabase.calls.map(({ name, params }) => ({ name, params })), [
    { name: 'admin_list_site_notifications', params: undefined },
    { name: 'admin_publish_site_notification', params: { p_title: 'T', p_body: 'B', p_reward_amount: 8, p_visible_at: 'v', p_expires_at: null } },
    { name: 'admin_disable_site_notification', params: { p_notification_id: 'n1' } },
  ]);
});

test('registered concurrent subscribers share one channel, ignore payload, filter own reads, and remove last', async () => {
  const supabase = fakeClient();
  const notifications = createNotificationsClient({ accountClient: supabase });
  let first = 0;
  let second = 0;

  const [offFirst, offSecond] = await Promise.all([
    notifications.subscribe(() => { first += 1; }),
    notifications.subscribe(() => { second += 1; }),
  ]);
  assert.equal(supabase.channels.length, 1);
  assert.equal(supabase.getSupabaseClientCalls, 1);
  assert.equal(supabase.getSessionCalls, 1);
  assert.deepEqual(supabase.channels[0].handlers.map(({ filter }) => filter), [
    { event: '*', schema: 'public', table: 'site_notifications' },
    { event: '*', schema: 'public', table: 'notification_reads', filter: 'user_id=eq.user-1' },
  ]);

  supabase.channels[0].handlers[0].handler({ arbitrary: 'payload' });
  assert.deepEqual([first, second], [1, 1]);
  await offFirst();
  await offFirst();
  assert.equal(supabase.removed.length, 0);
  await offSecond();
  assert.equal(supabase.removed.length, 1);
});

test('active subscription rebuilds its channel when guest registers or registered user changes', async () => {
  const supabase = fakeClient({ user: null });
  const notifications = createNotificationsClient({ accountClient: supabase });
  const off = await notifications.subscribe(() => {});

  assert.equal(supabase.channels.length, 1);
  assert.equal(supabase.channels[0].handlers.length, 1);
  assert.equal(supabase.identitySubscriberCount, 1);

  await supabase.setIdentity('registered', { id: 'user-a' });
  assert.equal(supabase.channels.length, 2);
  assert.equal(supabase.removed[0], supabase.channels[0]);
  assert.equal(
    supabase.channels[1].handlers[1].filter.filter,
    'user_id=eq.user-a',
  );

  await supabase.setIdentity('registered', { id: 'user-b' });
  assert.equal(supabase.channels.length, 3);
  assert.equal(supabase.removed[1], supabase.channels[1]);
  assert.equal(
    supabase.channels[2].handlers[1].filter.filter,
    'user_id=eq.user-b',
  );

  await supabase.setIdentity('guest', null);
  assert.equal(supabase.channels.length, 4);
  assert.equal(supabase.removed[2], supabase.channels[2]);
  assert.equal(supabase.channels[3].handlers.length, 1);

  const switchingToC = supabase.setIdentity('registered', { id: 'user-c' });
  const switchingToD = supabase.setIdentity('registered', { id: 'user-d' });
  await Promise.all([switchingToC, switchingToD]);
  assert.equal(supabase.channels.length, 5);
  assert.equal(supabase.removed[3], supabase.channels[3]);
  assert.equal(
    supabase.channels[4].handlers[1].filter.filter,
    'user_id=eq.user-d',
  );

  await off();
  assert.equal(supabase.removed[4], supabase.channels[4]);
  assert.equal(supabase.identitySubscriberCount, 0);
  await supabase.setIdentity('guest', null);
  assert.equal(supabase.channels.length, 5);
});

test('failed identity rebuild retries current user and cleanup cancels pending retry', async () => {
  const supabase = fakeClient({ user: null });
  const notifications = createNotificationsClient({ accountClient: supabase });
  const off = await notifications.subscribe(() => {});

  supabase.failNextChannel();
  await supabase.setIdentity('registered', { id: 'user-a' });
  assert.equal(supabase.liveChannelCount, 0);
  supabase.recoverChannel();
  await waitFor(() => supabase.liveChannelCount === 1);
  assert.equal(
    supabase.channels.at(-1).handlers[1].filter.filter,
    'user_id=eq.user-a',
  );

  supabase.failNextChannel();
  await supabase.setIdentity('registered', { id: 'user-b' });
  const channelCountBeforeCleanup = supabase.channels.length;
  await off();
  supabase.recoverChannel();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(supabase.channels.length, channelCountBeforeCleanup);
  assert.equal(supabase.liveChannelCount, 0);
  assert.equal(supabase.identitySubscriberCount, 0);
});

test('guest subscription watches only public notifications and failed init can retry', async () => {
  const supabase = fakeClient({ user: null });
  const notifications = createNotificationsClient({ accountClient: supabase });
  supabase.failNextChannel();
  await assert.rejects(() => notifications.subscribe(() => {}));
  supabase.recoverChannel();
  const off = await notifications.subscribe(() => {});
  assert.equal(supabase.channels.length, 2);
  assert.equal(supabase.channels[1].handlers.length, 1);
  assert.equal(supabase.getSessionCalls, 0);
  assert.deepEqual(supabase.channels[1].handlers[0].filter, { event: '*', schema: 'public', table: 'site_notifications' });
  await off();
});

test('scalar and single-row RPCs reject missing or invalid successful responses', async () => {
  const supabase = fakeClient({ rpcResults: [
    { data: null, error: null },
    { data: 'not-a-number', error: null },
    { data: null, error: null },
    { data: [], error: null },
    { data: null, error: null },
    { data: [], error: null },
  ] });
  const notifications = createNotificationsClient({ accountClient: supabase });

  await assert.rejects(() => notifications.countUnread(), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  await assert.rejects(() => notifications.countUnread(), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  await assert.rejects(() => notifications.markRead('n1'), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  await assert.rejects(() => notifications.claimReward('n1', 'req-1'), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  await assert.rejects(() => notifications.adminPublish({}), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  await assert.rejects(() => notifications.adminDisable('n1'), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  assert.equal(
    mapNotificationsError({ code: 'INVALID_NOTIFICATION_RESPONSE' }),
    '通知服务返回了无效数据，请稍后重试',
  );
});

test('notification writes reject empty rows and missing required fields', async () => {
  const supabase = fakeClient({ rpcResults: [
    { data: {}, error: null },
    { data: [{}], error: null },
    { data: { id: 'n1' }, error: null },
    { data: [{ is_active: false }], error: null },
  ] });
  const notifications = createNotificationsClient({ accountClient: supabase });

  await assert.rejects(() => notifications.markRead('n1'), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  await assert.rejects(() => notifications.claimReward('n1', 'req-1'), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  await assert.rejects(() => notifications.adminPublish({}), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  await assert.rejects(() => notifications.adminDisable('n1'), { message: 'INVALID_NOTIFICATION_RESPONSE' });
});

test('notification response schema rejects invalid numbers and partial admin rows while preserving zero', async () => {
  const supabase = fakeClient({ rpcResults: [
    { data: [{ reward_amount: 'bad', balance: 0, claimed_at: 'c1' }], error: null },
    { data: [{ reward_amount: 0, balance: Infinity, claimed_at: 'c1' }], error: null },
    { data: [{ reward_amount: '', balance: 0, claimed_at: 'c1' }], error: null },
    { data: [{ id: 'n1', is_active: true }], error: null },
    { data: [adminNotificationRow({ reward_amount: 'bad' })], error: null },
    { data: [adminNotificationRow({ is_active: 1 })], error: null },
    { data: [{ reward_amount: 0n, balance: '0', claimed_at: 'c1' }], error: null },
  ] });
  const notifications = createNotificationsClient({ accountClient: supabase });

  for (const requestId of ['bad-reward', 'bad-balance', 'empty-reward']) {
    await assert.rejects(
      () => notifications.claimReward('n1', requestId),
      { message: 'INVALID_NOTIFICATION_RESPONSE' },
    );
  }
  await assert.rejects(() => notifications.adminPublish({}), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  await assert.rejects(() => notifications.adminDisable('n1'), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  await assert.rejects(() => notifications.adminDisable('n1'), { message: 'INVALID_NOTIFICATION_RESPONSE' });
  assert.deepEqual(await notifications.claimReward('n1', 'zero-values'), {
    rewardAmount: 0,
    balance: 0,
    claimedAt: 'c1',
  });
});

test('maps stable notification errors and requires an account client', async () => {
  assert.throws(() => createNotificationsClient(), { message: 'ACCOUNT_CLIENT_REQUIRED' });
  for (const code of ['REGISTERED_ACCOUNT_REQUIRED', 'ADMIN_REQUIRED', 'INVALID_NOTIFICATION_CURSOR', 'INVALID_NOTIFICATION_LIMIT', 'NOTIFICATION_NOT_FOUND', 'NOTIFICATION_DISABLED', 'NOTIFICATION_NOT_VISIBLE', 'NOTIFICATION_EXPIRED', 'NOTIFICATION_NO_REWARD', 'NOTIFICATION_ALREADY_CLAIMED', 'REQUEST_ID_REQUIRED']) {
    const mapped = mapNotificationsError({ code, message: 'raw' });
    assert.equal(typeof mapped, 'string');
    assert.notEqual(mapped, 'raw');
  }
  assert.equal(mapNotificationsError({ code: 'REGISTERED_ACCOUNT_REQUIRED' }), '请先登录正式账号');
  assert.equal(mapNotificationsError({ code: 'UNKNOWN', message: 'raw' }), '通知服务暂时不可用，请稍后重试');

  const rpcError = { code: 'NOTIFICATION_DISABLED', message: 'raw rpc error' };
  const accountClient = fakeClient({ user: null, rpcResults: [{ data: null, error: rpcError }] });
  await assert.rejects(
    () => createNotificationsClient({ accountClient }).list(),
    (error) => error === rpcError,
  );
});
