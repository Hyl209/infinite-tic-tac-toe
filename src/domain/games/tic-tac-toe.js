(function initTicTacToeEngine(globalScope) {
  'use strict';

  const WIN_LINES = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  const MOVE_PRIORITY = [4, 0, 2, 6, 8, 1, 3, 5, 7];

  function createPosition() {
    return {
      board: Array(9).fill(null),
      moveOrders: { X: [], O: [] },
      moveHistory: [],
    };
  }

  function checkWinner(board) {
    for (const line of WIN_LINES) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return { winner: board[a], line: [...line] };
      }
    }
    return null;
  }

  function getAvailableMoves(boardOrPosition) {
    const board = Array.isArray(boardOrPosition) ? boardOrPosition : boardOrPosition?.board;
    if (!Array.isArray(board)) return [];
    return board.reduce((moves, cell, index) => {
      if (cell === null) moves.push(index);
      return moves;
    }, []);
  }

  function isDraw(board) {
    return !checkWinner(board) && getAvailableMoves(board).length === 0;
  }

  function applyBoardMove(board, index, mark) {
    if (!Array.isArray(board) || board.length !== 9) return null;
    if (!Number.isInteger(index) || index < 0 || index > 8) return null;
    if (mark !== 'X' && mark !== 'O') return null;
    if (board[index] !== null) return null;
    const nextBoard = [...board];
    nextBoard[index] = mark;
    return nextBoard;
  }

  function removeOldestPiece(board, moveOrder) {
    const nextBoard = [...board];
    const nextOrder = [...moveOrder];
    let removedIndex = null;
    if (nextOrder.length > 3) {
      removedIndex = nextOrder.shift();
      nextBoard[removedIndex] = null;
    }
    return { board: nextBoard, moveOrder: nextOrder, removedIndex };
  }

  function applyDynamicMove(position, index, mark) {
    if (!position?.board || !position?.moveOrders) return null;
    const placedBoard = applyBoardMove(position.board, index, mark);
    if (!placedBoard) return null;
    const moveOrders = {
      X: [...position.moveOrders.X],
      O: [...position.moveOrders.O],
    };
    moveOrders[mark].push(index);
    const removal = removeOldestPiece(placedBoard, moveOrders[mark]);
    moveOrders[mark] = removal.moveOrder;
    return {
      board: removal.board,
      moveOrders,
      removedIndex: removal.removedIndex,
    };
  }

  function applyMove(boardOrPosition, index, mark) {
    if (Array.isArray(boardOrPosition)) {
      return applyBoardMove(boardOrPosition, index, mark);
    }
    const next = applyDynamicMove(boardOrPosition, index, mark);
    if (!next) return null;
    return {
      board: next.board,
      moveOrders: next.moveOrders,
      moveHistory: [...(boardOrPosition.moveHistory || []), index],
      removedIndex: next.removedIndex,
    };
  }

  function replayMoves(moveHistory = []) {
    let position = createPosition();
    for (let turn = 0; turn < moveHistory.length; turn += 1) {
      const mark = turn % 2 === 0 ? 'X' : 'O';
      position = applyMove(position, moveHistory[turn], mark);
      if (!position) return null;
    }
    return position;
  }

  function getOutcome(position) {
    const result = checkWinner(position?.board || []);
    if (result) {
      return {
        status: result.winner === 'X' ? 'x_win' : 'o_win',
        winner: result.winner,
        line: result.line,
      };
    }
    if (isDraw(position?.board || [])) {
      return { status: 'draw', winner: null, line: [] };
    }
    return { status: 'playing', winner: null, line: [] };
  }

  function findTacticalMove(position, mark) {
    for (const move of getAvailableMoves(position)) {
      const nextPosition = applyDynamicMove(position, move, mark);
      if (checkWinner(nextPosition.board)?.winner === mark) return move;
    }
    return null;
  }

  function chooseRandomMove(moves, random) {
    if (moves.length === 0) return null;
    return moves[Math.min(Math.floor(random() * moves.length), moves.length - 1)];
  }

  function positionKey(position, maximizing, remainingDepth) {
    const board = position.board.map((cell) => cell || '-').join('');
    return `${board}|${position.moveOrders.X.join('')}|${position.moveOrders.O.join('')}|${maximizing ? 'A' : 'H'}|${remainingDepth}`;
  }

  function evaluatePosition(position, aiMark, humanMark) {
    let score = 0;
    const weights = [0, 1, 7, 40];
    for (const line of WIN_LINES) {
      const marks = line.map((index) => position.board[index]);
      const aiCount = marks.filter((mark) => mark === aiMark).length;
      const humanCount = marks.filter((mark) => mark === humanMark).length;
      if (humanCount === 0) score += weights[aiCount];
      if (aiCount === 0) score -= weights[humanCount];
    }
    if (position.board[4] === aiMark) score += 2;
    if (position.board[4] === humanMark) score -= 2;
    return score;
  }

  function minimax(position, aiMark, humanMark, maximizing, depth, alpha, beta, path, memo) {
    const result = checkWinner(position.board);
    if (result?.winner === aiMark) return 100 - depth;
    if (result?.winner === humanMark) return depth - 100;
    const maxDepth = 8;
    if (depth >= maxDepth) return evaluatePosition(position, aiMark, humanMark);
    const key = positionKey(position, maximizing, maxDepth - depth);
    if (path.has(key)) return 0;
    if (memo.has(key)) return memo.get(key);
    path.add(key);
    const moves = getAvailableMoves(position);
    const orderedMoves = MOVE_PRIORITY.filter((move) => moves.includes(move));
    let bestScore = maximizing ? -Infinity : Infinity;
    for (const move of orderedMoves) {
      const mark = maximizing ? aiMark : humanMark;
      const nextPosition = applyDynamicMove(position, move, mark);
      const score = minimax(
        nextPosition,
        aiMark,
        humanMark,
        !maximizing,
        depth + 1,
        alpha,
        beta,
        path,
        memo,
      );
      if (maximizing) {
        bestScore = Math.max(bestScore, score);
        alpha = Math.max(alpha, bestScore);
      } else {
        bestScore = Math.min(bestScore, score);
        beta = Math.min(beta, bestScore);
      }
      if (beta <= alpha) break;
    }
    path.delete(key);
    memo.set(key, bestScore);
    return bestScore;
  }

  function chooseHardMove(position, aiMark) {
    const humanMark = aiMark === 'X' ? 'O' : 'X';
    const orderedMoves = MOVE_PRIORITY.filter((move) => getAvailableMoves(position).includes(move));
    let bestMove = null;
    let bestScore = -Infinity;
    const memo = new Map();
    for (const move of orderedMoves) {
      const nextPosition = applyDynamicMove(position, move, aiMark);
      if (checkWinner(nextPosition.board)?.winner === aiMark) return move;
      const score = minimax(
        nextPosition,
        aiMark,
        humanMark,
        false,
        1,
        -Infinity,
        Infinity,
        new Set(),
        memo,
      );
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
    return bestMove;
  }

  function chooseAIMove(position, difficulty, aiMark, options = {}) {
    const random = typeof options === 'function' ? options : options.random || Math.random;
    const moves = getAvailableMoves(position);
    if (moves.length === 0 || checkWinner(position.board)) return null;
    if (difficulty === 'easy') return chooseRandomMove(moves, random);
    if (difficulty === 'normal') {
      const winningMove = findTacticalMove(position, aiMark);
      if (winningMove !== null) return winningMove;
      const humanMark = aiMark === 'X' ? 'O' : 'X';
      const blockingMove = findTacticalMove(position, humanMark);
      if (blockingMove !== null) return blockingMove;
      if (random() < 0.7) return MOVE_PRIORITY.find((move) => moves.includes(move));
      return chooseRandomMove(moves, random);
    }
    return chooseHardMove(position, aiMark);
  }

  function startGame({ firstPlayer = 'player', difficulty = 'normal', gameMode = 'ai' } = {}) {
    if (gameMode === 'online') {
      return {
        board: Array(9).fill(null),
        gameMode,
        difficulty,
        playerMark: null,
        aiMark: null,
        currentTurn: null,
        currentMark: 'X',
        status: 'waiting',
        winningLine: [],
        moveOrders: { X: [], O: [] },
      };
    }
    if (gameMode === 'pvp') {
      return {
        board: Array(9).fill(null),
        gameMode,
        difficulty,
        playerMark: null,
        aiMark: null,
        currentTurn: 'player',
        currentMark: 'X',
        status: 'playing',
        winningLine: [],
        moveOrders: { X: [], O: [] },
      };
    }
    const aiStarts = firstPlayer === 'ai';
    return {
      board: Array(9).fill(null),
      gameMode,
      difficulty,
      playerMark: aiStarts ? 'O' : 'X',
      aiMark: aiStarts ? 'X' : 'O',
      currentTurn: aiStarts ? 'ai' : 'player',
      status: 'playing',
      winningLine: [],
      moveOrders: { X: [], O: [] },
    };
  }

  function getNextPvpMark(mark) {
    return mark === 'X' ? 'O' : 'X';
  }

  function getScoreSide(state, winner) {
    if (state.gameMode === 'pvp') return winner === 'X' ? 'left' : 'right';
    return winner === state.playerMark ? 'left' : 'right';
  }

  function getExpiringPieces(moveOrders) {
    return ['X', 'O'].flatMap((mark) => (
      moveOrders[mark].length === 3 ? [{ index: moveOrders[mark][0], mark }] : []
    ));
  }

  const engine = {
    id: 'tic_tac_toe',
    boardSize: 3,
    cellCount: 9,
    WIN_LINES,
    applyDynamicMove,
    applyMove,
    checkWinner,
    chooseAIMove,
    createPosition,
    getAvailableMoves,
    getExpiringPieces,
    getNextPvpMark,
    getOutcome,
    getScoreSide,
    isDraw,
    removeOldestPiece,
    replayMoves,
    startGame,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  globalScope.TicTacToeEngine = engine;
})(typeof window !== 'undefined' ? window : globalThis);
