const test = require('node:test');
const assert = require('node:assert/strict');

let online = {};

try {
  online = require('../../src/services/online.js');
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
    game_type: 'gomoku',
    status: 'playing',
    board: ['X', ...Array(224).fill(null)],
    x_order: [0],
    o_order: [],
    move_history: [0],
    current_mark: 'O',
    winning_line: [],
    x_score: 2,
    o_score: 1,
    round: 4,
    x_rematch: true,
    o_rematch: false,
    x_undos_remaining: 2,
    o_undos_remaining: 1,
    undo_request_mark: 'X',
    undo_expires_at: '2026-07-16T12:00:15.000Z',
    wager_amount: 50,
    x_stake_locked: true,
    o_stake_locked: true,
    wager_settled_at: null,
    finish_reason: null,
    x_last_seen_at: '2026-07-16T12:00:09.000Z',
    o_last_seen_at: '2026-07-16T12:00:08.000Z',
    version: 7,
    x_player: 'user-x',
    o_player: 'user-o',
    x_player_name: '棋手甲',
    o_player_name: '棋手乙',
  }, 'user-o', { opponentOnline: true });

  assert.deepEqual(game, {
    gameMode: 'online',
    gameType: 'gomoku',
    roomId: 'game-1',
    roomCode: 'ABC23D',
    playerMark: 'O',
    playerNames: { X: '棋手甲', O: '棋手乙' },
    status: 'playing',
    board: ['X', ...Array(224).fill(null)],
    moveOrders: { X: [0], O: [] },
    moveHistory: [0],
    currentMark: 'O',
    winningLine: [],
    scores: { X: 2, O: 1 },
    round: 4,
    rematchReady: { X: true, O: false },
    undoRemaining: { X: 2, O: 1 },
    undoRequest: {
      requesterMark: 'X',
      expiresAt: '2026-07-16T12:00:15.000Z',
    },
    wagerAmount: 50,
    stakeLocked: { X: true, O: true },
    wagerSettledAt: null,
    finishReason: null,
    lastSeenAt: {
      X: '2026-07-16T12:00:09.000Z',
      O: '2026-07-16T12:00:08.000Z',
    },
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
  assert.equal(online.canOnlineMove({
    ...game,
    undoRequest: { requesterMark: 'X', expiresAt: '2999-01-01T00:00:00.000Z' },
  }, 1, { connected: true, submitting: false }), false);

  const gomoku = {
    status: 'playing',
    board: Array(225).fill(null),
    currentMark: 'X',
    playerMark: 'X',
  };
  assert.equal(online.canOnlineMove(gomoku, 224, { connected: true, submitting: false }), true);
  assert.equal(online.canOnlineMove(gomoku, 225, { connected: true, submitting: false }), false);
});

test('mapOnlineError 把稳定错误码转换成中文提示', () => {
  assert.equal(online.mapOnlineError({ message: 'ROOM_NOT_FOUND' }), '房间不存在');
  assert.equal(online.mapOnlineError({ message: 'ROOM_FULL' }), '房间已满');
  assert.equal(online.mapOnlineError({ message: 'NOT_YOUR_TURN' }), '还没轮到你');
  assert.equal(online.mapOnlineError({ message: 'ROOM_GAME_MISMATCH' }), '这个房间属于另一种游戏');
  assert.equal(online.mapOnlineError({ message: 'UNDO_LIMIT_REACHED' }), '本局悔棋次数已经用完');
  assert.equal(online.mapOnlineError({ message: 'REGISTERED_ACCOUNT_REQUIRED' }), '有彩头的房间仅限注册玩家');
  assert.equal(online.mapOnlineError({ message: 'INSUFFICIENT_COINS' }), '金币不足');
  assert.equal(online.mapOnlineError({ message: 'OPPONENT_STILL_ONLINE' }), '对手仍在线，暂时不能判负');
  assert.equal(online.mapOnlineError({ message: 'REMATCH_NOT_PENDING' }), '当前没有待处理的再来一局申请');
  assert.equal(online.mapOnlineError({ message: 'unexpected' }), '线上服务暂时不可用，请稍后重试');
});

test('房间预览映射房主、游戏和每人彩头', () => {
  assert.deepEqual(online.mapRoomPreview({
    game_type: 'gomoku',
    host_name: '棋手甲',
    wager_amount: 100,
    status: 'waiting',
  }), {
    gameType: 'gomoku',
    hostName: '棋手甲',
    wagerAmount: 100,
    status: 'waiting',
  });
});

test('getOnlineStatusMessage 在等待、回合、掉线和胜负状态显示双方游戏名', () => {
  assert.equal(
    online.getOnlineStatusMessage({ phase: 'idle' }),
    '创建房间或输入房间码加入好友',
  );
  assert.equal(
    online.getOnlineStatusMessage({
      game: { status: 'waiting', playerNames: { X: '立哥', O: null } },
    }),
    '等待对手加入，立哥执 X',
  );
  assert.equal(
    online.getOnlineStatusMessage({
      connected: true,
      game: {
        status: 'playing',
        playerMark: 'X',
        currentMark: 'X',
        opponentOnline: true,
        playerNames: { X: '立哥', O: '棋友' },
      },
    }),
    '轮到你（立哥）落子',
  );
  assert.equal(
    online.getOnlineStatusMessage({
      connected: true,
      game: {
        status: 'playing',
        playerMark: 'O',
        currentMark: 'X',
        opponentOnline: false,
        playerNames: { X: '立哥', O: '棋友' },
      },
    }),
    '立哥离线，棋局已保留',
  );
  assert.equal(
    online.getOnlineStatusMessage({
      connected: true,
      game: {
        status: 'x_win',
        playerMark: 'X',
        rematchReady: { X: true, O: false },
        playerNames: { X: '立哥', O: '棋友' },
      },
    }),
    '等待棋友确认再来一局',
  );
  assert.equal(
    online.getOnlineStatusMessage({
      connected: true,
      game: {
        status: 'o_win',
        playerMark: 'X',
        rematchReady: { X: false, O: false },
        playerNames: { X: '立哥', O: '棋友' },
      },
    }),
    '棋友获胜，再来一局',
  );
});

test('buildInviteUrl 生成包含游戏类型和标准房间码的邀请链接', () => {
  assert.equal(
    online.buildInviteUrl('https://example.com/game/?foo=1', 'ab-c23d', 'gomoku'),
    'https://example.com/game/?foo=1&game=gomoku&room=ABC23D',
  );
});

test('loadSupabaseSdk loads one browser bundle instead of an ESM dependency graph', async () => {
  const sdk = { createClient() {} };
  const browser = {};
  let appendedScript = null;
  const documentObject = {
    createElement(tagName) {
      assert.equal(tagName, 'script');
      return {};
    },
    head: {
      append(script) {
        appendedScript = script;
        browser.supabase = sdk;
        queueMicrotask(() => script.onload());
      },
    },
  };

  const loaded = await online.loadSupabaseSdk({ documentObject, browser });

  assert.equal(
    appendedScript.src,
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  );
  assert.equal(appendedScript.async, true);
  assert.equal(loaded, sdk);
});

test('并发加载 Supabase SDK 只插入一个脚本并复用同一结果', async () => {
  const sdk = { createClient() {} };
  const browser = {};
  let appended = 0;
  let appendedScript;
  const documentObject = {
    createElement() {
      return { remove() {} };
    },
    head: {
      append(script) {
        appended += 1;
        appendedScript = script;
      },
    },
  };

  const first = online.loadSupabaseSdk({ documentObject, browser });
  const second = online.loadSupabaseSdk({ documentObject, browser });
  browser.supabase = sdk;
  appendedScript.onload();

  assert.equal(appended, 1);
  assert.equal(await first, sdk);
  assert.equal(await second, sdk);
});

test('Supabase SDK 加载失败后会清理缓存并允许再次加载', async () => {
  const browser = {};
  const scripts = [];
  const documentObject = {
    createElement() {
      return { removeCalled: false, remove() { this.removeCalled = true; } };
    },
    head: {
      append(script) {
        scripts.push(script);
      },
    },
  };

  const first = online.loadSupabaseSdk({ documentObject, browser });
  scripts[0].onerror();
  await assert.rejects(first, /SUPABASE_SDK_LOAD_FAILED/);

  const second = online.loadSupabaseSdk({ documentObject, browser });
  assert.equal(scripts.length, 2);
  browser.supabase = { createClient() {} };
  scripts[1].onload();
  await second;
});

function createFakeSupabase(rowOverrides = {}) {
  const calls = [];
  const handlers = {};
  const row = {
    id: 'game-1',
    room_code: 'ABC23D',
    game_type: 'tic_tac_toe',
    status: 'waiting',
    board: Array(9).fill(null),
    x_order: [],
    o_order: [],
    move_history: [],
    current_mark: 'X',
    winning_line: [],
    x_score: 0,
    o_score: 0,
    round: 1,
    x_rematch: false,
    o_rematch: false,
    x_undos_remaining: 3,
    o_undos_remaining: 3,
    undo_request_mark: null,
    undo_expires_at: null,
    wager_amount: 0,
    x_stake_locked: false,
    o_stake_locked: false,
    wager_settled_at: null,
    finish_reason: null,
    x_last_seen_at: null,
    o_last_seen_at: null,
    version: 0,
    x_player: 'user-x',
    o_player: null,
    x_player_name: '匿名玩家·ABCD',
    o_player_name: null,
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

function createFakeAccountClient(fake, displayName = '匿名玩家·ABCD', configured = true) {
  return {
    isConfigured() {
      return configured;
    },
    async ensureOnlineIdentity() {
      fake.calls.push(['ensureOnlineIdentity']);
      if (!configured) throw new Error('ONLINE_NOT_CONFIGURED');
      return {
        supabase: fake.client,
        user: { id: 'user-x' },
        identity: { displayName },
      };
    },
  };
}

test('createOnlineClient 未配置 Supabase 时只禁用线上服务', async () => {
  const fake = createFakeSupabase();
  const client = online.createOnlineClient({
    accountClient: createFakeAccountClient(fake, '匿名玩家·ABCD', false),
  });

  await assert.rejects(client.connect(), /ONLINE_NOT_CONFIGURED/);
  assert.deepEqual(fake.calls, [['ensureOnlineIdentity']]);
});

test('createRoom 使用共享账号身份、携带游客名并订阅私有房间频道', async () => {
  const fake = createFakeSupabase();
  const states = [];
  const connections = [];
  const client = online.createOnlineClient({
    accountClient: createFakeAccountClient(fake),
    onState: (state) => states.push(state),
    onConnection: (connected) => connections.push(connected),
  });

  const game = await client.createRoom('gomoku', 50);

  assert.equal(game.playerMark, 'X');
  assert.deepEqual(fake.calls.slice(0, 2), [
    ['ensureOnlineIdentity'],
    ['rpc', 'create_online_game', {
      p_game_type: 'gomoku',
      p_guest_name: '匿名玩家·ABCD',
      p_wager_amount: 50,
    }],
  ]);
  assert.deepEqual(fake.calls.find((call) => call[0] === 'channel'), [
    'channel',
    'room:game-1',
    { config: { private: true, presence: { key: 'user-x' } } },
  ]);
  assert.equal(states.at(-1).roomCode, 'ABC23D');
  assert.equal(connections.at(-1), true);
});

test('previewRoom 规范化房间码并返回房间彩头预览', async () => {
  const fake = createFakeSupabase();
  fake.client.rpc = async (name, params) => {
    fake.calls.push(['rpc', name, params]);
    return {
      data: [{
        game_type: 'tic_tac_toe',
        host_name: '立哥',
        wager_amount: 10,
        status: 'waiting',
      }],
      error: null,
    };
  };
  const client = online.createOnlineClient({
    accountClient: createFakeAccountClient(fake),
  });

  assert.deepEqual(await client.previewRoom(' ab-c23d ', 'tic_tac_toe'), {
    gameType: 'tic_tac_toe',
    hostName: '立哥',
    wagerAmount: 10,
    status: 'waiting',
  });
  assert.deepEqual(fake.calls.filter((call) => call[0] === 'rpc'), [[
    'rpc',
    'preview_online_game',
    { p_room_code: 'ABC23D', p_game_type: 'tic_tac_toe' },
  ]]);
});

test('joinRoom 携带游戏类型，落子、悔棋和重赛都携带当前房间 ID', async () => {
  const fake = createFakeSupabase({
    status: 'playing',
    o_player: 'user-o',
  });
  const client = online.createOnlineClient({
    accountClient: createFakeAccountClient(fake),
  });

  await client.joinRoom(' ab-c23d ', 'tic_tac_toe');
  await client.makeMove(4);
  await client.requestUndo();
  await client.respondUndo(true);
  await client.cancelUndo();
  await client.requestRematch();
  await client.declineRematch();
  await client.heartbeat();
  await client.claimDisconnect();

  assert.deepEqual(fake.calls.filter((call) => call[0] === 'rpc'), [
    ['rpc', 'join_online_game', {
      p_room_code: 'ABC23D',
      p_game_type: 'tic_tac_toe',
      p_guest_name: '匿名玩家·ABCD',
    }],
    ['rpc', 'play_online_move', { p_game_id: 'game-1', p_cell: 4 }],
    ['rpc', 'request_online_undo', { p_game_id: 'game-1' }],
    ['rpc', 'respond_online_undo', { p_game_id: 'game-1', p_accept: true }],
    ['rpc', 'cancel_online_undo', { p_game_id: 'game-1' }],
    ['rpc', 'request_online_rematch', { p_game_id: 'game-1' }],
    ['rpc', 'decline_online_rematch', { p_game_id: 'game-1' }],
    ['rpc', 'heartbeat_online_game', { p_game_id: 'game-1' }],
    ['rpc', 'claim_online_disconnect', { p_game_id: 'game-1' }],
  ]);
});

test('较旧的 RPC 响应不能覆盖较新的 Realtime 状态', async () => {
  const fake = createFakeSupabase({
    status: 'playing',
    o_player: 'user-o',
  });
  const states = [];
  let resolveMove;
  let markMoveStarted;
  const moveStarted = new Promise((resolve) => {
    markMoveStarted = resolve;
  });
  const originalRpc = fake.client.rpc.bind(fake.client);
  fake.client.rpc = async (name, params) => {
    if (name !== 'play_online_move') return originalRpc(name, params);
    fake.calls.push(['rpc', name, params]);
    markMoveStarted();
    return new Promise((resolve) => {
      resolveMove = resolve;
    });
  };

  const client = online.createOnlineClient({
    accountClient: createFakeAccountClient(fake),
    onState: (state) => states.push(state),
  });

  await client.joinRoom('ABC23D');
  const pendingMove = client.makeMove(0);
  await moveStarted;

  fake.handlers['postgres_changes:UPDATE']({
    new: {
      ...fake.row,
      board: ['X', 'O', null, null, null, null, null, null, null],
      x_order: [0],
      o_order: [1],
      version: 2,
    },
  });
  resolveMove({
    data: [{
      ...fake.row,
      board: ['X', null, null, null, null, null, null, null, null],
      x_order: [0],
      current_mark: 'O',
      version: 1,
    }],
    error: null,
  });
  await pendingMove;

  assert.deepEqual(states.map((state) => state.version), [0, 2]);
  assert.equal(states.at(-1).board[1], 'O');
});

test('disconnect 取消频道订阅但不调用退出房间 RPC', async () => {
  const fake = createFakeSupabase();
  const client = online.createOnlineClient({
    accountClient: createFakeAccountClient(fake),
  });

  await client.createRoom();
  await client.disconnect();

  assert.deepEqual(fake.calls.at(-1), ['removeChannel', true]);
  assert.equal(fake.calls.some((call) => call[1] === 'leave_online_game'), false);
});

test('leaveRoom 调用退出 RPC 后清理频道', async () => {
  const fake = createFakeSupabase();
  const client = online.createOnlineClient({
    accountClient: createFakeAccountClient(fake),
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
