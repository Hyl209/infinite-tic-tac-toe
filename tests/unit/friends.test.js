'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let friendsApi = {};
try {
  friendsApi = require('../../src/services/friends.js');
} catch {
  friendsApi = {};
}

function createHarness({ identityKind = 'registered', rpcResults = [] } = {}) {
  const calls = [];
  const channels = [];
  const removed = [];
  const identityListeners = new Set();
  let identity = { kind: identityKind, uid: identityKind === 'registered' ? '000001' : null };
  let user = identityKind === 'registered' ? { id: 'user-1' } : null;
  const supabase = {
    auth: {
      async getSession() {
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
          queueMicrotask(() => callback('SUBSCRIBED'));
          return channel;
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      removed.push(channel);
    },
  };
  const accountClient = {
    calls,
    channels,
    removed,
    getIdentity() { return { ...identity }; },
    async getSupabaseClient() { return supabase; },
    subscribe(listener) {
      identityListeners.add(listener);
      return () => identityListeners.delete(listener);
    },
    setIdentity(kind, nextUser = null) {
      identity = { kind, uid: kind === 'registered' ? '000002' : null };
      user = nextUser;
      identityListeners.forEach((listener) => listener({ ...identity }));
    },
  };
  return accountClient;
}

function createClient(harness, options = {}) {
  return friendsApi.createFriendsClient({
    accountClient: harness,
    autoStart: false,
    ...options,
  });
}

test('formats integer UIDs as six digits and rejects invalid values', () => {
  assert.equal(friendsApi.formatPlayerUid(0), '000000');
  assert.equal(friendsApi.formatPlayerUid('42'), '000042');
  assert.equal(friendsApi.formatPlayerUid(999999), '999999');
  assert.throws(() => friendsApi.formatPlayerUid(-1), { message: 'INVALID_PLAYER_UID' });
  assert.throws(() => friendsApi.formatPlayerUid(1000000), { message: 'INVALID_PLAYER_UID' });
});

test('searchExact routes six ASCII digits to UID and normalized full names to username', async () => {
  const row = {
    user_id: 'user-2', player_uid: '000123', username: 'player_02',
    game_name: '棋手乙', relationship_state: 'none',
  };
  const harness = createHarness({ rpcResults: [
    { data: [row], error: null },
    { data: [{ ...row, player_uid: 123 }], error: null },
  ] });
  const client = createClient(harness);

  assert.deepEqual(await client.searchExact('000123'), {
    id: 'user-2', uid: '000123', username: 'player_02',
    displayName: '棋手乙', relationshipState: 'none',
  });
  assert.deepEqual(await client.searchExact(' Player_02 '), {
    id: 'user-2', uid: '000123', username: 'player_02',
    displayName: '棋手乙', relationshipState: 'none',
  });
  assert.deepEqual(harness.calls, [
    { name: 'search_player_by_uid', params: { p_player_uid: 123 } },
    { name: 'search_player_by_username', params: { p_username: 'player_02' } },
  ]);
  await assert.rejects(() => client.searchExact('123'), { message: 'INVALID_USERNAME' });
  await assert.rejects(() => client.searchExact('１２３４５６'), { message: 'INVALID_USERNAME' });
});

test('maps friends, requests, and invites with padded UIDs and explicit directions', async () => {
  const harness = createHarness({ rpcResults: [
    { data: [{
      user_id: 'user-2', player_uid: 7, username: 'friend_2', game_name: '朋友乙',
      online: true, last_seen_at: '2026-07-19T00:00:00Z',
    }], error: null },
    { data: [{
      id: 'request-1', direction: 'incoming', other_user_id: 'user-3',
      other_player_uid: 8, other_username: 'friend_3', other_game_name: '朋友丙',
      created_at: '2026-07-19T00:01:00Z',
    }], error: null },
    { data: [{
      id: 'invite-1', game_id: 'game-1', game_type: 'gomoku', room_code: 'ABC234',
      wager_amount: '20', sender_id: 'user-2', sender_player_uid: 7,
      sender_username: 'friend_2', sender_game_name: '朋友乙', recipient_id: 'user-1',
      recipient_player_uid: 1, recipient_username: 'player_1', recipient_game_name: '自己',
      direction: 'incoming', status: 'pending', expires_at: '2026-07-19T00:15:00Z',
      created_at: '2026-07-19T00:02:00Z',
    }], error: null },
  ] });
  const client = createClient(harness);

  assert.deepEqual(await client.listFriends(), [{
    id: 'user-2', uid: '000007', username: 'friend_2', displayName: '朋友乙',
    online: true, lastSeenAt: '2026-07-19T00:00:00Z',
  }]);
  assert.deepEqual(await client.listRequests(), [{
    id: 'request-1', direction: 'incoming',
    player: { id: 'user-3', uid: '000008', username: 'friend_3', displayName: '朋友丙' },
    createdAt: '2026-07-19T00:01:00Z',
  }]);
  assert.deepEqual(await client.listInvites(), [{
    id: 'invite-1', gameId: 'game-1', gameType: 'gomoku', roomCode: 'ABC234',
    wagerAmount: 20,
    sender: { id: 'user-2', uid: '000007', username: 'friend_2', displayName: '朋友乙' },
    recipient: { id: 'user-1', uid: '000001', username: 'player_1', displayName: '自己' },
    direction: 'incoming', status: 'pending', expiresAt: '2026-07-19T00:15:00Z',
    createdAt: '2026-07-19T00:02:00Z',
  }]);
});

test('all friend and invite writes call fixed RPC contracts', async () => {
  const harness = createHarness({ rpcResults: Array.from({ length: 8 }, () => ({ data: null, error: null })) });
  const client = createClient(harness);
  await client.sendRequest('user-2');
  await client.acceptRequest('request-1');
  await client.rejectRequest('request-2');
  await client.removeFriend('user-3');
  await client.heartbeat();
  await client.sendGameInvite('game-1', 'user-4');
  await client.cancelGameInvite('invite-1');
  await client.declineGameInvite('invite-2');
  assert.deepEqual(harness.calls, [
    { name: 'send_friend_request', params: { p_recipient_id: 'user-2' } },
    { name: 'accept_friend_request', params: { p_request_id: 'request-1' } },
    { name: 'reject_friend_request', params: { p_request_id: 'request-2' } },
    { name: 'remove_friend', params: { p_friend_id: 'user-3' } },
    { name: 'heartbeat_player_presence', params: undefined },
    { name: 'send_game_invite', params: { p_game_id: 'game-1', p_recipient_id: 'user-4' } },
    { name: 'cancel_game_invite', params: { p_invite_id: 'invite-1' } },
    { name: 'decline_game_invite', params: { p_invite_id: 'invite-2' } },
  ]);
});

test('guest calls are rejected before touching Supabase', async () => {
  const harness = createHarness({ identityKind: 'guest' });
  const client = createClient(harness);
  for (const action of [
    () => client.searchExact('000001'), () => client.listFriends(),
    () => client.listRequests(), () => client.listInvites(),
    () => client.sendRequest('user-2'), () => client.heartbeat(),
  ]) {
    await assert.rejects(action, { message: 'REGISTERED_ACCOUNT_REQUIRED' });
  }
  assert.equal(harness.calls.length, 0);
});

test('realtime subscription ignores payload state, watches requests and invites, and cleans up', async () => {
  const harness = createHarness();
  const client = createClient(harness);
  const events = [];
  const unsubscribe = await client.subscribe((event) => events.push(event));
  assert.equal(harness.channels.length, 1);
  assert.deepEqual(harness.channels[0].handlers.map(({ filter }) => filter), [
    { event: '*', schema: 'public', table: 'friend_requests' },
    { event: '*', schema: 'public', table: 'game_invites' },
  ]);
  harness.channels[0].handlers[0].handler({ new: { malicious: 'payload' } });
  assert.deepEqual(events, [{ type: 'changed' }]);
  await unsubscribe();
  await unsubscribe();
  assert.equal(harness.removed.length, 1);
  await client.disconnect();
});

test('presence starts immediately for registered identity, repeats every 45s, resumes, and stops', async () => {
  const timers = [];
  const cleared = [];
  const documentListeners = new Map();
  const documentObject = {
    visibilityState: 'visible',
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type) { documentListeners.delete(type); },
  };
  const harness = createHarness({ rpcResults: [
    { data: null, error: null }, { data: null, error: null }, { data: null, error: null },
  ] });
  const client = friendsApi.createFriendsClient({
    accountClient: harness,
    documentObject,
    setIntervalFn(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearIntervalFn(id) { cleared.push(id); },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls[0].name, 'heartbeat_player_presence');
  assert.equal(timers[0].delay, 45000);
  await timers[0].callback();
  await documentListeners.get('visibilitychange')();
  assert.equal(harness.calls.filter(({ name }) => name === 'heartbeat_player_presence').length, 3);

  harness.setIdentity('guest');
  assert.deepEqual(cleared, [1]);
  await client.disconnect();
  assert.equal(documentListeners.size, 0);
});

test('maps stable social, UID, and room errors to Chinese', () => {
  for (const code of [
    'INVALID_PLAYER_UID', 'PLAYER_NOT_FOUND', 'PLAYER_UID_EXHAUSTED',
    'REGISTERED_ACCOUNT_REQUIRED', 'CANNOT_FRIEND_SELF', 'FRIEND_REQUEST_EXISTS',
    'ALREADY_FRIENDS', 'FRIEND_REQUEST_NOT_FOUND', 'ROOM_NOT_FOUND',
    'ROOM_EXPIRED', 'ROOM_FULL', 'ROOM_NOT_WAITING', 'NOT_ROOM_OWNER',
    'GAME_INVITE_EXISTS', 'GAME_INVITE_NOT_FOUND', 'GAME_INVITE_EXPIRED',
  ]) {
    const message = friendsApi.mapFriendsError({ code, message: 'raw' });
    assert.equal(typeof message, 'string');
    assert.notEqual(message, 'raw');
  }
});
