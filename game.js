(function initTicTacToe(globalScope) {
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

  function checkWinner(board) {
    for (const line of WIN_LINES) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return { winner: board[a], line: [...line] };
      }
    }

    return null;
  }

  function getAvailableMoves(board) {
    return board.reduce((moves, cell, index) => {
      if (cell === null) moves.push(index);
      return moves;
    }, []);
  }

  function isDraw(board) {
    return !checkWinner(board) && getAvailableMoves(board).length === 0;
  }

  function applyMove(board, index, mark) {
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

    return {
      board: nextBoard,
      moveOrder: nextOrder,
      removedIndex,
    };
  }

  function applyDynamicMove(position, index, mark) {
    if (!position?.board || !position?.moveOrders) return null;

    const placedBoard = applyMove(position.board, index, mark);
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

  function findTacticalMove(position, mark) {
    for (const move of getAvailableMoves(position.board)) {
      const nextPosition = applyDynamicMove(position, move, mark);
      const result = checkWinner(nextPosition.board);
      if (result?.winner === mark) return move;
    }
    return null;
  }

  function chooseRandomMove(moves, random) {
    if (moves.length === 0) return null;
    const index = Math.min(Math.floor(random() * moves.length), moves.length - 1);
    return moves[index];
  }

  function positionKey(position, maximizing, remainingDepth) {
    const board = position.board.map((cell) => cell || '-').join('');
    const xOrder = position.moveOrders.X.join('');
    const oOrder = position.moveOrders.O.join('');
    return `${board}|${xOrder}|${oOrder}|${maximizing ? 'A' : 'H'}|${remainingDepth}`;
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

  function minimax(
    position,
    aiMark,
    humanMark,
    maximizing,
    depth,
    alpha,
    beta,
    path,
    memo,
  ) {
    const result = checkWinner(position.board);
    if (result?.winner === aiMark) return 100 - depth;
    if (result?.winner === humanMark) return depth - 100;

    const maxDepth = 8;
    if (depth >= maxDepth) {
      return evaluatePosition(position, aiMark, humanMark);
    }

    const remainingDepth = maxDepth - depth;
    const key = positionKey(position, maximizing, remainingDepth);
    if (path.has(key)) return 0;
    if (memo.has(key)) return memo.get(key);

    path.add(key);
    const moves = getAvailableMoves(position.board);
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
    const available = getAvailableMoves(position.board);
    const orderedMoves = MOVE_PRIORITY.filter((move) => available.includes(move));
    let bestMove = null;
    let bestScore = -Infinity;
    const memo = new Map();

    for (const move of orderedMoves) {
      const nextPosition = applyDynamicMove(position, move, aiMark);
      const immediateResult = checkWinner(nextPosition.board);
      if (immediateResult?.winner === aiMark) return move;

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

  function chooseAIMove(position, difficulty, aiMark, random = Math.random) {
    const moves = getAvailableMoves(position.board);
    if (moves.length === 0 || checkWinner(position.board)) return null;

    if (difficulty === 'easy') {
      return chooseRandomMove(moves, random);
    }

    if (difficulty === 'normal') {
      const winningMove = findTacticalMove(position, aiMark);
      if (winningMove !== null) return winningMove;

      const humanMark = aiMark === 'X' ? 'O' : 'X';
      const blockingMove = findTacticalMove(position, humanMark);
      if (blockingMove !== null) return blockingMove;

      if (random() < 0.7) {
        return MOVE_PRIORITY.find((move) => moves.includes(move));
      }
      return chooseRandomMove(moves, random);
    }

    return chooseHardMove(position, aiMark);
  }

  function startGame({
    firstPlayer = 'player',
    difficulty = 'normal',
    gameMode = 'ai',
  } = {}) {
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
    if (state.gameMode === 'pvp') {
      return winner === 'X' ? 'left' : 'right';
    }
    return winner === state.playerMark ? 'left' : 'right';
  }

  function getExpiringPieces(moveOrders) {
    return ['X', 'O'].flatMap((mark) => (
      moveOrders[mark].length === 3
        ? [{ index: moveOrders[mark][0], mark }]
        : []
    ));
  }

  const engine = {
    WIN_LINES,
    applyDynamicMove,
    applyMove,
    checkWinner,
    chooseAIMove,
    getAvailableMoves,
    getExpiringPieces,
    getNextPvpMark,
    getScoreSide,
    isDraw,
    removeOldestPiece,
    startGame,
  };

  function mountGame() {
    const boardElement = document.querySelector('#board');
    if (!boardElement) return;

    const cells = [...document.querySelectorAll('.cell')];
    const statusCard = document.querySelector('.status-card');
    const statusText = document.querySelector('#status-text');
    const markInfo = document.querySelector('#mark-info');
    const difficultyLabel = document.querySelector('#difficulty-label');
    const gamePanel = document.querySelector('.game-panel');
    const aiDifficultySettings = document.querySelector('#ai-difficulty-settings');
    const aiFirstSettings = document.querySelector('#ai-first-settings');
    const leftScoreName = document.querySelector('#left-score-name');
    const rightScoreName = document.querySelector('#right-score-name');
    const scoreElements = {
      left: document.querySelector('#player-score'),
      draw: document.querySelector('#draw-score'),
      right: document.querySelector('#ai-score'),
    };

    const scores = { left: 0, draw: 0, right: 0 };
    const difficultyNames = {
      easy: '简单模式',
      normal: '普通模式',
      hard: '困难模式',
    };

    let state;
    let aiTimer = null;
    let roundToken = 0;
    let lastMove = null;

    function selectedValue(name) {
      return document.querySelector(`input[name="${name}"]:checked`).value;
    }

    function renderScores() {
      scoreElements.left.textContent = scores.left;
      scoreElements.draw.textContent = scores.draw;
      scoreElements.right.textContent = scores.right;
    }

    function statusMessage() {
      if (state.gameMode === 'pvp') {
        if (state.status === 'x-win') return 'X 获胜！漂亮的一局';
        if (state.status === 'o-win') return 'O 获胜！漂亮的一局';
        if (state.status === 'draw') return '平局，棋逢对手';
        return `轮到 ${state.currentMark} 落子`;
      }

      if (state.status === 'player-win') return '你赢了！漂亮的一局';
      if (state.status === 'ai-win') return 'AI 获胜，再试一次';
      if (state.status === 'draw') return '平局，棋逢对手';
      if (state.currentTurn === 'ai') return 'AI 正在思考';
      return `轮到你，你是 ${state.playerMark}`;
    }

    function render() {
      const isPvp = state.gameMode === 'pvp';
      const aiThinking = !isPvp
        && state.status === 'playing'
        && state.currentTurn === 'ai';
      const expiringPieces = getExpiringPieces(state.moveOrders);
      const expiringByIndex = new Map(
        expiringPieces.map((piece) => [piece.index, piece.mark]),
      );
      statusText.textContent = statusMessage();
      markInfo.textContent = isPvp
        ? 'X 与 O 轮流落子，X 固定先手'
        : `你执 ${state.playerMark}，AI 执 ${state.aiMark}`;
      statusCard.dataset.result = state.status;
      difficultyLabel.textContent = isPvp
        ? '双人模式'
        : difficultyNames[state.difficulty];
      aiDifficultySettings.hidden = isPvp;
      aiFirstSettings.hidden = isPvp;
      leftScoreName.textContent = isPvp ? 'X' : '玩家';
      rightScoreName.textContent = isPvp ? 'O' : 'AI';
      gamePanel.classList.toggle('is-thinking', aiThinking);
      boardElement.setAttribute('aria-busy', String(aiThinking));

      cells.forEach((cell, index) => {
        const mark = state.board[index];
        const canMove = state.status === 'playing'
          && (isPvp || state.currentTurn === 'player')
          && mark === null;

        cell.textContent = '';
        cell.dataset.mark = mark || '';
        cell.classList.toggle('mark-x', mark === 'X');
        cell.classList.toggle('mark-o', mark === 'O');
        cell.classList.toggle('just-played', lastMove === index);
        cell.classList.toggle('winner', state.winningLine.includes(index));
        cell.classList.toggle('next-to-remove', expiringByIndex.has(index));
        cell.dataset.expiringMark = expiringByIndex.get(index) || '';
        cell.style.setProperty(
          '--win-order',
          Math.max(0, state.winningLine.indexOf(index)),
        );
        cell.disabled = aiThinking || state.status !== 'playing';
        cell.setAttribute('aria-disabled', String(!canMove));
        const expiryHint = expiringByIndex.has(index)
          ? `，${expiringByIndex.get(index)} 下次落子时将被消除`
          : '';
        cell.setAttribute('aria-label', `第 ${index + 1} 格，${mark || '空'}${expiryHint}`);
      });

      renderScores();
    }

    function finishRound() {
      const result = checkWinner(state.board);
      if (result) {
        state.winningLine = result.line;
        const scoreSide = getScoreSide(state, result.winner);
        scores[scoreSide] += 1;

        if (state.gameMode === 'pvp') {
          state.status = result.winner === 'X' ? 'x-win' : 'o-win';
        } else if (result.winner === state.playerMark) {
          state.status = 'player-win';
        } else {
          state.status = 'ai-win';
        }
        state.currentTurn = null;
        render();
        return true;
      }

      if (isDraw(state.board)) {
        state.status = 'draw';
        state.currentTurn = null;
        scores.draw += 1;
        render();
        return true;
      }

      return false;
    }

    function scheduleAI() {
      state.currentTurn = 'ai';
      render();

      const token = roundToken;
      aiTimer = setTimeout(() => {
        if (token !== roundToken || state.status !== 'playing') return;

        const move = chooseAIMove(state, state.difficulty, state.aiMark);
        if (move === null) return;

        const nextPosition = applyDynamicMove(state, move, state.aiMark);
        state.board = nextPosition.board;
        state.moveOrders = nextPosition.moveOrders;
        lastMove = move;

        if (!finishRound()) {
          state.currentTurn = 'player';
          render();
        }
      }, 300);
    }

    function newRound({ clearScores = false } = {}) {
      if (aiTimer !== null) clearTimeout(aiTimer);
      roundToken += 1;
      lastMove = null;

      if (clearScores) {
        scores.left = 0;
        scores.draw = 0;
        scores.right = 0;
      }

      state = startGame({
        firstPlayer: selectedValue('first-player'),
        difficulty: selectedValue('difficulty'),
        gameMode: selectedValue('game-mode'),
      });
      render();

      if (state.gameMode === 'ai' && state.currentTurn === 'ai') scheduleAI();
    }

    function handlePlayerMove(index) {
      if (state.status !== 'playing' || state.currentTurn !== 'player') return;

      const mark = state.gameMode === 'pvp'
        ? state.currentMark
        : state.playerMark;
      const nextPosition = applyDynamicMove(state, index, mark);
      if (!nextPosition) return;

      state.board = nextPosition.board;
      state.moveOrders = nextPosition.moveOrders;
      lastMove = index;

      if (finishRound()) return;

      if (state.gameMode === 'pvp') {
        state.currentMark = getNextPvpMark(state.currentMark);
        render();
      } else {
        scheduleAI();
      }
    }

    cells.forEach((cell) => {
      cell.addEventListener('click', () => {
        handlePlayerMove(Number(cell.dataset.index));
      });
    });

    boardElement.addEventListener('keydown', (event) => {
      const current = Number(document.activeElement?.dataset?.index);
      if (!Number.isInteger(current)) return;

      const row = Math.floor(current / 3);
      const column = current % 3;
      let next = current;

      if (event.key === 'ArrowLeft' && column > 0) next -= 1;
      if (event.key === 'ArrowRight' && column < 2) next += 1;
      if (event.key === 'ArrowUp' && row > 0) next -= 3;
      if (event.key === 'ArrowDown' && row < 2) next += 3;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = 8;

      if (next !== current) {
        event.preventDefault();
        cells[next].focus();
      }
    });

    document.querySelectorAll('input[name="difficulty"], input[name="first-player"]')
      .forEach((input) => input.addEventListener('change', () => newRound()));

    document.querySelectorAll('input[name="game-mode"]')
      .forEach((input) => input.addEventListener('change', () => {
        newRound({ clearScores: true });
      }));

    document.querySelector('#restart-button').addEventListener('click', () => newRound());
    document.querySelector('#clear-score-button').addEventListener('click', () => {
      newRound({ clearScores: true });
    });

    newRound();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = engine;
  }

  globalScope.TicTacToeEngine = engine;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountGame, { once: true });
    } else {
      mountGame();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
