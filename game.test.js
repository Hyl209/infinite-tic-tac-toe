const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

let engine = {};

try {
  engine = require('./game.js');
} catch {
  engine = {};
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
  const html = fs.readFileSync('./index.html', 'utf8');
  assert.match(html, /name="game-mode"\s+value="ai"/);
  assert.match(html, /name="game-mode"\s+value="pvp"/);
  assert.match(html, /id="ai-difficulty-settings"/);
  assert.match(html, /id="ai-first-settings"/);
  assert.match(html, /id="left-score-name"/);
  assert.match(html, /id="right-score-name"/);
});

test('页面提供线上房间入口和在线操作控件', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  assert.match(html, /name="game-mode"\s+value="online"/);
  assert.match(html, /id="online-room-panel"/);
  assert.match(html, /id="room-code-input"/);
  assert.match(html, /id="create-room-button"/);
  assert.match(html, /id="join-room-button"/);
  assert.match(html, /id="copy-room-button"/);
  assert.match(html, /id="leave-room-button"/);
  assert.match(html, /id="middle-score-name"/);
  assert.match(html, /src="online-config\.js"[^>]*defer/);
  assert.match(html, /src="online\.js"[^>]*defer/);
});

test('房间码输入先接收常见分隔符再由脚本清洗，不能提前截断第六位', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  const inputTag = html.match(/<input[\s\S]*?id="room-code-input"[\s\S]*?>/)?.[0] || '';
  assert.match(inputTag, /maxlength="12"/);
});

test('页面控制器通过 OnlineGame 客户端提交线上操作而不是本地落子', () => {
  const source = fs.readFileSync('./game.js', 'utf8');
  assert.match(source, /createOnlineClient\(\{/);
  assert.match(source, /onlineApi\?\.canOnlineMove/);
  assert.match(source, /onlineClient\.makeMove/);
  assert.match(source, /onlineClient\.requestRematch/);
  assert.match(source, /onlineClient\.leaveRoom/);
  assert.match(source, /restartButton\.hidden\s*=\s*isOnline\s*&&\s*!hasOnlineRoom/);
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
  const css = fs.readFileSync('./style.css', 'utf8');
  const boardBlock = css.match(/(?:^|\n)\.board\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(
    boardBlock,
    /grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  );
});

test('线上房间控件在窄屏下使用可收缩网格避免横向溢出', () => {
  const css = fs.readFileSync('./style.css', 'utf8');
  const joinBlock = css.match(/\.room-join-row\s*\{([^}]*)\}/)?.[1] || '';
  const inputBlock = css.match(/#room-code-input\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(joinBlock, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
  assert.match(inputBlock, /min-width:\s*0/);
});

test('线上会话区的网格样式不能覆盖 hidden 属性', () => {
  const css = fs.readFileSync('./style.css', 'utf8');
  assert.match(
    css,
    /\.online-room-session\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s,
  );
});

test('落子、胜利和按压反馈不能缩放格子容器', () => {
  const css = fs.readFileSync('./style.css', 'utf8');
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
  const source = fs.readFileSync('./game.js', 'utf8');
  const css = fs.readFileSync('./style.css', 'utf8');
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
  const css = fs.readFileSync('./style.css', 'utf8');
  const start = css.indexOf('@keyframes place-mark');
  const end = css.indexOf('@keyframes winner-pop');
  const placeMarkKeyframes = css.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(placeMarkKeyframes, /opacity\s*:/);
  assert.match(placeMarkKeyframes, /transform:\s*scale\(0\.[89]/);
});
