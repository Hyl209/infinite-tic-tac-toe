const test = require('node:test');
const assert = require('node:assert/strict');

let engine = {};
try {
  engine = require('./gomoku.js');
} catch {
  engine = {};
}

const index = (row, column) => row * 15 + column;

test('五子棋引擎提供统一规则接口和 15x15 空棋盘', () => {
  for (const name of [
    'createPosition',
    'applyMove',
    'replayMoves',
    'getOutcome',
    'getAvailableMoves',
    'chooseAIMove',
  ]) {
    assert.equal(typeof engine[name], 'function', `${name} should be exported`);
  }

  assert.deepEqual(engine.createPosition(), {
    board: Array(225).fill(null),
    moveHistory: [],
  });
});

test('applyMove 拒绝越界、占用和非法棋子且不修改原局面', () => {
  const position = engine.createPosition();
  const next = engine.applyMove(position, index(7, 7), 'X');

  assert.equal(next.board[index(7, 7)], 'X');
  assert.deepEqual(next.moveHistory, [index(7, 7)]);
  assert.equal(position.board[index(7, 7)], null);
  assert.equal(engine.applyMove(next, index(7, 7), 'O'), null);
  assert.equal(engine.applyMove(next, 225, 'O'), null);
  assert.equal(engine.applyMove(next, index(7, 8), 'A'), null);
});

test('replayMoves 按 X 先手稳定重建棋盘', () => {
  const moves = [index(7, 7), index(7, 8), index(8, 7)];
  const position = engine.replayMoves(moves);

  assert.equal(position.board[index(7, 7)], 'X');
  assert.equal(position.board[index(7, 8)], 'O');
  assert.equal(position.board[index(8, 7)], 'X');
  assert.deepEqual(position.moveHistory, moves);
});

test('getOutcome 识别横、竖和两条斜线的五连', () => {
  const lines = [
    [index(2, 3), index(2, 4), index(2, 5), index(2, 6), index(2, 7)],
    [index(3, 11), index(4, 11), index(5, 11), index(6, 11), index(7, 11)],
    [index(5, 2), index(6, 3), index(7, 4), index(8, 5), index(9, 6)],
    [index(4, 10), index(5, 9), index(6, 8), index(7, 7), index(8, 6)],
  ];

  for (const line of lines) {
    const board = Array(225).fill(null);
    line.forEach((cell) => { board[cell] = 'O'; });
    assert.deepEqual(engine.getOutcome({ board, moveHistory: line }, line[2]), {
      status: 'o_win',
      winner: 'O',
      line,
    });
  }
});

test('长连获胜并高亮整段，断开的棋子不算胜利', () => {
  const longLine = Array.from({ length: 6 }, (_, offset) => index(10, 4 + offset));
  const board = Array(225).fill(null);
  longLine.forEach((cell) => { board[cell] = 'X'; });

  assert.deepEqual(engine.getOutcome({ board, moveHistory: longLine }, longLine[3]), {
    status: 'x_win',
    winner: 'X',
    line: longLine,
  });

  board[longLine[2]] = null;
  assert.equal(engine.getOutcome({ board, moveHistory: longLine }, longLine[3]).status, 'playing');
});

test('满盘且最后落点未形成五连时返回平局', () => {
  const board = Array.from({ length: 225 }, (_, cell) => {
    const row = Math.floor(cell / 15);
    const column = cell % 15;
    return (row + Math.floor(column / 2)) % 2 === 0 ? 'X' : 'O';
  });
  const lastMove = index(14, 14);
  const outcome = engine.getOutcome({ board, moveHistory: [lastMove] }, lastMove);
  assert.equal(outcome.status, 'draw');
  assert.equal(outcome.winner, null);
});

test('简单档空盘落中心，其后只选择已有棋子附近空位', () => {
  const empty = engine.createPosition();
  assert.equal(engine.chooseAIMove(empty, 'easy', 'X', { random: () => 0.8 }), index(7, 7));

  const position = engine.applyMove(empty, index(7, 7), 'X');
  const move = engine.chooseAIMove(position, 'easy', 'O', { random: () => 0 });
  const rowDistance = Math.abs(Math.floor(move / 15) - 7);
  const columnDistance = Math.abs((move % 15) - 7);
  assert.ok(rowDistance <= 2 && columnDistance <= 2);
});

test('普通档优先立即取胜并阻止对方立即获胜', () => {
  const winningBoard = Array(225).fill(null);
  [3, 4, 5, 6].forEach((column) => { winningBoard[index(7, column)] = 'O'; });
  assert.ok([index(7, 2), index(7, 7)].includes(
    engine.chooseAIMove({ board: winningBoard, moveHistory: [] }, 'normal', 'O', { random: () => 0 }),
  ));

  const blockingBoard = Array(225).fill(null);
  [3, 4, 5, 6].forEach((column) => { blockingBoard[index(8, column)] = 'X'; });
  assert.ok([index(8, 2), index(8, 7)].includes(
    engine.chooseAIMove({ board: blockingBoard, moveHistory: [] }, 'normal', 'O', { random: () => 0 }),
  ));
});

test('困难档在时间预算内仍会选择立即胜利', () => {
  const board = Array(225).fill(null);
  [4, 5, 6, 7].forEach((column) => { board[index(9, column)] = 'X'; });
  const move = engine.chooseAIMove(
    { board, moveHistory: [] },
    'hard',
    'X',
    { random: () => 0, timeLimitMs: 50 },
  );
  assert.ok([index(9, 3), index(9, 8)].includes(move));
});
