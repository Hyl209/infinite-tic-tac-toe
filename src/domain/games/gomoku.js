(function initGomokuEngine(globalScope) {
  'use strict';

  const BOARD_SIZE = 15;
  const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
  const CENTER = Math.floor(CELL_COUNT / 2);
  const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const WIN_SCORE = 1_000_000_000;

  function createPosition() {
    return { board: Array(CELL_COUNT).fill(null), moveHistory: [] };
  }

  function getAvailableMoves(boardOrPosition) {
    const board = Array.isArray(boardOrPosition) ? boardOrPosition : boardOrPosition?.board;
    if (!Array.isArray(board)) return [];
    return board.reduce((moves, cell, index) => {
      if (cell === null) moves.push(index);
      return moves;
    }, []);
  }

  function applyMove(position, index, mark) {
    if (!position?.board || position.board.length !== CELL_COUNT) return null;
    if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) return null;
    if (mark !== 'X' && mark !== 'O') return null;
    if (position.board[index] !== null) return null;
    const board = [...position.board];
    board[index] = mark;
    return {
      board,
      moveHistory: [...(position.moveHistory || []), index],
    };
  }

  function replayMoves(moveHistory = []) {
    let position = createPosition();
    for (let turn = 0; turn < moveHistory.length; turn += 1) {
      position = applyMove(position, moveHistory[turn], turn % 2 === 0 ? 'X' : 'O');
      if (!position) return null;
    }
    return position;
  }

  function inBounds(row, column) {
    return row >= 0 && row < BOARD_SIZE && column >= 0 && column < BOARD_SIZE;
  }

  function collectLine(board, index, mark, rowStep, columnStep) {
    const row = Math.floor(index / BOARD_SIZE);
    const column = index % BOARD_SIZE;
    const before = [];
    const after = [];
    let nextRow = row - rowStep;
    let nextColumn = column - columnStep;
    while (inBounds(nextRow, nextColumn)) {
      const nextIndex = nextRow * BOARD_SIZE + nextColumn;
      if (board[nextIndex] !== mark) break;
      before.unshift(nextIndex);
      nextRow -= rowStep;
      nextColumn -= columnStep;
    }
    nextRow = row + rowStep;
    nextColumn = column + columnStep;
    while (inBounds(nextRow, nextColumn)) {
      const nextIndex = nextRow * BOARD_SIZE + nextColumn;
      if (board[nextIndex] !== mark) break;
      after.push(nextIndex);
      nextRow += rowStep;
      nextColumn += columnStep;
    }
    return [...before, index, ...after];
  }

  function getOutcome(position, lastMove = position?.moveHistory?.at(-1)) {
    const board = position?.board || [];
    const mark = Number.isInteger(lastMove) ? board[lastMove] : null;
    if (mark) {
      for (const [rowStep, columnStep] of DIRECTIONS) {
        const line = collectLine(board, lastMove, mark, rowStep, columnStep);
        if (line.length >= 5) {
          return {
            status: mark === 'X' ? 'x_win' : 'o_win',
            winner: mark,
            line,
          };
        }
      }
    }
    if (board.length === CELL_COUNT && !board.includes(null)) {
      return { status: 'draw', winner: null, line: [] };
    }
    return { status: 'playing', winner: null, line: [] };
  }

  function getCandidateMoves(board, radius = 2) {
    const occupied = [];
    board.forEach((mark, index) => {
      if (mark) occupied.push(index);
    });
    if (occupied.length === 0) return [CENTER];
    const candidates = new Set();
    for (const occupiedIndex of occupied) {
      const row = Math.floor(occupiedIndex / BOARD_SIZE);
      const column = occupiedIndex % BOARD_SIZE;
      for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
        for (let columnOffset = -radius; columnOffset <= radius; columnOffset += 1) {
          const nextRow = row + rowOffset;
          const nextColumn = column + columnOffset;
          if (!inBounds(nextRow, nextColumn)) continue;
          const nextIndex = nextRow * BOARD_SIZE + nextColumn;
          if (board[nextIndex] === null) candidates.add(nextIndex);
        }
      }
    }
    return [...candidates].sort((a, b) => {
      const aRow = Math.floor(a / BOARD_SIZE);
      const aColumn = a % BOARD_SIZE;
      const bRow = Math.floor(b / BOARD_SIZE);
      const bColumn = b % BOARD_SIZE;
      const aDistance = Math.abs(aRow - 7) + Math.abs(aColumn - 7);
      const bDistance = Math.abs(bRow - 7) + Math.abs(bColumn - 7);
      return aDistance - bDistance || a - b;
    });
  }

  function lineShape(board, index, mark, rowStep, columnStep) {
    const row = Math.floor(index / BOARD_SIZE);
    const column = index % BOARD_SIZE;
    let count = 1;
    let openEnds = 0;
    for (const direction of [-1, 1]) {
      let nextRow = row + rowStep * direction;
      let nextColumn = column + columnStep * direction;
      while (inBounds(nextRow, nextColumn)) {
        const cell = board[nextRow * BOARD_SIZE + nextColumn];
        if (cell === mark) {
          count += 1;
          nextRow += rowStep * direction;
          nextColumn += columnStep * direction;
          continue;
        }
        if (cell === null) openEnds += 1;
        break;
      }
    }
    return { count, openEnds };
  }

  function shapeScore(count, openEnds) {
    if (count >= 5) return WIN_SCORE;
    if (count === 4 && openEnds === 2) return 10_000_000;
    if (count === 4 && openEnds === 1) return 1_000_000;
    if (count === 3 && openEnds === 2) return 160_000;
    if (count === 3 && openEnds === 1) return 18_000;
    if (count === 2 && openEnds === 2) return 3_200;
    if (count === 2 && openEnds === 1) return 320;
    return openEnds * 12 + count;
  }

  function scoreMove(board, index, mark) {
    if (board[index] !== null) return -Infinity;
    const opponent = mark === 'X' ? 'O' : 'X';
    board[index] = mark;
    let attack = 0;
    for (const [rowStep, columnStep] of DIRECTIONS) {
      const shape = lineShape(board, index, mark, rowStep, columnStep);
      attack += shapeScore(shape.count, shape.openEnds);
    }
    board[index] = opponent;
    let defense = 0;
    for (const [rowStep, columnStep] of DIRECTIONS) {
      const shape = lineShape(board, index, opponent, rowStep, columnStep);
      defense += shapeScore(shape.count, shape.openEnds);
    }
    board[index] = null;
    const row = Math.floor(index / BOARD_SIZE);
    const column = index % BOARD_SIZE;
    return attack + defense * 0.92 - (Math.abs(row - 7) + Math.abs(column - 7)) * 0.2;
  }

  function findImmediateMove(board, mark, candidates) {
    for (const move of candidates) {
      board[move] = mark;
      const outcome = getOutcome({ board, moveHistory: [move] }, move);
      board[move] = null;
      if (outcome.winner === mark) return move;
    }
    return null;
  }

  function orderedMoves(board, mark, limit = 14) {
    return getCandidateMoves(board)
      .map((move) => ({ move, score: scoreMove(board, move, mark) }))
      .sort((a, b) => b.score - a.score || a.move - b.move)
      .slice(0, limit)
      .map((item) => item.move);
  }

  function chooseNormalMove(position, aiMark, random) {
    const board = [...position.board];
    const candidates = getCandidateMoves(board);
    const winningMove = findImmediateMove(board, aiMark, candidates);
    if (winningMove !== null) return winningMove;
    const humanMark = aiMark === 'X' ? 'O' : 'X';
    const blockingMove = findImmediateMove(board, humanMark, candidates);
    if (blockingMove !== null) return blockingMove;
    const ranked = candidates
      .map((move) => ({ move, score: scoreMove(board, move, aiMark) }))
      .sort((a, b) => b.score - a.score || a.move - b.move);
    if (ranked.length === 0) return null;
    const threshold = ranked[0].score * 0.94;
    const nearBest = ranked.filter((item) => item.score >= threshold).slice(0, 4);
    return nearBest[Math.min(Math.floor(random() * nearBest.length), nearBest.length - 1)].move;
  }

  function evaluateBoard(board, aiMark) {
    const humanMark = aiMark === 'X' ? 'O' : 'X';
    const aiMoves = orderedMoves(board, aiMark, 5);
    const humanMoves = orderedMoves(board, humanMark, 5);
    const aiScore = aiMoves.reduce((score, move) => score + scoreMove(board, move, aiMark), 0);
    const humanScore = humanMoves.reduce((score, move) => score + scoreMove(board, move, humanMark), 0);
    return aiScore - humanScore;
  }

  function search(board, currentMark, aiMark, depth, alpha, beta, lastMove, deadline, memo) {
    if (Date.now() >= deadline) throw new Error('SEARCH_TIMEOUT');
    const outcome = getOutcome({ board, moveHistory: [lastMove] }, lastMove);
    if (outcome.winner) return outcome.winner === aiMark ? WIN_SCORE + depth : -WIN_SCORE - depth;
    if (outcome.status === 'draw') return 0;
    if (depth === 0) return evaluateBoard(board, aiMark);
    const key = `${board.map((cell) => cell || '-').join('')}|${currentMark}|${depth}`;
    if (memo.has(key)) return memo.get(key);
    const maximizing = currentMark === aiMark;
    let best = maximizing ? -Infinity : Infinity;
    const moves = orderedMoves(board, currentMark, depth >= 3 ? 10 : 12);
    for (const move of moves) {
      board[move] = currentMark;
      const score = search(
        board,
        currentMark === 'X' ? 'O' : 'X',
        aiMark,
        depth - 1,
        alpha,
        beta,
        move,
        deadline,
        memo,
      );
      board[move] = null;
      if (maximizing) {
        best = Math.max(best, score);
        alpha = Math.max(alpha, best);
      } else {
        best = Math.min(best, score);
        beta = Math.min(beta, best);
      }
      if (beta <= alpha) break;
    }
    memo.set(key, best);
    return best;
  }

  function chooseHardMove(position, aiMark, timeLimitMs) {
    const board = [...position.board];
    const candidates = getCandidateMoves(board);
    const winningMove = findImmediateMove(board, aiMark, candidates);
    if (winningMove !== null) return winningMove;
    const humanMark = aiMark === 'X' ? 'O' : 'X';
    const blockingMove = findImmediateMove(board, humanMark, candidates);
    if (blockingMove !== null) return blockingMove;
    const deadline = Date.now() + Math.max(10, timeLimitMs);
    let bestMove = chooseNormalMove(position, aiMark, () => 0);
    for (let depth = 1; depth <= 4; depth += 1) {
      let depthBestMove = bestMove;
      let depthBestScore = -Infinity;
      try {
        const moves = orderedMoves(board, aiMark, 12);
        const memo = new Map();
        for (const move of moves) {
          if (Date.now() >= deadline) throw new Error('SEARCH_TIMEOUT');
          board[move] = aiMark;
          const score = search(
            board,
            humanMark,
            aiMark,
            depth - 1,
            -Infinity,
            Infinity,
            move,
            deadline,
            memo,
          );
          board[move] = null;
          if (score > depthBestScore) {
            depthBestScore = score;
            depthBestMove = move;
          }
        }
        bestMove = depthBestMove;
      } catch (error) {
        if (error.message !== 'SEARCH_TIMEOUT') throw error;
        break;
      }
    }
    return bestMove;
  }

  function chooseAIMove(position, difficulty, aiMark, options = {}) {
    const random = options.random || Math.random;
    const available = getAvailableMoves(position);
    if (available.length === 0 || getOutcome(position).status !== 'playing') return null;
    if (position.board.every((cell) => cell === null)) return CENTER;
    if (difficulty === 'easy') {
      const candidates = getCandidateMoves(position.board);
      return candidates[Math.min(Math.floor(random() * candidates.length), candidates.length - 1)];
    }
    if (difficulty === 'normal') return chooseNormalMove(position, aiMark, random);
    return chooseHardMove(position, aiMark, options.timeLimitMs || 1200);
  }

  const engine = {
    id: 'gomoku',
    boardSize: BOARD_SIZE,
    cellCount: CELL_COUNT,
    applyMove,
    chooseAIMove,
    createPosition,
    getAvailableMoves,
    getCandidateMoves,
    getOutcome,
    replayMoves,
    scoreMove,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  globalScope.GomokuEngine = engine;
})(typeof window !== 'undefined' ? window : globalThis);
