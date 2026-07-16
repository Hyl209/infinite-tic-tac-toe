const test = require('node:test');
const assert = require('node:assert/strict');

let online = {};

try {
  online = require('./online.js');
} catch {
  online = {};
}

test('normalizeRoomCode 只保留房间码允许字符并转换为大写', () => {
  assert.equal(typeof online.normalizeRoomCode, 'function');
  assert.equal(online.normalizeRoomCode(' ab-c2 3d '), 'ABC23D');
  assert.equal(online.normalizeRoomCode('o0i1-z9'), 'Z9');
  assert.equal(online.normalizeRoomCode('ABCDEFGH'), 'ABCDEF');
});

test('isValidRoomCode 只接受六位标准房间码', () => {
  assert.equal(online.isValidRoomCode('ABC23D'), true);
  assert.equal(online.isValidRoomCode('ABC23'), false);
  assert.equal(online.isValidRoomCode('ABC2O3'), false);
});

test('mapOnlineGame 把数据库字段映射成页面状态并识别己方棋子', () => {
  const game = online.mapOnlineGame({
    id: 'game-1',
    room_code: 'ABC23D',
    status: 'playing',
    board: ['X', null, null, null, null, null, null, null, null],
    x_order: [0],
    o_order: [],
    current_mark: 'O',
    winning_line: [],
    x_score: 2,
    o_score: 1,
    round: 4,
    x_rematch: true,
    o_rematch: false,
    version: 7,
    x_player: 'user-x',
    o_player: 'user-o',
  }, 'user-o', { opponentOnline: true });

  assert.deepEqual(game, {
    gameMode: 'online',
    roomId: 'game-1',
    roomCode: 'ABC23D',
    playerMark: 'O',
    status: 'playing',
    board: ['X', null, null, null, null, null, null, null, null],
    moveOrders: { X: [0], O: [] },
    currentMark: 'O',
    winningLine: [],
    scores: { X: 2, O: 1 },
    round: 4,
    rematchReady: { X: true, O: false },
    opponentOnline: true,
    version: 7,
  });
});

test('canOnlineMove 只允许在线且轮到自己的玩家点击空格', () => {
  const game = {
    status: 'playing',
    board: ['X', null, null, null, null, null, null, null, null],
    currentMark: 'O',
    playerMark: 'O',
  };

  assert.equal(online.canOnlineMove(game, 1, { connected: true, submitting: false }), true);
  assert.equal(online.canOnlineMove(game, 0, { connected: true, submitting: false }), false);
  assert.equal(online.canOnlineMove(game, 1, { connected: false, submitting: false }), false);
  assert.equal(online.canOnlineMove(game, 1, { connected: true, submitting: true }), false);
  assert.equal(online.canOnlineMove({ ...game, currentMark: 'X' }, 1, { connected: true, submitting: false }), false);
});

test('mapOnlineError 把稳定错误码转换成中文提示', () => {
  assert.equal(online.mapOnlineError({ message: 'ROOM_NOT_FOUND' }), '房间不存在');
  assert.equal(online.mapOnlineError({ message: 'ROOM_FULL' }), '房间已满');
  assert.equal(online.mapOnlineError({ message: 'NOT_YOUR_TURN' }), '还没轮到你');
  assert.equal(online.mapOnlineError({ message: 'unexpected' }), '线上服务暂时不可用，请稍后重试');
});

test('getOnlineStatusMessage 覆盖等待、回合、掉线和重赛状态', () => {
  assert.equal(
    online.getOnlineStatusMessage({ phase: 'idle' }),
    '创建房间或输入房间码加入好友',
  );
  assert.equal(
    online.getOnlineStatusMessage({ game: { status: 'waiting' } }),
    '等待对手加入房间',
  );
  assert.equal(
    online.getOnlineStatusMessage({
      connected: true,
      game: { status: 'playing', playerMark: 'X', currentMark: 'X', opponentOnline: true },
    }),
    '轮到你落子，你是 X',
  );
  assert.equal(
    online.getOnlineStatusMessage({
      connected: true,
      game: { status: 'playing', playerMark: 'O', currentMark: 'X', opponentOnline: false },
    }),
    '对手离线，棋局已保留',
  );
  assert.equal(
    online.getOnlineStatusMessage({
      connected: true,
      game: {
        status: 'x_win',
        playerMark: 'X',
        rematchReady: { X: true, O: false },
      },
    }),
    '等待对手确认再来一局',
  );
});

test('buildInviteUrl 生成包含标准房间码的邀请链接', () => {
  assert.equal(
    online.buildInviteUrl('https://example.com/game/?foo=1', 'ab-c23d'),
    'https://example.com/game/?foo=1&room=ABC23D',
  );
});

function createFakeSupabase(rowOverrides = {}) {
  const calls = [];
  const handlers = {};
  const row = {
    id: 'game-1',
    room_code: 'ABC23D',
    status: 'waiting',
    board: Array(9).fill(null),
    x_order: [],
    o_order: [],
    current_mark: 'X',
    winning_line: [],
    x_score: 0,
    o_score: 0,
    round: 1,
    x_rematch: false,
    o_rematch: false,
    version: 0,
    x_player: 'user-x',
    o_player: null,
    ...rowOverrides,
  };

  const channel = {
    on(type, filter, handler) {
      handlers[`${type}:${filter.event}`] = handler;
      return this;
    },
    subscribe(handler) {
      calls.push(['subscribe']);
      handler('SUBSCRIBED');
      return this;
    },
    async track(payload) {
      calls.push(['track', payload]);
    },
    presenceState() {
      return { 'user-x': [{ mark: 'X' }] };
    },
  };

  const client = {
    auth: {
      async getSession() {
        calls.push(['getSession']);
        return { data: { session: null } };
      },
      async signInAnonymously() {
        calls.push(['signInAnonymously']);
        return { data: { user: { id: 'user-x' } }, error: null };
      },
    },
    async rpc(name, params) {
      calls.push(['rpc', name, params]);
      return { data: [row], error: null };
    },
    channel(name, options) {
      calls.push(['channel', name, options]);
      return channel;
    },
    async removeChannel(value) {
      calls.push(['removeChannel', value === channel]);
    },
  };

  return { calls, channel, client, handlers, row };
}

test('createOnlineClient 未配置 Supabase 时只禁用线上服务', async () => {
  let loaded = false;
  const client = online.createOnlineClient({
    config: { supabaseUrl: '', supabaseAnonKey: '' },
    loadSupabase: async () => {
      loaded = true;
    },
  });

  await assert.rejects(client.connect(), /ONLINE_NOT_CONFIGURED/);
  assert.equal(loaded, false);
});

test('createRoom 匿名登录、调用 RPC 并订阅私有房间频道', async () => {
  const fake = createFakeSupabase();
  const states = [];
  const connections = [];
  const client = online.createOnlineClient({
    config: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    loadSupabase: async () => ({ createClient: () => fake.client }),
    onState: (state) => states.push(state),
    onConnection: (connected) => connections.push(connected),
  });

  const game = await client.createRoom();

  assert.equal(game.playerMark, 'X');
  assert.deepEqual(fake.calls.slice(0, 3), [
    ['getSession'],
    ['signInAnonymously'],
    ['rpc', 'create_online_game', undefined],
  ]);
  assert.deepEqual(fake.calls.find((call) => call[0] === 'channel'), [
    'channel',
    'room:game-1',
    { config: { private: true, presence: { key: 'user-x' } } },
  ]);
  assert.equal(states.at(-1).roomCode, 'ABC23D');
  assert.equal(connections.at(-1), true);
});

test('joinRoom 标准化房间码，落子和重赛都携带当前房间 ID', async () => {
  const fake = createFakeSupabase({
    status: 'playing',
    o_player: 'user-o',
  });
  const client = online.createOnlineClient({
    config: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    loadSupabase: async () => ({ createClient: () => fake.client }),
  });

  await client.joinRoom(' ab-c23d ');
  await client.makeMove(4);
  await client.requestRematch();

  assert.deepEqual(fake.calls.filter((call) => call[0] === 'rpc'), [
    ['rpc', 'join_online_game', { p_room_code: 'ABC23D' }],
    ['rpc', 'play_online_move', { p_game_id: 'game-1', p_cell: 4 }],
    ['rpc', 'request_online_rematch', { p_game_id: 'game-1' }],
  ]);
});

test('disconnect 取消频道订阅但不调用退出房间 RPC', async () => {
  const fake = createFakeSupabase();
  const client = online.createOnlineClient({
    config: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    loadSupabase: async () => ({ createClient: () => fake.client }),
  });

  await client.createRoom();
  await client.disconnect();

  assert.deepEqual(fake.calls.at(-1), ['removeChannel', true]);
  assert.equal(fake.calls.some((call) => call[1] === 'leave_online_game'), false);
});

test('leaveRoom 调用退出 RPC 后清理频道', async () => {
  const fake = createFakeSupabase();
  const client = online.createOnlineClient({
    config: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    loadSupabase: async () => ({ createClient: () => fake.client }),
  });

  await client.createRoom();
  await client.leaveRoom();

  assert.deepEqual(fake.calls.filter((call) => call[0] === 'rpc').at(-1), [
    'rpc',
    'leave_online_game',
    { p_game_id: 'game-1' },
  ]);
  assert.deepEqual(fake.calls.at(-1), ['removeChannel', true]);
});
