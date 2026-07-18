const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

let engine = {};
let app = {};

try {
  engine = require('../../src/domain/games/tic-tac-toe.js');
} catch {
  engine = {};
}

try {
  app = require('../../src/routes/game.js');
} catch {
  app = {};
}

const makePosition = (board, moveOrders) => ({ board, moveOrders });

test('checkWinner 能识别横向胜利', () => {
  assert.equal(typeof engine.checkWinner, 'function');
  assert.deepEqual(
    engine.checkWinner(['X', 'X', 'X', null, null, null, null, null, null]),
    { winner: 'X', line: [0, 1, 2] },
  );
});

test('checkWinner 能识别全部八条胜利线', () => {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const line of lines) {
    const board = Array(9).fill(null);
    line.forEach((index) => {
      board[index] = 'O';
    });
    assert.deepEqual(engine.checkWinner(board), { winner: 'O', line });
  }
});

test('isDraw 只在棋盘填满且无人获胜时返回 true', () => {
  assert.equal(
    engine.isDraw(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']),
    true,
  );
  assert.equal(
    engine.isDraw(['X', 'X', 'X', 'O', 'O', null, null, null, null]),
    false,
  );
});

test('getAvailableMoves 返回全部空位', () => {
  assert.deepEqual(
    engine.getAvailableMoves(['X', null, 'O', null, 'X', null, 'O', null, null]),
    [1, 3, 5, 7, 8],
  );
});

test('applyMove 拒绝重复、越界和非法棋子', () => {
  const board = ['X', null, null, null, null, null, null, null, null];
  assert.equal(engine.applyMove(board, 0, 'O'), null);
  assert.equal(engine.applyMove(board, 9, 'O'), null);
  assert.equal(engine.applyMove(board, 1, 'A'), null);
  assert.deepEqual(engine.applyMove(board, 1, 'O'), ['X', 'O', null, null, null, null, null, null, null]);
  assert.deepEqual(board, ['X', null, null, null, null, null, null, null, null]);
});

test('简单档只会选择空位', () => {
  const position = makePosition(
    ['X', 'O', 'X', 'O', null, 'X', null, null, 'O'],
    { X: [0, 2, 5], O: [1, 3, 8] },
  );
  assert.equal(engine.chooseAIMove(position, 'easy', 'X', () => 0), 4);
  assert.equal(engine.chooseAIMove(position, 'easy', 'X', () => 0.999), 7);
});

test('普通档优先完成胜利', () => {
  const position = makePosition(
    ['O', 'O', null, 'X', 'X', null, null, null, null],
    { X: [3, 4], O: [0, 1] },
  );
  assert.equal(engine.chooseAIMove(position, 'normal', 'O', () => 0.99), 2);
});

test('普通档会阻止玩家下一步获胜', () => {
  const position = makePosition(
    ['X', 'X', null, 'O', null, null, null, 'O', null],
    { X: [0, 1], O: [3, 7] },
  );
  assert.equal(engine.chooseAIMove(position, 'normal', 'O', () => 0.99), 2);
});

test('普通档会按消除后的局面寻找胜利和拦截', () => {
  const aiCanWin = makePosition(
    ['O', 'O', null, null, 'O', null, null, null, null],
    { X: [], O: [0, 1, 4] },
  );
  assert.equal(engine.chooseAIMove(aiCanWin, 'normal', 'O', () => 0), 7);

  const playerCanWin = makePosition(
    ['X', 'X', null, null, 'X', null, null, null, null],
    { X: [0, 1, 4], O: [] },
  );
  assert.equal(engine.chooseAIMove(playerCanWin, 'normal', 'O', () => 0), 7);
});

test('困难档 minimax 会模拟消除并选择即时胜利', () => {
  const position = makePosition(
    ['O', 'O', null, 'X', 'O', null, 'X', null, 'X'],
    { X: [3, 6, 8], O: [0, 1, 4] },
  );
  assert.equal(engine.chooseAIMove(position, 'hard', 'O'), 7);
});

test('startGame 根据先手分配棋子和当前回合', () => {
  assert.deepEqual(engine.startGame({ firstPlayer: 'player', difficulty: 'normal' }), {
    board: Array(9).fill(null),
    gameMode: 'ai',
    difficulty: 'normal',
    playerMark: 'X',
    aiMark: 'O',
    currentTurn: 'player',
    status: 'playing',
    winningLine: [],
    moveOrders: { X: [], O: [] },
  });

  assert.deepEqual(engine.startGame({ firstPlayer: 'ai', difficulty: 'hard' }), {
    board: Array(9).fill(null),
    gameMode: 'ai',
    difficulty: 'hard',
    playerMark: 'O',
    aiMark: 'X',
    currentTurn: 'ai',
    status: 'playing',
    winningLine: [],
    moveOrders: { X: [], O: [] },
  });
});

test('startGame 双人模式固定由 X 先手', () => {
  assert.deepEqual(engine.startGame({ gameMode: 'pvp' }), {
    board: Array(9).fill(null),
    gameMode: 'pvp',
    difficulty: 'normal',
    playerMark: null,
    aiMark: null,
    currentTurn: 'player',
    currentMark: 'X',
    status: 'playing',
    winningLine: [],
    moveOrders: { X: [], O: [] },
  });
});

test('startGame 线上模式以等待房间状态启动', () => {
  assert.deepEqual(engine.startGame({ gameMode: 'online' }), {
    board: Array(9).fill(null),
    gameMode: 'online',
    difficulty: 'normal',
    playerMark: null,
    aiMark: null,
    currentTurn: null,
    currentMark: 'X',
    status: 'waiting',
    winningLine: [],
    moveOrders: { X: [], O: [] },
  });
});

test('getNextPvpMark 在 X 和 O 之间轮换', () => {
  assert.equal(engine.getNextPvpMark('X'), 'O');
  assert.equal(engine.getNextPvpMark('O'), 'X');
});

test('getScoreSide 根据对战模式映射胜者计分栏', () => {
  assert.equal(engine.getScoreSide({ gameMode: 'pvp' }, 'X'), 'left');
  assert.equal(engine.getScoreSide({ gameMode: 'pvp' }, 'O'), 'right');
  assert.equal(
    engine.getScoreSide({ gameMode: 'ai', playerMark: 'O' }, 'O'),
    'left',
  );
  assert.equal(
    engine.getScoreSide({ gameMode: 'ai', playerMark: 'O' }, 'X'),
    'right',
  );
});

test('页面提供人机和双人模式入口及可切换比分标签', () => {
  const html = fs.readFileSync('./game/index.html', 'utf8');
  assert.match(html, /name="game-mode"\s+value="ai"/);
  assert.match(html, /name="game-mode"\s+value="pvp"/);
  assert.match(html, /id="ai-difficulty-settings"/);
  assert.match(html, /id="ai-first-settings"/);
  assert.match(html, /id="left-score-name"/);
  assert.match(html, /id="right-score-name"/);
});

test('页面提供线上房间入口和在线操作控件', () => {
  const html = fs.readFileSync('./game/index.html', 'utf8');
  assert.match(html, /name="game-mode"\s+value="online"/);
  assert.match(html, /id="online-room-panel"/);
  assert.match(html, /id="room-code-input"/);
  assert.match(html, /id="create-room-button"/);
  assert.match(html, /id="join-room-button"/);
  assert.match(html, /id="copy-room-button"/);
  assert.match(html, /id="leave-room-button"/);
  assert.match(html, /id="middle-score-name"/);
  assert.match(html, /src="\/src\/config\/online\.js"[^>]*defer/);
  assert.match(html, /src="\/src\/services\/online\.js"[^>]*defer/);
});

test('房间码输入先接收常见分隔符再由脚本清洗，不能提前截断第六位', () => {
  const html = fs.readFileSync('./game/index.html', 'utf8');
  const inputTag = html.match(/<input[\s\S]*?id="room-code-input"[\s\S]*?>/)?.[0] || '';
  assert.match(inputTag, /maxlength="12"/);
  assert.match(inputTag, /autocapitalize="characters"/);
});

test('房间码组合输入期间不改写，提交后只保留一个大写字符', () => {
  assert.equal(app.normalizeRoomCodeInput('a', true), 'a');
  assert.equal(app.normalizeRoomCodeInput('a', false), 'A');
  assert.equal(app.normalizeRoomCodeInput('ab-c23d', false), 'ABC23D');
});

test('移动端进入棋局优先定位棋盘，邀请链接优先定位房间确认区', () => {
  assert.equal(app.getGameEntryTarget({ roomCode: null, joined: false }), 'board');
  assert.equal(app.getGameEntryTarget({ roomCode: 'ABC23D', joined: false }), 'online-room-panel');
  assert.equal(app.getGameEntryTarget({ roomCode: 'ABC23D', joined: true }), 'board');
});

test('页面使用统一对局弹窗且悔棋不再提供取消按钮', () => {
  const html = fs.readFileSync('./game/index.html', 'utf8');
  assert.match(html, /id="game-event-dialog"/);
  assert.match(html, /id="game-event-title"/);
  assert.match(html, /id="game-event-message"/);
  assert.match(html, /id="game-event-primary"/);
  assert.match(html, /id="game-event-secondary"/);
  assert.doesNotMatch(html, /id="cancel-undo-button"/);
});

test('对局弹窗按结果、悔棋和重赛状态提供准确操作', () => {
  const result = app.getGameDialogState({
    state: { gameMode: 'ai', status: 'x_win' },
    resultMessage: '你赢了，漂亮的一局',
    roundKey: 'local:4',
  });
  assert.deepEqual(result.actions, [
    { action: 'restart', label: '再来一局' },
    { action: 'close', label: '关闭' },
  ]);
  assert.equal(result.dismissible, true);

  const undo = app.getGameDialogState({
    state: { gameMode: 'online', status: 'playing' },
    onlineGame: {
      playerMark: 'O',
      playerNames: { X: '立哥', O: '棋友' },
      undoRequest: { requesterMark: 'X', expiresAt: '2999-01-01T00:00:00.000Z' },
    },
  });
  assert.deepEqual(undo.actions, [
    { action: 'accept-undo', label: '同意' },
    { action: 'reject-undo', label: '拒绝' },
  ]);
  assert.equal(undo.message, '立哥申请撤回最近一手');
  assert.equal(undo.dismissible, false);

  const ownUndo = app.getGameDialogState({
    state: { gameMode: 'online', status: 'playing' },
    onlineGame: {
      playerMark: 'X',
      undoRequest: { requesterMark: 'X', expiresAt: '2999-01-01T00:00:00.000Z' },
    },
  });
  assert.equal(ownUndo, null);

  const rematch = app.getGameDialogState({
    state: { gameMode: 'online', status: 'x_win' },
    onlineGame: {
      round: 2,
      playerMark: 'O',
      playerNames: { X: '立哥', O: '棋友' },
      rematchReady: { X: true, O: false },
    },
  });
  assert.deepEqual(rematch.actions, [
    { action: 'accept-rematch', label: '同意' },
    { action: 'reject-rematch', label: '拒绝' },
  ]);
  assert.equal(rematch.message, '立哥申请再来一局');
  assert.equal(rematch.dismissible, false);

  const rejected = app.getGameDialogState({
    state: { gameMode: 'online', status: 'x_win' },
    onlineGame: {
      round: 2,
      version: 8,
      playerMark: 'X',
      rematchReady: { X: false, O: false },
    },
    rematchRejected: { round: 2, version: 8 },
  });
  assert.deepEqual(rejected, {
    key: 'rematch-rejected:2:8:x_win',
    title: '再来一局',
    message: '对方已拒绝再来一局',
    actions: [{ action: 'close', label: '关闭' }],
    dismissible: true,
  });
});

test('线上操作错误优先覆盖可操作弹窗文案，清空后恢复原文案', () => {
  const actionError = '线上服务暂时不可用，请稍后重试';
  const undoOptions = {
    state: { gameMode: 'online', status: 'playing' },
    onlineGame: {
      playerMark: 'O',
      playerNames: { X: '立哥', O: '棋友' },
      undoRequest: { requesterMark: 'X', expiresAt: '2999-01-01T00:00:00.000Z' },
    },
  };
  assert.equal(app.getGameDialogState({ ...undoOptions, actionError }).message, actionError);
  assert.equal(app.getGameDialogState(undoOptions).message, '立哥申请撤回最近一手');

  const rematchOptions = {
    state: { gameMode: 'online', status: 'x_win' },
    onlineGame: {
      round: 2,
      version: 7,
      playerMark: 'O',
      playerNames: { X: '立哥', O: '棋友' },
      rematchReady: { X: true, O: false },
    },
  };
  assert.equal(app.getGameDialogState({ ...rematchOptions, actionError }).message, actionError);
  assert.equal(app.getGameDialogState(rematchOptions).message, '立哥申请再来一局');

  const resultOptions = {
    state: { gameMode: 'online', status: 'draw' },
    onlineGame: {
      round: 2,
      version: 7,
      playerMark: 'X',
      rematchReady: { X: false, O: false },
    },
    resultMessage: '本局平局，棋逢对手',
    roundKey: 'room:2',
  };
  assert.equal(app.getGameDialogState({ ...resultOptions, actionError }).message, actionError);
  assert.equal(app.getGameDialogState(resultOptions).message, '本局平局，棋逢对手');
});

test('相同弹窗键只在展示内容变化时需要更新', () => {
  const current = {
    key: 'rematch:2:7:x_win',
    title: '再来一局',
    message: '立哥申请再来一局',
    actions: [
      { action: 'accept-rematch', label: '同意' },
      { action: 'reject-rematch', label: '拒绝' },
    ],
    dismissible: false,
  };
  assert.equal(app.shouldUpdateGameDialogContent(current, { ...current }), false);
  assert.equal(app.shouldUpdateGameDialogContent(current, {
    ...current,
    message: '线上服务暂时不可用，请稍后重试',
  }), true);
});

test('只把申请方同轮已结束状态的己方 ready true 到 false 识别为拒绝', () => {
  const requesterBefore = {
    round: 3,
    version: 10,
    status: 'draw',
    playerMark: 'X',
    rematchReady: { X: true, O: false },
  };
  const requesterAfter = {
    ...requesterBefore,
    version: 11,
    rematchReady: { X: false, O: false },
  };
  assert.equal(app.detectRematchRejection(requesterBefore, requesterAfter), true);

  const opponentBefore = {
    ...requesterBefore,
    playerMark: 'O',
  };
  const opponentAfter = {
    ...requesterAfter,
    playerMark: 'O',
  };
  assert.equal(app.detectRematchRejection(opponentBefore, opponentAfter), false);

  const acceptedNextRound = {
    ...requesterAfter,
    round: 4,
    status: 'playing',
  };
  assert.equal(app.detectRematchRejection(requesterBefore, acceptedNextRound), false);
});

test('同轮重赛请求版本变化时生成新的弹窗键', () => {
  const state = { gameMode: 'online', status: 'x_win' };
  const onlineGame = {
    round: 2,
    version: 7,
    playerMark: 'O',
    playerNames: { X: '立哥', O: '棋友' },
    rematchReady: { X: true, O: false },
  };
  const first = app.getGameDialogState({ state, onlineGame });
  const second = app.getGameDialogState({
    state,
    onlineGame: { ...onlineGame, version: 8 },
  });

  assert.notEqual(first.key, second.key);
});

test('只有关闭操作会立即 dismiss 对局弹窗', () => {
  assert.equal(typeof app.shouldDismissGameDialogAction, 'function');
  assert.equal(app.shouldDismissGameDialogAction('close'), true);
  for (const action of [
    'restart',
    'accept-undo',
    'reject-undo',
    'accept-rematch',
    'reject-rematch',
  ]) {
    assert.equal(app.shouldDismissGameDialogAction(action), false);
  }
});

test('页面控制器通过 OnlineGame 客户端提交线上操作而不是本地落子', () => {
  const source = fs.readFileSync('./src/routes/game.js', 'utf8');
  assert.match(source, /createOnlineClient\(\{/);
  assert.match(source, /onlineApi\?\.canOnlineMove/);
  assert.match(source, /onlineClient\.makeMove/);
  assert.match(source, /onlineClient\.requestRematch/);
  assert.match(source, /onlineClient\.declineRematch/);
  assert.match(source, /action === 'reject-rematch'[\s\S]*declineOnlineRematch/);
  assert.match(source, /actionError:\s*onlineError/);
  assert.match(source, /shouldUpdateGameDialogContent\(activeGameDialog,\s*nextDialog\)/);
  assert.match(source, /onlineClient\.leaveRoom/);
  assert.match(source, /restartButton\.hidden\s*=\s*isOnline\s*&&\s*!hasOnlineRoom/);
});

test('线上胜利状态使用数据库状态名也能命中结果样式', () => {
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  assert.match(css, /\.status-card\[data-result="x_win"\]/);
  assert.match(css, /\.status-card\[data-result="o_win"\]/);
});

test('removeOldestPiece 删除顺序数组中的最早棋子', () => {
  const board = ['X', 'O', null, 'X', 'X', null, 'X', null, 'O'];
  assert.deepEqual(engine.removeOldestPiece(board, [0, 3, 6, 4]), {
    board: [null, 'O', null, 'X', 'X', null, 'X', null, 'O'],
    moveOrder: [3, 6, 4],
    removedIndex: 0,
  });
});

test('applyDynamicMove 落下第 4 颗时只删除己方最早棋子', () => {
  const position = {
    board: ['X', 'O', null, 'X', null, 'O', 'X', null, null],
    moveOrders: { X: [0, 3, 6], O: [1, 5] },
  };

  assert.deepEqual(engine.applyDynamicMove(position, 4, 'X'), {
    board: [null, 'O', null, 'X', 'X', 'O', 'X', null, null],
    moveOrders: { X: [3, 6, 4], O: [1, 5] },
    removedIndex: 0,
  });
});

test('动态落子必须先删旧子再判胜负', () => {
  const falseWinPosition = {
    board: ['X', 'X', null, null, 'X', null, null, null, null],
    moveOrders: { X: [0, 1, 4], O: [] },
  };
  const falseWin = engine.applyDynamicMove(falseWinPosition, 2, 'X');
  assert.equal(engine.checkWinner(falseWin.board), null);

  const realWinPosition = {
    board: ['X', 'X', null, null, 'X', null, null, null, null],
    moveOrders: { X: [0, 1, 4], O: [] },
  };
  const realWin = engine.applyDynamicMove(realWinPosition, 7, 'X');
  assert.deepEqual(engine.checkWinner(realWin.board), {
    winner: 'X',
    line: [1, 4, 7],
  });
});

test('连续动态落子后每方最多 3 颗且棋盘始终有空位', () => {
  let position = makePosition(Array(9).fill(null), { X: [], O: [] });
  const moves = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2];

  moves.forEach((move, turn) => {
    const mark = turn % 2 === 0 ? 'X' : 'O';
    position = engine.applyDynamicMove(position, move, mark);
    assert.ok(position);
    assert.ok(position.moveOrders.X.length <= 3);
    assert.ok(position.moveOrders.O.length <= 3);
    assert.ok(engine.getAvailableMoves(position.board).length >= 3);
  });
});

test('getExpiringPieces 分别返回 X 和 O 即将消除的棋子', () => {
  assert.deepEqual(
    engine.getExpiringPieces({ X: [0, 3, 6], O: [1, 4] }),
    [{ index: 0, mark: 'X' }],
  );
  assert.deepEqual(
    engine.getExpiringPieces({ X: [0, 3, 6], O: [1, 4, 7] }),
    [{ index: 0, mark: 'X' }, { index: 1, mark: 'O' }],
  );
});

test('棋盘固定为三行等高，棋子内容不能拉伸格子', () => {
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  const boardBlock = css.match(/(?:^|\n)\.board\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(
    boardBlock,
    /grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  );
});

test('线上房间控件在窄屏下使用可收缩网格避免横向溢出', () => {
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  const joinBlock = css.match(/\.room-join-row\s*\{([^}]*)\}/)?.[1] || '';
  const inputBlock = css.match(/#room-code-input\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(joinBlock, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(inputBlock, /min-width:\s*0/);
});

test('线上会话区的网格样式不能覆盖 hidden 属性', () => {
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  assert.match(
    css,
    /\.online-room-session\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s,
  );
});

test('落子、胜利和按压反馈不能缩放格子容器', () => {
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  const selectors = [
    '.cell:hover[aria-disabled="false"]',
    '.cell:active[aria-disabled="false"]',
    '.cell.just-played',
    '.cell.winner',
  ];

  selectors.forEach((selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
    assert.doesNotMatch(block, /(?:transform|animation)\s*:/, selector);
  });

  assert.match(css, /\.cell\.just-played::before\s*\{[^}]*animation:/s);
});

test('AI 回合必须原生禁用格子并锁定棋盘点击', () => {
  const source = fs.readFileSync('./src/routes/game.js', 'utf8');
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  const thinkingBoardBlock = css.match(
    /\.game-panel\.is-thinking\s+\.board\s*\{([^}]*)\}/,
  )?.[1] || '';
  const thinkingPanelBlock = css.match(
    /\.game-panel\.is-thinking\s*\{([^}]*)\}/,
  )?.[1] || '';

  assert.match(
    source,
    /:\s*aiThinking\s*\|\|\s*state\.status\s*!==\s*'playing'/,
  );
  assert.match(thinkingBoardBlock, /pointer-events:\s*none/);
  assert.match(thinkingPanelBlock, /cursor:\s*wait/);
});

test('落子动画第一帧必须可见，不能用透明度隐藏棋子', () => {
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  const start = css.indexOf('@keyframes place-mark');
  const end = css.indexOf('@keyframes winner-pop');
  const placeMarkKeyframes = css.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(placeMarkKeyframes, /opacity\s*:/);
  assert.match(placeMarkKeyframes, /transform:\s*scale\(0\.[89]/);
});

test('独立游戏页面保留游戏专区和双游戏入口', () => {
  const html = fs.readFileSync('./game/index.html', 'utf8');
  assert.doesNotMatch(html, /id="portal-home"/);
  assert.match(html, /rel="icon"\s+href="\/assets\/images\/image_02\.png"/);
  assert.match(
    html,
    /class="site-brand-mark"[\s\S]*?<img[^>]+src="\/assets\/images\/image_01\.png"/,
  );
  assert.match(
    html,
    /class="home-mark"[\s\S]*?<img[^>]+src="\/assets\/images\/image_02\.png"/,
  );
  assert.match(html, /id="game-home"/);
  assert.match(html, /href="\/game\/\?game=tic_tac_toe"/);
  assert.match(html, /href="\/game\/\?game=gomoku"/);
  assert.match(html, /id="game-view"[^>]*hidden/);
  assert.match(html, /id="back-home-button"/);
  assert.match(html, /href="\/"[^>]*>返回 HYL Space</);
  assert.match(
    html,
    /src="\/src\/domain\/games\/tic-tac-toe\.js"[^>]*defer[\s\S]*src="\/src\/domain\/games\/gomoku\.js"[^>]*defer[\s\S]*src="\/src\/routes\/game\.js"[^>]*defer/,
  );
  assert.doesNotMatch(html, /src="\/src\/routes\/portal\.js"/);
});

test('全站导航提供统一身份入口并在游戏脚本前加载账号服务', () => {
  const html = fs.readFileSync('./game/index.html', 'utf8');
  const navStart = html.indexOf('class="site-nav game-site-nav"');
  const gameStart = html.indexOf('id="game-home"');
  const navMarkup = html.slice(navStart, gameStart);

  assert.match(navMarkup, /id="account-button"/);
  assert.match(html, /id="account-dialog"/);
  assert.match(html, /id="account-login-form"/);
  assert.match(html, /id="account-register-form"/);
  assert.match(html, /id="account-profile-form"/);
  assert.match(html, /id="register-username"[^>]*autocomplete="username"/);
  assert.match(html, /id="register-password"[^>]*autocomplete="new-password"/);
  assert.match(html, /id="register-game-name"[^>]*maxlength="16"/);
  assert.match(
    html,
    /src="\/src\/services\/online\.js"[^>]*defer[\s\S]*src="\/src\/services\/account\.js"[^>]*defer[\s\S]*src="\/src\/routes\/account-panel\.js"[^>]*defer[\s\S]*src="\/src\/routes\/game\.js"[^>]*defer/,
  );
});

test('游戏页导航提供玩家中心和通知未读入口', () => {
  const html = fs.readFileSync('./game/index.html', 'utf8');
  const navStart = html.indexOf('class="site-nav game-site-nav"');
  const gameStart = html.indexOf('id="game-home"');
  const navMarkup = html.slice(navStart, gameStart);

  assert.match(navMarkup, /href="\/player\/"[^>]*>[^<]*玩家中心/);
  assert.match(navMarkup, /id="notification-bell"[^>]*href="\/player\/\?tab=notifications"/);
  assert.match(navMarkup, /id="notification-bell"[^>]*aria-label="[^"]*通知[^"]*"/);
  assert.match(navMarkup, /id="notification-unread-count"[^>]*hidden/);
  assert.match(navMarkup, /id="account-button"[^>]*aria-label="打开账号面板"/);
  assert.match(
    html,
    /src="\/src\/services\/account\.js"[^>]*defer[\s\S]*src="\/src\/services\/notifications\.js"[^>]*defer[\s\S]*src="\/src\/routes\/account-panel\.js"[^>]*defer[\s\S]*src="\/src\/routes\/game\.js"[^>]*defer[\s\S]*src="\/src\/routes\/notification-bell\.js"[^>]*defer/,
  );
});

test('页面加载经济服务并提供余额、兑换码和彩头控件', () => {
  const html = fs.readFileSync('./game/index.html', 'utf8');
  assert.match(
    html,
    /src="\/src\/services\/account\.js"[^>]*defer[\s\S]*src="\/src\/services\/economy\.js"[^>]*defer[\s\S]*src="\/src\/routes\/game\.js"[^>]*defer/,
  );
  for (const id of [
    'account-coin-balance',
    'wallet-panel',
    'redeem-code-form',
    'redeem-code-input',
    'online-wager-picker',
    'room-preview',
    'room-preview-game',
    'confirm-join-button',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const amount of [0, 10, 50, 100]) {
    assert.match(html, new RegExp(`name="online-wager"\\s+value="${amount}"`));
  }
});

test('页面控制器接入经济客户端、房间预览和心跳', () => {
  const source = fs.readFileSync('./src/routes/game.js', 'utf8');
  const accountSource = fs.readFileSync('./src/routes/account-panel.js', 'utf8');
  assert.match(accountSource, /createEconomyClient\(\{[\s\S]*accountClient/);
  assert.match(accountSource, /economyClient\.refresh/);
  assert.match(accountSource, /economyClient\.redeemCode/);
  assert.doesNotMatch(source, /economyClient\.(?:createRedeemCode|listRedeemCodes|disableRedeemCode)/);
  assert.match(source, /onlineClient\.createRoom\(gameType,\s*wagerAmount\)/);
  assert.match(source, /onlineClient\.previewRoom/);
  assert.match(source, /onlineClient\.heartbeat/);
  assert.match(source, /onlineClient\.claimDisconnect/);
  assert.match(source, /10_000/);
  assert.match(source, /30_000/);
});

test('经济界面沿用现有控件并支持窄屏布局', () => {
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  assert.match(css, /\.coin-balance/);
  assert.match(css, /\.wallet-panel/);
  assert.match(css, /\.wager-picker/);
  assert.match(css, /\.room-preview/);
  const mobileStyles = css.slice(css.indexOf('@media (max-width: 760px)'));
  assert.match(mobileStyles, /\.redeem-row/);
});

test('线上状态类型包含彩头、结算和心跳字段', () => {
  const types = fs.readFileSync('./src/types/game.d.ts', 'utf8');
  assert.match(types, /wagerAmount:\s*number/);
  assert.match(types, /stakeLocked:\s*Record<Mark, boolean>/);
  assert.match(types, /wagerSettledAt:\s*string \| null/);
  assert.match(types, /finishReason:/);
  assert.match(types, /lastSeenAt:\s*Record<Mark, string \| null>/);
  assert.match(types, /interface EconomySnapshot/);
  assert.match(types, /interface RoomPreview/);
});

test('游戏页面路由解析棋局、房间和游戏专区', () => {
  assert.deepEqual(app.resolveAppRoute('https://example.com/game/'), {
    view: 'games', gameType: null, roomCode: null,
  });
  assert.deepEqual(app.resolveAppRoute('https://example.com/game/?game=gomoku'), {
    view: 'game', gameType: 'gomoku', roomCode: null,
  });
  assert.deepEqual(app.resolveAppRoute('https://example.com/game/?room=abc23d'), {
    view: 'game', gameType: 'tic_tac_toe', roomCode: 'ABC23D',
  });
  assert.deepEqual(app.resolveAppRoute('https://example.com/game/?view=admin'), {
    view: 'admin', gameType: null, roomCode: null,
  });
  assert.deepEqual(app.resolveAppRoute('https://example.com/game/?view=admin&room=ABC23D'), {
    view: 'game', gameType: 'tic_tac_toe', roomCode: 'ABC23D',
  });
  assert.deepEqual(app.resolveAppRoute('https://example.com/game/?view=admin&game=gomoku'), {
    view: 'game', gameType: 'gomoku', roomCode: null,
  });
  assert.deepEqual(app.resolveAppRoute('https://example.com/game/?view=admin&foo=1'), {
    view: 'admin', gameType: null, roomCode: null,
  });
});

test('旧管理后台书签重定向到统一管理中心且不影响棋局查询', () => {
  const source = fs.readFileSync('./src/routes/game.js', 'utf8');
  assert.match(source, /location\.replace\(['"]\/admin\/['"]\)/);
  assert.doesNotMatch(fs.readFileSync('./game/index.html', 'utf8'), /id="admin-view"/);
  assert.doesNotMatch(source, /function\s+(?:renderAdminCodes|renderAdminSeasons|loadAdminCodes|loadAdminSeasons|showAdminView)\s*\(/);
  assert.deepEqual(app.resolveAppRoute('https://example.com/game/?game=gomoku&room=ABC23D'), {
    view: 'game', gameType: 'gomoku', roomCode: 'ABC23D',
  });
});

test('应用 URL 构造会清理冲突参数并保留无关查询参数', () => {
  assert.equal(
    app.buildAppUrl('https://example.com/game/?foo=1&game=gomoku&room=ABC23D', { view: 'games' }),
    'https://example.com/game/?foo=1',
  );
  assert.equal(
    app.buildAppUrl('https://example.com/game/?view=games', { view: 'game', gameType: 'gomoku' }),
    'https://example.com/game/?game=gomoku',
  );
});

test('页面控制器共享账号客户端并处理注册、登录、改名和退出', () => {
  const gameSource = fs.readFileSync('./src/routes/game.js', 'utf8');
  const accountSource = fs.readFileSync('./src/routes/account-panel.js', 'utf8');
  assert.match(gameSource, /HYLAccountPanel\?\.mount/);
  assert.match(gameSource, /createOnlineClient\(\{[\s\S]*accountClient/);
  assert.doesNotMatch(gameSource, /accountLoginForm\?\.addEventListener/);
  for (const legacyFunction of [
    'setAccountMode',
    'setAccountBusy',
    'renderAccount',
    'runAccountAction',
    'renderMatchHistory',
    'loadMatchHistory',
    'redeemCoins',
  ]) {
    assert.doesNotMatch(gameSource, new RegExp(`\\bfunction\\s+${legacyFunction}\\s*\\(`));
  }
  for (const selector of [
    '#account-login-form',
    '#account-register-form',
    '#account-profile-form',
    '#redeem-code-form',
    '#match-history-filter',
  ]) {
    assert.doesNotMatch(gameSource, new RegExp(`querySelector\\(['\"]${selector}['\"]\\)`));
  }
  assert.match(accountSource, /createAccountClient/);
  assert.match(accountSource, /accountClient\.register/);
  assert.match(accountSource, /accountClient\.login/);
  assert.match(accountSource, /accountClient\.updateGameName/);
  assert.match(accountSource, /accountClient\.logout/);
  assert.match(accountSource, /economyClient\.redeemCode/);
  assert.match(accountSource, /statsClient\.getHistory/);
});

test('在线比分标签组合游戏名和棋子，缺少名称时保留棋子', () => {
  assert.equal(app.formatOnlineScoreName('立哥', 'X'), '立哥 · X');
  assert.equal(app.formatOnlineScoreName('', 'O'), 'O');
});

test('个人资料弹窗使用固定层并在窄屏改为安全边距布局', () => {
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  assert.match(css, /\.account-dialog\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\.account-dialog::backdrop/);
  assert.match(css, /\.game-event-dialog::backdrop/);
  assert.match(css, /\.account-field\s+input:focus-visible/);
  const mobileStart = css.indexOf('@media (max-width: 760px)');
  const mobileStyles = css.slice(mobileStart);
  assert.match(mobileStyles, /\.account-button\s*\{[^}]*position:\s*static/s);
  assert.match(mobileStyles, /\.account-dialog\s*\{[^}]*max-width:/s);
});

test('五子棋页面提供落子确认和悔棋控件', () => {
  const html = fs.readFileSync('./game/index.html', 'utf8');
  assert.match(html, /id="placement-settings"/);
  assert.match(html, /name="placement-mode"\s+value="single"/);
  assert.match(html, /name="placement-mode"\s+value="confirm"/);
  assert.match(html, /id="undo-button"/);
  assert.match(html, /id="online-undo-request"/);
  assert.match(html, /id="game-event-primary"/);
  assert.match(html, /id="game-event-secondary"/);
  assert.doesNotMatch(html, /id="cancel-undo-button"/);
});

test('落子确认状态只在第二次点击同一点时提交', () => {
  assert.deepEqual(app.resolvePlacementSelection('single', null, 12), {
    commit: true,
    selected: null,
  });
  assert.deepEqual(app.resolvePlacementSelection('confirm', null, 12), {
    commit: false,
    selected: 12,
  });
  assert.deepEqual(app.resolvePlacementSelection('confirm', 12, 18), {
    commit: false,
    selected: 18,
  });
  assert.deepEqual(app.resolvePlacementSelection('confirm', 12, 12), {
    commit: true,
    selected: null,
  });
});

test('首次落子方式按设备决定并优先使用已保存偏好', () => {
  assert.equal(app.getDefaultPlacementMode(true, null), 'confirm');
  assert.equal(app.getDefaultPlacementMode(false, null), 'single');
  assert.equal(app.getDefaultPlacementMode(true, 'single'), 'single');
  assert.equal(app.getDefaultPlacementMode(false, 'confirm'), 'confirm');
});

test('比分按游戏和模式隔离，切换模式时不清空本次会话比分', () => {
  assert.equal(app.getScoreKey('tic_tac_toe', 'ai'), 'tic_tac_toe:ai');
  assert.equal(app.getScoreKey('tic_tac_toe', 'pvp'), 'tic_tac_toe:pvp');
  assert.equal(app.getScoreKey('gomoku', 'ai'), 'gomoku:ai');

  const source = fs.readFileSync('./src/routes/game.js', 'utf8');
  assert.match(
    source,
    /document\.querySelectorAll\('input\[name="game-mode"\]'\)\s*\.forEach\(\(input\) => input\.addEventListener\('change', \(\) => newRound\(\)\)\);/,
  );
  assert.doesNotMatch(
    source,
    /document\.querySelectorAll\('input\[name="game-mode"\]'\)[\s\S]{0,180}clearScores/,
  );
});

test('本地悔棋按模式和 AI 阶段返回正确撤回步数', () => {
  assert.equal(app.getLocalUndoCount({ gameMode: 'pvp', moveHistory: [0, 1] }), 1);
  assert.equal(app.getLocalUndoCount({
    gameMode: 'ai',
    moveHistory: [0, 1, 2],
    currentTurn: 'ai',
    status: 'playing',
    playerMark: 'X',
  }), 1);
  assert.equal(app.getLocalUndoCount({
    gameMode: 'ai',
    moveHistory: [0, 1, 2, 3],
    currentTurn: 'player',
    status: 'playing',
    playerMark: 'X',
  }), 2);
  assert.equal(app.getLocalUndoCount({
    gameMode: 'ai',
    moveHistory: [0, 1, 2],
    currentTurn: 'player',
    status: 'x_win',
    playerMark: 'X',
  }), 1);
});

test('五子棋棋盘使用 15 列交叉点布局并提供候选落点样式', () => {
  const css = fs.readFileSync('./assets/styles/game.css', 'utf8');
  assert.match(css, /\.board\.gomoku-board\s*\{[^}]*grid-template-columns:\s*repeat\(15,\s*1fr\)/s);
  assert.match(css, /\.gomoku-cell\.candidate::after/);
  assert.match(css, /\.gomoku-cell\.star-point::before/);
  assert.match(css, /\.gomoku-cell\.last-move/);
});

test('困难五子棋 AI 通过 Worker 执行并带有过期请求保护', () => {
  const source = fs.readFileSync('./src/routes/game.js', 'utf8');
  const worker = fs.readFileSync('./src/workers/gomoku-ai-worker.js', 'utf8');
  assert.match(source, /const worker = new Worker\(['"]\/src\/workers\/gomoku-ai-worker\.js['"]\)/);
  assert.match(source, /aiRequestId/);
  assert.match(source, /event\.data\?\.error[\s\S]*chooseAIMove\(state, 'normal'/);
  assert.match(
    source,
    /worker\.onerror = \(\) => \{\s*if \(requestId !== aiRequestId \|\| aiWorker !== worker\) return;/,
  );
  assert.match(worker, /importScripts\(['"]\.\.\/domain\/games\/gomoku\.js['"]\)/);
  assert.match(worker, /timeLimitMs:\s*1200/);
});

test('waiting room exposes the friend invitation dialog and independent controller', () => {
  const html = fs.readFileSync('./game/index.html', 'utf8');
  for (const id of [
    'invite-friend-button', 'friend-invite-dialog',
    'friend-invite-list', 'friend-invite-message',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /src=["']\/src\/services\/friends\.js["']/);
  assert.match(html, /src=["']\/src\/routes\/game-friends\.js["']/);

  const controller = fs.readFileSync('./src/routes/game-friends.js', 'utf8');
  assert.match(controller, /createFriendsClient\s*\(\s*\{\s*accountClient\s*\}\s*\)/);
  assert.match(controller, /setWaitingRoom\s*\(/);
  assert.match(controller, /listFriends\s*\(/);
  assert.match(controller, /sendGameInvite\s*\(/);
  assert.match(controller, /cancelGameInvite\s*\(/);
  assert.doesNotMatch(controller, /createAccountClient\s*\(/);
});

test('game route only wires waiting room state into the friend controller', () => {
  const source = fs.readFileSync('./src/routes/game.js', 'utf8');
  assert.match(source, /HYLGameFriends\?*\.mount\s*\(/);
  assert.match(source, /gameFriends\.setWaitingRoom\s*\(/);
  assert.match(source, /onlineGame\?\.status\s*===\s*['"]waiting['"]/);
  assert.match(source, /onlineGame\?\.playerMark\s*===\s*['"]X['"]/);
  assert.doesNotMatch(source, /createFriendsClient\s*\(/);
});
