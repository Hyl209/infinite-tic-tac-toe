const test = require('node:test');
const assert = require('node:assert/strict');

let engine = {};
try {
  engine = require('../../src/domain/games/tic-tac-toe.js');
} catch {
  engine = {};
}

test('井字棋引擎提供统一规则接口', () => {
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
});

test('createPosition 创建带落子历史的 3x3 动态棋盘', () => {
  assert.deepEqual(engine.createPosition(), {
    board: Array(9).fill(null),
    moveOrders: { X: [], O: [] },
    moveHistory: [],
  });
});

test('统一 applyMove 在第四颗同色棋落下后移除最早棋子', () => {
  const position = engine.replayMoves([0, 1, 3, 2, 6, 5]);
  const next = engine.applyMove(position, 4, 'X');

  assert.deepEqual(next.board, [null, 'O', 'O', 'X', 'X', 'O', 'X', null, null]);
  assert.deepEqual(next.moveOrders.X, [3, 6, 4]);
  assert.deepEqual(next.moveHistory, [0, 1, 3, 2, 6, 5, 4]);
  assert.equal(position.board[4], null);
});

test('replayMoves 能稳定重建动态消子局面', () => {
  const history = [0, 1, 3, 2, 6, 5, 4, 7];
  const replayed = engine.replayMoves(history);

  assert.deepEqual(replayed.board, [null, null, 'O', 'X', 'X', 'O', 'X', 'O', null]);
  assert.deepEqual(replayed.moveOrders, { X: [3, 6, 4], O: [2, 5, 7] });
});

test('getOutcome 返回统一的胜负状态', () => {
  const position = engine.replayMoves([0, 3, 1, 4, 2]);
  assert.deepEqual(engine.getOutcome(position, 2), {
    status: 'x_win',
    winner: 'X',
    line: [0, 1, 2],
  });
});
