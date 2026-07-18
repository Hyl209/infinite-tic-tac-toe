(function initGameApp(globalScope) {
  'use strict';

  const GAME_TYPES = ['tic_tac_toe', 'gomoku'];
  const PLACEMENT_STORAGE_KEY = 'gomoku-placement-mode';
  const DIFFICULTY_NAMES = {
    easy: '简单模式',
    normal: '普通模式',
    hard: '困难模式',
  };
  const GAME_COPY = {
    tic_tac_toe: {
      title: '无限井字棋',
      description: '每方只保留 3 颗棋子，旧棋会随新的落子消失。',
      arena: '动态棋盘',
      note: '高亮棋子会在该方下次落子时消失',
    },
    gomoku: {
      title: '五子棋',
      description: '15×15 棋盘，黑方先手，连续五颗或更多即获胜。',
      arena: '15×15 棋盘',
      note: '触屏可使用点两次确认，红点标记最后一手',
    },
  };

  const ROUTE_ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function normalizeRouteRoomCode(value) {
    return String(value || '')
      .toUpperCase()
      .split('')
      .filter((character) => ROUTE_ROOM_ALPHABET.includes(character))
      .join('')
      .slice(0, 6);
  }

  function normalizeRoomCodeInput(value, isComposing = false) {
    if (isComposing) return String(value || '');
    return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  }

  function getGameEntryTarget({ roomCode, joined } = {}) {
    return roomCode && !joined ? 'online-room-panel' : 'board';
  }

  function shouldDismissGameDialogAction(action) {
    return action === 'close';
  }

  function shouldUpdateGameDialogContent(current, next) {
    if (!current || !next) return current !== next;
    return current.title !== next.title
      || current.message !== next.message
      || current.dismissible !== next.dismissible
      || JSON.stringify(current.actions) !== JSON.stringify(next.actions);
  }

  function detectRematchRejection(previousGame, nextGame) {
    const finishedStatuses = ['x_win', 'o_win', 'draw'];
    const playerMark = previousGame?.playerMark;
    return Boolean(
      previousGame
      && nextGame
      && previousGame.round === nextGame.round
      && finishedStatuses.includes(previousGame.status)
      && finishedStatuses.includes(nextGame.status)
      && playerMark
      && nextGame.playerMark === playerMark
      && previousGame.rematchReady?.[playerMark]
      && !nextGame.rematchReady?.[playerMark],
    );
  }

  function getGameDialogState({
    state,
    onlineGame = null,
    resultMessage = '',
    roundKey = '',
    rematchRejected = null,
    actionError = '',
  } = {}) {
    if (!state) return null;
    const isOnline = state.gameMode === 'online';
    const request = onlineGame?.undoRequest;
    const activeRequest = request?.requesterMark
      && request?.expiresAt
      && Date.parse(request.expiresAt) > Date.now();

    if (isOnline && activeRequest) {
      if (request.requesterMark === onlineGame.playerMark) return null;
      const requesterName = onlineGame.playerNames?.[request.requesterMark] || '对方';
      return {
        key: `undo:${onlineGame.round || 0}:${request.expiresAt}:${state.status}`,
        title: '悔棋请求',
        message: actionError || `${requesterName}申请撤回最近一手`,
        actions: [
          { action: 'accept-undo', label: '同意' },
          { action: 'reject-undo', label: '拒绝' },
        ],
        dismissible: false,
      };
    }

    const finished = ['x_win', 'o_win', 'draw'].includes(state.status);
    if (!finished) return null;

    if (isOnline && rematchRejected) {
      return {
        key: `rematch-rejected:${rematchRejected.round ?? 0}:${rematchRejected.version ?? 0}:${state.status}`,
        title: '再来一局',
        message: '对方已拒绝再来一局',
        actions: [{ action: 'close', label: '关闭' }],
        dismissible: true,
      };
    }

    if (isOnline && onlineGame?.playerMark) {
      const opponentMark = onlineGame.playerMark === 'X' ? 'O' : 'X';
      const ownReady = Boolean(onlineGame.rematchReady?.[onlineGame.playerMark]);
      const opponentReady = Boolean(onlineGame.rematchReady?.[opponentMark]);
      if (opponentReady && !ownReady) {
        const opponentName = onlineGame.playerNames?.[opponentMark] || '对方';
        return {
          key: `rematch:${onlineGame.round || 0}:${onlineGame.version ?? 0}:${state.status}`,
          title: '再来一局',
          message: actionError || `${opponentName}申请再来一局`,
          actions: [
            { action: 'accept-rematch', label: '同意' },
            { action: 'reject-rematch', label: '拒绝' },
          ],
          dismissible: false,
        };
      }
      if (ownReady) return null;
    }

    return {
      key: `result:${roundKey}:${state.status}`,
      title: '本局结束',
      message: isOnline && actionError ? actionError : resultMessage,
      actions: [
        { action: 'restart', label: '再来一局' },
        { action: 'close', label: '关闭' },
      ],
      dismissible: true,
    };
  }

  function resolveAppRoute(urlLike) {
    const url = new URL(urlLike, 'https://hyl.space/');
    const roomCandidate = normalizeRouteRoomCode(url.searchParams.get('room'));
    const roomCode = roomCandidate.length === 6 ? roomCandidate : null;
    const requestedGame = url.searchParams.get('game');
    const gameType = GAME_TYPES.includes(requestedGame)
      ? requestedGame
      : (roomCode ? 'tic_tac_toe' : null);

    if (gameType) return { view: 'game', gameType, roomCode };
    if (url.searchParams.get('view') === 'admin') {
      return { view: 'admin', gameType: null, roomCode: null };
    }
    return { view: 'games', gameType: null, roomCode: null };
  }

  function buildAppUrl(currentUrl, { view, gameType = null, roomCode = null } = {}) {
    const url = new URL(currentUrl, 'https://hyl.space/');
    url.searchParams.delete('view');
    url.searchParams.delete('game');
    url.searchParams.delete('room');

    if (view === 'game' && GAME_TYPES.includes(gameType)) {
      url.searchParams.set('game', gameType);
      if (roomCode) url.searchParams.set('room', normalizeRouteRoomCode(roomCode));
    }
    return url.toString();
  }

  function getDefaultPlacementMode(pointerCoarse, storedMode) {
    if (storedMode === 'single' || storedMode === 'confirm') return storedMode;
    return pointerCoarse ? 'confirm' : 'single';
  }

  function resolvePlacementSelection(mode, selected, index) {
    if (mode !== 'confirm') return { commit: true, selected: null };
    if (selected === index) return { commit: true, selected: null };
    return { commit: false, selected: index };
  }

  function getScoreKey(gameType, gameMode) {
    return `${gameType}:${gameMode}`;
  }

  function formatOnlineScoreName(name, mark) {
    return name ? `${name} · ${mark}` : mark;
  }

  function formatMatchResult(result) {
    return { win: '胜利', draw: '平局', loss: '失败' }[result] || '结果未知';
  }

  function formatFinishReason(reason, result) {
    if (reason === 'active_exit') return result === 'win' ? '对手主动退出' : '主动退出判负';
    if (reason === 'disconnect') return result === 'win' ? '对手断线' : '断线判负';
    if (reason === 'draw') return '棋盘平局';
    if (reason === 'expired') return '房间超时';
    return '正常结束';
  }

  function formatWinRate(value) {
    const rate = Number(value);
    return `${(Number.isFinite(rate) ? rate : 0).toFixed(1)}%`;
  }

  function selectPreferredSeason(items = []) {
    return items.find((season) => season.status === 'active') || items[0] || null;
  }

  function shouldShowLeaderboardEmpty({ busy, error, entries, hasSeason }) {
    return hasSeason && !busy && !error && entries.length === 0;
  }

  function getLocalUndoCount(state) {
    const history = state?.moveHistory || [];
    if (history.length === 0 || state?.gameMode === 'online') return 0;
    if (state.gameMode === 'pvp') return 1;
    if (state.gameMode !== 'ai') return 0;
    const lastMark = history.length % 2 === 1 ? 'X' : 'O';
    if (state.status !== 'playing') {
      return lastMark === state.playerMark ? 1 : Math.min(2, history.length);
    }
    if (state.currentTurn === 'ai') return 1;
    if (state.playerMark === 'O' && history.length === 1) return 0;
    return Math.min(2, history.length);
  }

  const exported = {
    buildAppUrl,
    detectRematchRejection,
    getDefaultPlacementMode,
    getGameDialogState,
    getGameEntryTarget,
    getLocalUndoCount,
    getScoreKey,
    resolveAppRoute,
    formatFinishReason,
    formatMatchResult,
    formatOnlineScoreName,
    formatWinRate,
    normalizeRoomCodeInput,
    resolvePlacementSelection,
    selectPreferredSeason,
    shouldDismissGameDialogAction,
    shouldUpdateGameDialogContent,
    shouldShowLeaderboardEmpty,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;

  function mountGame() {
    const initialRoute = resolveAppRoute(globalScope.location.href);
    if (initialRoute.view === 'admin') {
      globalScope.location.replace('/admin/');
      return;
    }
    const home = document.querySelector('#game-home');
    const gameView = document.querySelector('#game-view');
    const leaderboardView = document.querySelector('#leaderboard-view');
    const backHomeButton = document.querySelector('#back-home-button');
    const boardElement = document.querySelector('#board');
    if (!home || !gameView || !boardElement) return;

    const gameTitle = document.querySelector('#game-title');
    const gameDescription = document.querySelector('#game-description');
    const brandMark = document.querySelector('#brand-mark');
    const statusCard = document.querySelector('.status-card');
    const statusText = document.querySelector('#status-text');
    const markInfo = document.querySelector('#mark-info');
    const arenaLabel = document.querySelector('#arena-label');
    const difficultyLabel = document.querySelector('#difficulty-label');
    const gamePanel = document.querySelector('.game-panel');
    const gameNote = document.querySelector('#game-note');
    const gameNoteText = document.querySelector('#game-note-text');
    const aiDifficultySettings = document.querySelector('#ai-difficulty-settings');
    const aiFirstSettings = document.querySelector('#ai-first-settings');
    const placementSettings = document.querySelector('#placement-settings');
    const onlineRoomPanel = document.querySelector('#online-room-panel');
    const onlineRoomActions = document.querySelector('.online-room-actions');
    const onlineRoomSession = document.querySelector('#online-room-session');
    const onlineRoomMessage = document.querySelector('#online-room-message');
    const roomCodeInput = document.querySelector('#room-code-input');
    const roomCodeDisplay = document.querySelector('#room-code-display');
    const createRoomButton = document.querySelector('#create-room-button');
    const joinRoomButton = document.querySelector('#join-room-button');
    const copyRoomButton = document.querySelector('#copy-room-button');
    const leaveRoomButton = document.querySelector('#leave-room-button');
    const onlineUndoRequest = document.querySelector('#online-undo-request');
    const onlineUndoMessage = document.querySelector('#online-undo-message');
    const gameEventDialog = document.querySelector('#game-event-dialog');
    const gameEventTitle = document.querySelector('#game-event-title');
    const gameEventMessage = document.querySelector('#game-event-message');
    const gameEventPrimary = document.querySelector('#game-event-primary');
    const gameEventSecondary = document.querySelector('#game-event-secondary');
    const connectionLabel = document.querySelector('#online-connection-label');
    const restartButton = document.querySelector('#restart-button');
    const undoButton = document.querySelector('#undo-button');
    const clearScoreButton = document.querySelector('#clear-score-button');
    const leftScoreName = document.querySelector('#left-score-name');
    const middleScoreName = document.querySelector('#middle-score-name');
    const rightScoreName = document.querySelector('#right-score-name');
    const scoreElements = {
      left: document.querySelector('#player-score'),
      draw: document.querySelector('#draw-score'),
      right: document.querySelector('#ai-score'),
    };
    const accountDialog = document.querySelector('#account-dialog');
    const onlineWagerPicker = document.querySelector('#online-wager-picker');
    const wagerBalanceNote = document.querySelector('#wager-balance-note');
    const roomPreviewElement = document.querySelector('#room-preview');
    const roomPreviewGame = document.querySelector('#room-preview-game');
    const roomPreviewHost = document.querySelector('#room-preview-host');
    const roomPreviewWager = document.querySelector('#room-preview-wager');
    const confirmJoinButton = document.querySelector('#confirm-join-button');
    const cancelJoinButton = document.querySelector('#cancel-join-button');
    const roomWagerDisplay = document.querySelector('#room-wager-display');
    const roomSettlementMessage = document.querySelector('#room-settlement-message');
    const disconnectCountdown = document.querySelector('#disconnect-countdown');
    const openLeaderboardButton = document.querySelector('#open-leaderboard-button');
    const leaderboardBackButton = document.querySelector('#leaderboard-back-button');
    const leaderboardSeasonSelect = document.querySelector('#leaderboard-season-select');
    const leaderboardGameTabs = document.querySelector('#leaderboard-game-tabs');
    const leaderboardList = document.querySelector('#leaderboard-list');
    const leaderboardCurrentPlayer = document.querySelector('#leaderboard-current-player');
    const leaderboardMessage = document.querySelector('#leaderboard-message');
    const onlineApi = globalScope.OnlineGame;
    const statsApi = globalScope.PlayerStats;
    const accountPanel = globalScope.HYLAccountPanel?.mount();
    const accountClient = accountPanel?.accountClient;
    const economyClient = accountPanel?.economyClient;
    const statsClient = accountPanel?.statsClient;
    const gameFriends = globalScope.HYLGameFriends?.mount({
      accountPanel,
      onMessage: (message) => {
        onlineRoomMessage.textContent = message;
      },
    }) || { setWaitingRoom() {}, destroy() {} };
    const sessionScores = new Map();
    let gameType = null;
    let engine = null;
    let state = null;
    let cells = [];
    let lastMove = null;
    let selectedCandidate = null;
    let placementMode = 'single';
    let aiTimer = null;
    let aiWorker = null;
    let aiRequestId = 0;
    let roundToken = 0;
    let undoRenderTimer = null;
    let activeGameDialog = null;
    let dismissedGameDialogKey = null;
    let onlineGame = null;
    let rematchRejected = null;
    let onlinePhase = 'idle';
    let onlineConnected = false;
    let onlineSubmitting = false;
    let onlineError = '';
    let pendingRoomPreview = null;
    let heartbeatTimer = null;
    let disconnectTimer = null;
    let disconnectDeadline = 0;
    let claimingDisconnect = false;
    let accountIdentity = accountPanel?.getIdentity() || {
      kind: 'guest',
      username: null,
      displayName: '匿名玩家',
      needsProfile: false,
    };
    let economySnapshot = accountPanel?.getEconomySnapshot() || {
      balance: 0,
      isAdmin: false,
      loaded: false,
    };
    let seasons = [];
    let selectedSeasonId = null;
    let leaderboardGameType = 'tic_tac_toe';
    let leaderboardEntries = [];
    let leaderboardBusy = false;
    let leaderboardError = '';
    let leaderboardRequestId = 0;
    function setStatsMessage(element, message = '', stateName = '') {
      if (!element) return;
      element.textContent = message;
      element.dataset.state = stateName;
    }

    function gameTypeLabel(type) {
      return type === 'gomoku' ? '五子棋' : '无限井字棋';
    }

    function formatMatchTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '时间未知';
      return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
    }

    function preferredSeason() {
      return selectPreferredSeason(seasons);
    }

    function renderSeasonControls() {
      if (!leaderboardSeasonSelect) return;
      const stillExists = seasons.some((season) => season.id === selectedSeasonId);
      if (!stillExists) selectedSeasonId = preferredSeason()?.id || null;
      leaderboardSeasonSelect.textContent = '';
      if (seasons.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '暂无赛季';
        leaderboardSeasonSelect.append(option);
        leaderboardSeasonSelect.disabled = true;
        return;
      }
      seasons.forEach((season) => {
        const option = document.createElement('option');
        option.value = season.id;
        option.textContent = season.status === 'active' ? `${season.name}（进行中）` : season.name;
        leaderboardSeasonSelect.append(option);
      });
      leaderboardSeasonSelect.disabled = false;
      leaderboardSeasonSelect.value = selectedSeasonId;
    }

    function createLeaderboardRow(entry, { heading = false } = {}) {
      const row = document.createElement(heading ? 'div' : 'article');
      row.className = `leaderboard-row${heading ? ' leaderboard-row-heading' : ''}`;
      if (!heading) {
        row.classList.toggle('is-current-player', entry.isCurrentPlayer);
        row.classList.toggle('is-podium', entry.rank <= 3);
      }
      const values = heading
        ? ['名次', '玩家', '积分', '胜 / 平 / 负', '胜率']
        : [`#${entry.rank}`, entry.displayName, `${entry.points} 分`, `${entry.wins} / ${entry.draws} / ${entry.losses}`, formatWinRate(entry.winRate)];
      values.forEach((value) => {
        const cell = document.createElement(heading ? 'span' : 'div');
        cell.textContent = value;
        row.append(cell);
      });
      return row;
    }

    function renderLeaderboard() {
      if (!leaderboardList) return;
      leaderboardList.textContent = '';
      leaderboardCurrentPlayer.textContent = '';
      leaderboardCurrentPlayer.hidden = true;
      const topEntries = leaderboardEntries.filter((entry) => entry.isTopEntry);
      if (shouldShowLeaderboardEmpty({
        busy: leaderboardBusy,
        error: leaderboardError,
        entries: topEntries,
        hasSeason: Boolean(selectedSeasonId),
      })) {
        const empty = document.createElement('p');
        empty.className = 'leaderboard-empty-state';
        empty.textContent = '这个分榜还没有玩家，完成正式账号对局后即可上榜。';
        leaderboardList.append(empty);
      } else if (topEntries.length > 0) {
        leaderboardList.append(createLeaderboardRow({}, { heading: true }));
        topEntries.forEach((entry) => leaderboardList.append(createLeaderboardRow(entry)));
      }

      const current = leaderboardEntries.find((entry) => entry.isCurrentPlayer && !entry.isTopEntry);
      if (current) {
        const label = document.createElement('p');
        label.textContent = '我的排名';
        leaderboardCurrentPlayer.append(label, createLeaderboardRow(current));
        leaderboardCurrentPlayer.hidden = false;
      }
    }

    async function loadLeaderboard() {
      if (!statsClient) return;
      const requestId = ++leaderboardRequestId;
      leaderboardBusy = true;
      leaderboardError = '';
      setStatsMessage(leaderboardMessage, '正在加载排行榜');
      renderLeaderboard();
      try {
        const loadedSeasons = await statsClient.listSeasons();
        if (requestId !== leaderboardRequestId) return;
        seasons = loadedSeasons;
        renderSeasonControls();
        if (!selectedSeasonId) {
          leaderboardEntries = [];
          setStatsMessage(leaderboardMessage, '暂无赛季，管理员开启赛季后即可计分。');
          return;
        }
        const entries = await statsClient.getLeaderboard({
          seasonId: selectedSeasonId,
          gameType: leaderboardGameType,
          limit: 100,
        });
        if (requestId !== leaderboardRequestId) return;
        leaderboardEntries = entries;
        setStatsMessage(leaderboardMessage);
      } catch (error) {
        if (requestId !== leaderboardRequestId) return;
        leaderboardEntries = [];
        leaderboardError = statsApi.mapStatsError(error);
        setStatsMessage(leaderboardMessage, leaderboardError, 'error');
      } finally {
        if (requestId !== leaderboardRequestId) return;
        leaderboardBusy = false;
        renderLeaderboard();
      }
    }

    async function showLeaderboardView() {
      if (accountDialog?.open) accountDialog.close();
      home.hidden = true;
      gameView.hidden = true;
      leaderboardView.hidden = false;
      document.body.dataset.view = 'leaderboard';
      await loadLeaderboard();
    }

    async function refreshEconomy({ reportError = false } = {}) {
      if (!accountPanel) return economySnapshot;
      economySnapshot = await accountPanel.refreshEconomy({ reportError });
      if (state) render();
      return economySnapshot;
    }

    function selectedValue(name) {
      return document.querySelector(`input[name="${name}"]:checked`)?.value;
    }

    function scoreKey(mode = state?.gameMode || selectedValue('game-mode') || 'ai') {
      return getScoreKey(gameType, mode);
    }

    function currentScores() {
      const key = scoreKey();
      if (!sessionScores.has(key)) sessionScores.set(key, { left: 0, draw: 0, right: 0 });
      return sessionScores.get(key);
    }

    function displayMark(mark) {
      if (!mark) return '';
      if (gameType === 'gomoku') return mark === 'X' ? '黑棋' : '白棋';
      return mark;
    }

    function engineFor(type) {
      return type === 'gomoku' ? globalScope.GomokuEngine : globalScope.TicTacToeEngine;
    }

    function activeUndoRequest(game = onlineGame) {
      const request = game?.undoRequest;
      if (!request?.requesterMark || !request?.expiresAt) return null;
      return Date.parse(request.expiresAt) > Date.now() ? request : null;
    }

    function isOnlineFinished(game = onlineGame) {
      return ['x_win', 'o_win', 'draw'].includes(game?.status);
    }

    function stopOnlineRuntime() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (disconnectTimer) clearTimeout(disconnectTimer);
      heartbeatTimer = null;
      disconnectTimer = null;
      disconnectDeadline = 0;
      claimingDisconnect = false;
    }

    async function claimDisconnectedOpponent() {
      if (!onlineClient || !onlineGame || claimingDisconnect) return;
      claimingDisconnect = true;
      try {
        await onlineClient.claimDisconnect();
        await refreshEconomy();
      } catch (error) {
        if (!String(error?.message || error).includes('OPPONENT_STILL_ONLINE')) {
          onlineError = onlineApi.mapOnlineError(error);
        }
      } finally {
        claimingDisconnect = false;
        scheduleDisconnectClaim();
        render();
      }
    }

    function scheduleDisconnectClaim() {
      if (disconnectTimer) clearTimeout(disconnectTimer);
      disconnectTimer = null;
      disconnectDeadline = 0;
      const shouldClaim = onlineGame?.status === 'playing'
        && onlineGame.wagerAmount > 0
        && onlineConnected
        && !onlineGame.opponentOnline;
      if (!shouldClaim) return;

      const opponentMark = onlineGame.playerMark === 'X' ? 'O' : 'X';
      const lastSeen = Date.parse(onlineGame.lastSeenAt?.[opponentMark] || '') || Date.now();
      disconnectDeadline = lastSeen + 30_000;

      const tick = () => {
        if (!onlineGame || onlineGame.status !== 'playing' || onlineGame.opponentOnline) {
          scheduleDisconnectClaim();
          return;
        }
        const remaining = disconnectDeadline - Date.now();
        render();
        if (remaining <= 0) {
          void claimDisconnectedOpponent();
          return;
        }
        disconnectTimer = setTimeout(tick, Math.min(1000, remaining));
      };
      tick();
    }

    function syncOnlineRuntime() {
      const shouldHeartbeat = Boolean(onlineClient && onlineGame?.roomId && onlineConnected);
      if (shouldHeartbeat && !heartbeatTimer) {
        void onlineClient.heartbeat().catch((error) => {
          onlineError = onlineApi.mapOnlineError(error);
          render();
        });
        heartbeatTimer = setInterval(() => {
          void onlineClient.heartbeat().catch(() => {});
        }, 10_000);
      } else if (!shouldHeartbeat && heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      scheduleDisconnectClaim();
    }

    function cancelAI() {
      if (aiTimer) clearTimeout(aiTimer);
      aiTimer = null;
      aiRequestId += 1;
      if (aiWorker) aiWorker.terminate();
      aiWorker = null;
    }

    function createState({ gameMode, difficulty, firstPlayer }) {
      const position = engine.createPosition();
      if (gameMode === 'online') {
        return {
          ...position,
          gameType,
          gameMode,
          difficulty,
          playerMark: null,
          aiMark: null,
          currentTurn: null,
          currentMark: 'X',
          status: 'waiting',
          winningLine: [],
          scoredSide: null,
        };
      }
      if (gameMode === 'pvp') {
        return {
          ...position,
          gameType,
          gameMode,
          difficulty,
          playerMark: null,
          aiMark: null,
          currentTurn: 'player',
          currentMark: 'X',
          status: 'playing',
          winningLine: [],
          scoredSide: null,
        };
      }
      const aiStarts = firstPlayer === 'ai';
      return {
        ...position,
        gameType,
        gameMode,
        difficulty,
        playerMark: aiStarts ? 'O' : 'X',
        aiMark: aiStarts ? 'X' : 'O',
        currentTurn: aiStarts ? 'ai' : 'player',
        currentMark: 'X',
        status: 'playing',
        winningLine: [],
        scoredSide: null,
      };
    }

    function makeBoardCells() {
      boardElement.textContent = '';
      boardElement.className = gameType === 'gomoku' ? 'board gomoku-board' : 'board';
      boardElement.setAttribute('aria-rowcount', String(engine.boardSize));
      boardElement.setAttribute('aria-colcount', String(engine.boardSize));
      boardElement.setAttribute(
        'aria-label',
        gameType === 'gomoku' ? '15 乘 15 五子棋棋盘' : '3 乘 3 井字棋棋盘',
      );
      const starPoints = new Set(['3,3', '3,11', '7,7', '11,3', '11,11']);
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < engine.cellCount; index += 1) {
        const cell = document.createElement('button');
        const row = Math.floor(index / engine.boardSize);
        const column = index % engine.boardSize;
        cell.type = 'button';
        cell.role = 'gridcell';
        cell.className = gameType === 'gomoku' ? 'cell gomoku-cell' : 'cell';
        cell.dataset.index = String(index);
        cell.setAttribute('aria-rowindex', String(row + 1));
        cell.setAttribute('aria-colindex', String(column + 1));
        if (gameType === 'gomoku' && starPoints.has(`${row},${column}`)) {
          cell.classList.add('star-point');
        }
        fragment.append(cell);
      }
      boardElement.append(fragment);
      cells = [...boardElement.querySelectorAll('.cell')];
    }

    function updateGameUrl(roomCode = null, replace = true) {
      if (!globalScope.history?.pushState) return;
      const url = buildAppUrl(globalScope.location.href, {
        view: 'game',
        gameType,
        roomCode,
      });
      const method = replace ? 'replaceState' : 'pushState';
      globalScope.history[method](null, '', url);
    }

    function updateViewUrl(view, replace = true) {
      if (!globalScope.history?.pushState) return;
      const url = buildAppUrl(globalScope.location.href, { view });
      const method = replace ? 'replaceState' : 'pushState';
      globalScope.history[method](null, '', url);
    }

    function renderScores() {
      if (state.gameMode === 'online') {
        scoreElements.left.textContent = onlineGame?.scores?.X ?? 0;
        scoreElements.draw.textContent = onlineGame?.round ?? 1;
        scoreElements.right.textContent = onlineGame?.scores?.O ?? 0;
        return;
      }
      const scores = currentScores();
      scoreElements.left.textContent = scores.left;
      scoreElements.draw.textContent = scores.draw;
      scoreElements.right.textContent = scores.right;
    }

    function statusMessage() {
      if (state.gameMode === 'online') {
        return onlineApi?.getOnlineStatusMessage({
          phase: onlinePhase,
          game: onlineGame,
          connected: onlineConnected,
          submitting: onlineSubmitting,
          error: onlineError,
          displayMark,
        }) || '线上服务暂时不可用';
      }
      if (state.gameMode === 'pvp') {
        if (state.status === 'x_win') return `${displayMark('X')}获胜`;
        if (state.status === 'o_win') return `${displayMark('O')}获胜`;
        if (state.status === 'draw') return '平局，棋逢对手';
        return `轮到${displayMark(state.currentMark)}落子`;
      }
      if (state.status === 'x_win' || state.status === 'o_win') {
        const winner = state.status === 'x_win' ? 'X' : 'O';
        return winner === state.playerMark ? '你赢了，漂亮的一局' : 'AI 获胜，再试一次';
      }
      if (state.status === 'draw') return '平局，棋逢对手';
      if (state.currentTurn === 'ai') return 'AI 正在思考';
      return `轮到你，你执${displayMark(state.playerMark)}`;
    }

    function renderUndoRequest() {
      if (undoRenderTimer) clearTimeout(undoRenderTimer);
      undoRenderTimer = null;
      const request = activeUndoRequest();
      const ownRequest = request?.requesterMark === onlineGame?.playerMark;
      const showRequest = state.gameMode === 'online' && Boolean(request) && ownRequest;
      onlineUndoRequest.hidden = !showRequest;
      if (!showRequest) return;
      const opponentMark = onlineGame.playerMark === 'X' ? 'O' : 'X';
      const opponentName = onlineGame.playerNames?.[opponentMark] || '对方';
      const seconds = Math.max(1, Math.ceil((Date.parse(request.expiresAt) - Date.now()) / 1000));
      onlineUndoMessage.textContent = `等待${opponentName}回应，${seconds} 秒后自动取消`;
      undoRenderTimer = setTimeout(render, Math.min(1000, seconds * 1000));
    }

    function closeGameEventDialog({ dismiss = false } = {}) {
      if (dismiss && activeGameDialog) dismissedGameDialogKey = activeGameDialog.key;
      if (gameEventDialog?.open) gameEventDialog.close();
      activeGameDialog = null;
    }

    function syncGameEventDialog(resultMessage) {
      if (!gameEventDialog) return;
      const roundKey = state.gameMode === 'online'
        ? `${onlineGame?.roomId || 'online'}:${onlineGame?.round || 0}`
        : `local:${roundToken}`;
      const nextDialog = getGameDialogState({
        state,
        onlineGame,
        resultMessage,
        roundKey,
        rematchRejected,
        actionError: onlineError,
      });
      if (!nextDialog || nextDialog.key === dismissedGameDialogKey) {
        closeGameEventDialog();
        return;
      }
      const sameOpenDialog = activeGameDialog?.key === nextDialog.key && gameEventDialog.open;
      if (sameOpenDialog && !shouldUpdateGameDialogContent(activeGameDialog, nextDialog)) return;
      activeGameDialog = nextDialog;
      gameEventTitle.textContent = nextDialog.title;
      gameEventMessage.textContent = nextDialog.message;
      [gameEventPrimary, gameEventSecondary].forEach((button, index) => {
        const action = nextDialog.actions[index];
        button.hidden = !action;
        button.dataset.action = action?.action || '';
        button.textContent = action?.label || '';
      });
      if (sameOpenDialog) return;
      if (!gameEventDialog.open) gameEventDialog.showModal();
    }

    function scrollToGameEntry(options) {
      const target = document.querySelector(`#${getGameEntryTarget(options)}`);
      const scroll = () => target?.scrollIntoView({ block: 'start' });
      if (globalScope.requestAnimationFrame) globalScope.requestAnimationFrame(scroll);
      else setTimeout(scroll, 0);
    }

    function render() {
      if (!state || !engine) return;
      const isPvp = state.gameMode === 'pvp';
      const isOnline = state.gameMode === 'online';
      const aiThinking = !isPvp
        && !isOnline
        && state.status === 'playing'
        && state.currentTurn === 'ai';
      const onlineBusy = isOnline && (onlineSubmitting || onlinePhase === 'connecting');
      const hasOnlineRoom = Boolean(onlineGame?.roomId);
      const wagerAmount = Number(selectedValue('online-wager') || 0);
      const registered = accountIdentity.kind === 'registered';
      const wagerAllowed = wagerAmount === 0
        || (registered && economySnapshot.loaded && economySnapshot.balance >= wagerAmount);
      const undoRequest = activeUndoRequest();
      const expiringPieces = gameType === 'tic_tac_toe'
        ? engine.getExpiringPieces(state.moveOrders || { X: [], O: [] })
        : [];
      const expiringByIndex = new Map(expiringPieces.map((piece) => [piece.index, piece.mark]));

      const copy = GAME_COPY[gameType];
      gameTitle.textContent = copy.title;
      gameDescription.textContent = copy.description;
      arenaLabel.textContent = copy.arena;
      gameNoteText.textContent = copy.note;
      gameNote.classList.toggle('gomoku-note', gameType === 'gomoku');
      brandMark.innerHTML = gameType === 'gomoku' ? '五' : 'X<span>O</span>';
      brandMark.classList.toggle('gomoku-brand', gameType === 'gomoku');
      const currentStatusMessage = statusMessage();
      statusText.textContent = currentStatusMessage;
      statusCard.dataset.result = state.status;
      markInfo.textContent = isOnline
        ? hasOnlineRoom
          ? `你是${onlineGame.playerNames?.[onlineGame.playerMark] || '玩家'}，执${displayMark(onlineGame.playerMark)}，${onlineGame.wagerAmount > 0 ? `每人彩头 ${onlineGame.wagerAmount} 金币` : '本局无彩头'}`
          : '创建房间或输入房间码，邀请好友加入'
        : isPvp
          ? `${displayMark('X')}和${displayMark('O')}轮流落子，${displayMark('X')}先手`
          : `你执${displayMark(state.playerMark)}，AI 执${displayMark(state.aiMark)}`;
      difficultyLabel.textContent = isOnline
        ? hasOnlineRoom ? `房间 ${onlineGame.roomCode}` : '好友房间'
        : isPvp ? '双人模式' : DIFFICULTY_NAMES[state.difficulty];

      aiDifficultySettings.hidden = isPvp || isOnline;
      aiFirstSettings.hidden = isPvp || isOnline;
      placementSettings.hidden = gameType !== 'gomoku';
      onlineRoomPanel.hidden = !isOnline;
      onlineRoomActions.hidden = hasOnlineRoom;
      onlineRoomSession.hidden = !hasOnlineRoom;
      roomPreviewElement.hidden = !pendingRoomPreview || hasOnlineRoom;
      if (pendingRoomPreview) {
        roomPreviewGame.textContent = GAME_COPY[pendingRoomPreview.gameType]?.title || '线上对战';
        roomPreviewHost.textContent = `${pendingRoomPreview.hostName}的房间`;
        roomPreviewWager.textContent = pendingRoomPreview.wagerAmount > 0
          ? `每人彩头 ${pendingRoomPreview.wagerAmount} 金币，胜者获得 ${pendingRoomPreview.wagerAmount * 2}`
          : '本局不使用金币彩头';
      }
      onlineRoomMessage.textContent = onlineError || (
        isOnline && !onlineClient?.isConfigured()
          ? '线上服务尚未配置，AI 和本地双人仍可使用'
          : ''
      );
      roomCodeDisplay.textContent = onlineGame?.roomCode || '------';
      roomWagerDisplay.textContent = onlineGame?.wagerAmount > 0
        ? `每人彩头 ${onlineGame.wagerAmount} 金币，奖池 ${onlineGame.wagerAmount * 2}`
        : '本局无彩头';
      const ownWon = onlineGame?.status === `${onlineGame?.playerMark?.toLowerCase()}_win`;
      const settled = isOnlineFinished();
      roomSettlementMessage.hidden = !settled || !onlineGame?.wagerAmount;
      roomSettlementMessage.textContent = onlineGame?.status === 'draw'
        ? `平局，已退回 ${onlineGame.wagerAmount} 金币`
        : ownWon
          ? `你获得 ${onlineGame.wagerAmount * 2} 金币`
          : `本局扣除 ${onlineGame?.wagerAmount || 0} 金币`;
      const disconnectSeconds = disconnectDeadline
        ? Math.max(0, Math.ceil((disconnectDeadline - Date.now()) / 1000))
        : 0;
      disconnectCountdown.hidden = !disconnectDeadline || isOnlineFinished();
      disconnectCountdown.textContent = claimingDisconnect
        ? '正在确认对手掉线'
        : `对手掉线，${disconnectSeconds} 秒后判负`;
      wagerBalanceNote.textContent = registered
        ? `当前余额 ${economySnapshot.balance} 金币`
        : '登录后可使用金币彩头';
      document.querySelectorAll('input[name="online-wager"]').forEach((input) => {
        input.disabled = hasOnlineRoom || (!registered && input.value !== '0');
      });
      createRoomButton.disabled = onlineBusy || !onlineClient?.isConfigured() || !wagerAllowed;
      joinRoomButton.disabled = onlineBusy
        || !onlineClient?.isConfigured()
        || !onlineApi?.isValidRoomCode(roomCodeInput.value);
      confirmJoinButton.disabled = onlineBusy
        || !pendingRoomPreview
        || (pendingRoomPreview.wagerAmount > 0 && (
          !registered || !economySnapshot.loaded || economySnapshot.balance < pendingRoomPreview.wagerAmount
        ));
      copyRoomButton.disabled = onlineBusy || !hasOnlineRoom;
      leaveRoomButton.disabled = onlineBusy || !hasOnlineRoom;
      document.querySelectorAll('input[name="game-mode"]').forEach((input) => {
        input.disabled = hasOnlineRoom && input.value !== 'online';
      });

      leftScoreName.textContent = isOnline
        ? formatOnlineScoreName(onlineGame?.playerNames?.X, displayMark('X'))
        : isPvp ? displayMark('X') : '玩家';
      middleScoreName.textContent = isOnline ? '局数' : '平局';
      rightScoreName.textContent = isOnline
        ? formatOnlineScoreName(onlineGame?.playerNames?.O, displayMark('O'))
        : isPvp ? displayMark('O') : 'AI';
      gamePanel.classList.toggle('is-thinking', aiThinking);
      gamePanel.classList.toggle('is-syncing', onlineBusy || Boolean(undoRequest));
      boardElement.setAttribute('aria-busy', String(aiThinking || onlineBusy));
      connectionLabel.hidden = !isOnline;
      connectionLabel.textContent = onlineBusy
        ? '连接中'
        : onlineConnected
          ? onlineGame?.opponentOnline ? '双方在线' : '已连接'
          : '未连接';

      const ownRematchReady = onlineGame?.rematchReady?.[onlineGame?.playerMark];
      restartButton.hidden = isOnline && !hasOnlineRoom;
      restartButton.textContent = isOnline
        ? ownRematchReady ? '等待对方' : '再来一局'
        : '重新开始';
      restartButton.disabled = isOnline && (
        !hasOnlineRoom
        || !['x_win', 'o_win', 'draw'].includes(state.status)
        || ownRematchReady
        || onlineBusy
      );
      clearScoreButton.hidden = isOnline;

      const onlineUndoRemaining = onlineGame?.undoRemaining?.[onlineGame?.playerMark] ?? 0;
      undoButton.textContent = isOnline ? `悔棋（剩余 ${onlineUndoRemaining}）` : '悔棋';
      undoButton.disabled = isOnline
        ? !hasOnlineRoom
          || !onlineConnected
          || state.status !== 'playing'
          || (state.moveHistory || []).length === 0
          || onlineUndoRemaining <= 0
          || Boolean(undoRequest)
          || onlineBusy
        : getLocalUndoCount(state) === 0;

      cells.forEach((cell, index) => {
        const mark = state.board[index];
        const canMove = isOnline
          ? onlineApi?.canOnlineMove(state, index, {
            connected: onlineConnected,
            submitting: onlineSubmitting,
          }) && !undoRequest
          : state.status === 'playing'
            && (isPvp || state.currentTurn === 'player')
            && mark === null;
        const isCandidate = selectedCandidate === index && mark === null;
        const shownMark = mark || (isCandidate ? state.currentMark : null);
        cell.textContent = '';
        cell.dataset.mark = mark || '';
        cell.classList.toggle('mark-x', shownMark === 'X');
        cell.classList.toggle('mark-o', shownMark === 'O');
        cell.classList.toggle('candidate', isCandidate);
        cell.classList.toggle('just-played', lastMove === index && Boolean(mark));
        cell.classList.toggle('last-move', lastMove === index && Boolean(mark));
        cell.classList.toggle('winner', state.winningLine.includes(index));
        cell.classList.toggle('next-to-remove', expiringByIndex.has(index));
        cell.style.setProperty('--win-order', String(Math.max(0, state.winningLine.indexOf(index))));
        cell.disabled = isOnline
          ? !canMove
          : aiThinking || state.status !== 'playing';
        cell.setAttribute('aria-disabled', String(!canMove));
        const row = Math.floor(index / engine.boardSize) + 1;
        const column = (index % engine.boardSize) + 1;
        const expiryHint = expiringByIndex.has(index) ? '，下次落子时将被消除' : '';
        cell.setAttribute(
          'aria-label',
          gameType === 'gomoku'
            ? `第 ${row} 行第 ${column} 列，${displayMark(mark) || '空位'}${isCandidate ? '，候选落点' : ''}`
            : `第 ${index + 1} 格，${mark || '空'}${expiryHint}`,
        );
      });

      renderUndoRequest();
      renderScores();
      syncGameEventDialog(currentStatusMessage);
    }

    function finishRound() {
      const outcome = engine.getOutcome(state, lastMove);
      state.status = outcome.status;
      state.winningLine = outcome.line;
      if (outcome.status === 'playing') return false;
      if (state.gameMode !== 'online' && !state.scoredSide) {
        const scores = currentScores();
        if (outcome.status === 'draw') state.scoredSide = 'draw';
        else if (state.gameMode === 'pvp') state.scoredSide = outcome.winner === 'X' ? 'left' : 'right';
        else state.scoredSide = outcome.winner === state.playerMark ? 'left' : 'right';
        scores[state.scoredSide] += 1;
      }
      return true;
    }

    function requestAIMove() {
      const requestId = ++aiRequestId;
      if (gameType === 'gomoku' && state.difficulty === 'hard' && typeof Worker !== 'undefined') {
        if (aiWorker) aiWorker.terminate();
        const worker = new Worker('/src/workers/gomoku-ai-worker.js');
        aiWorker = worker;
        return new Promise((resolve) => {
          worker.onmessage = (event) => {
            if (event.data?.requestId !== requestId || aiWorker !== worker) return;
            worker.terminate();
            aiWorker = null;
            if (event.data?.error || event.data?.move === null) {
              resolve(engine.chooseAIMove(state, 'normal', state.aiMark));
              return;
            }
            resolve(event.data.move);
          };
          worker.onerror = () => {
            if (requestId !== aiRequestId || aiWorker !== worker) return;
            worker.terminate();
            aiWorker = null;
            resolve(engine.chooseAIMove(state, 'normal', state.aiMark));
          };
          worker.postMessage({
            requestId,
            position: { board: state.board, moveHistory: state.moveHistory },
            aiMark: state.aiMark,
          });
        });
      }
      const difficulty = gameType === 'gomoku' && state.difficulty === 'hard'
        ? 'normal'
        : state.difficulty;
      return Promise.resolve(engine.chooseAIMove(state, difficulty, state.aiMark));
    }

    function scheduleAI() {
      cancelAI();
      const token = roundToken;
      aiTimer = setTimeout(async () => {
        aiTimer = null;
        const requestId = aiRequestId;
        const move = await requestAIMove();
        if (token !== roundToken || requestId + 1 !== aiRequestId) return;
        if (state.status !== 'playing' || state.currentTurn !== 'ai' || move === null) return;
        const nextPosition = engine.applyMove(state, move, state.aiMark);
        if (!nextPosition) return;
        state = { ...state, ...nextPosition };
        lastMove = move;
        selectedCandidate = null;
        if (!finishRound()) {
          state.currentTurn = 'player';
          state.currentMark = state.playerMark;
        }
        render();
      }, 320);
      render();
    }

    function newRound({ clearScores = false } = {}) {
      cancelAI();
      roundToken += 1;
      selectedCandidate = null;
      lastMove = null;
      const mode = selectedValue('game-mode') || 'ai';
      if (clearScores) sessionScores.set(scoreKey(mode), { left: 0, draw: 0, right: 0 });
      if (mode !== 'online') {
        onlineGame = null;
        rematchRejected = null;
        onlinePhase = 'idle';
        onlineConnected = false;
        onlineError = '';
      }
      state = createState({
        gameMode: mode,
        difficulty: selectedValue('difficulty') || 'normal',
        firstPlayer: selectedValue('first-player') || 'player',
      });
      render();
      if (state.gameMode === 'ai' && state.currentTurn === 'ai') scheduleAI();
    }

    async function commitMove(index) {
      if (state.gameMode === 'online') {
        if (!onlineApi?.canOnlineMove(state, index, {
          connected: onlineConnected,
          submitting: onlineSubmitting,
        }) || activeUndoRequest()) return;
        onlineSubmitting = true;
        onlineError = '';
        selectedCandidate = null;
        render();
        try {
          await onlineClient.makeMove(index);
        } catch (error) {
          onlineError = onlineApi.mapOnlineError(error);
        } finally {
          onlineSubmitting = false;
          render();
        }
        return;
      }
      if (state.status !== 'playing') return;
      if (state.gameMode === 'ai' && state.currentTurn !== 'player') return;
      const mark = state.gameMode === 'pvp' ? state.currentMark : state.playerMark;
      const nextPosition = engine.applyMove(state, index, mark);
      if (!nextPosition) return;
      state = { ...state, ...nextPosition };
      lastMove = index;
      selectedCandidate = null;
      if (finishRound()) {
        render();
        return;
      }
      if (state.gameMode === 'pvp') {
        state.currentMark = state.currentMark === 'X' ? 'O' : 'X';
        render();
        return;
      }
      state.currentTurn = 'ai';
      state.currentMark = state.aiMark;
      scheduleAI();
    }

    function handleCell(index) {
      if (!Number.isInteger(index) || state.board[index] !== null) return;
      if (gameType !== 'gomoku') {
        void commitMove(index);
        return;
      }
      const selection = resolvePlacementSelection(placementMode, selectedCandidate, index);
      selectedCandidate = selection.selected;
      if (selection.commit) void commitMove(index);
      else render();
    }

    function undoLocal() {
      const count = getLocalUndoCount(state);
      if (count === 0) return;
      cancelAI();
      roundToken += 1;
      if (state.scoredSide) {
        const scores = currentScores();
        scores[state.scoredSide] = Math.max(0, scores[state.scoredSide] - 1);
      }
      const moveHistory = state.moveHistory.slice(0, -count);
      const position = engine.replayMoves(moveHistory);
      state = {
        ...state,
        ...position,
        currentTurn: 'player',
        currentMark: moveHistory.length % 2 === 0 ? 'X' : 'O',
        status: 'playing',
        winningLine: [],
        scoredSide: null,
      };
      lastMove = moveHistory.at(-1) ?? null;
      selectedCandidate = null;
      render();
    }

    const onlineClient = onlineApi?.createOnlineClient({
      accountClient,
      onState: (game) => {
        if (state?.gameMode !== 'online' || game.gameType !== gameType) return;
        const previousRound = onlineGame?.round;
        const previousStatus = onlineGame?.status;
        const rejected = detectRematchRejection(onlineGame, game);
        if (rejected) {
          rematchRejected = { round: game.round, version: game.version };
        } else if (
          rematchRejected
          && (rematchRejected.round !== game.round || rematchRejected.version !== game.version)
        ) {
          rematchRejected = null;
        }
        onlineGame = game;
        gameFriends.setWaitingRoom(
          onlineGame?.status === 'waiting' && onlineGame?.playerMark === 'X'
            ? onlineGame
            : null,
        );
        state = {
          ...state,
          ...game,
          difficulty: state.difficulty,
          aiMark: null,
          currentTurn: null,
        };
        lastMove = game.moveHistory?.at(-1) ?? null;
        selectedCandidate = null;
        onlinePhase = game.status === 'waiting' ? 'waiting' : 'active';
        onlineError = '';
        syncOnlineRuntime();
        if (isOnlineFinished(game) && (previousStatus !== game.status || previousRound !== game.round)) {
          seasons = [];
          leaderboardEntries = [];
          void refreshEconomy();
        }
        render();
      },
      onConnection: (connected) => {
        onlineConnected = connected;
        syncOnlineRuntime();
        render();
      },
      onPresence: (opponentOnline) => {
        if (onlineGame) {
          onlineGame = { ...onlineGame, opponentOnline };
          state = { ...state, opponentOnline };
        }
        syncOnlineRuntime();
        render();
      },
      onError: (error) => {
        onlineError = onlineApi.mapOnlineError(error);
        render();
      },
    });

    async function createOnlineRoom() {
      if (!onlineClient || onlineSubmitting) return;
      onlineSubmitting = true;
      onlinePhase = 'connecting';
      onlineError = '';
      render();
      try {
        const wagerAmount = Number(selectedValue('online-wager') || 0);
        const game = await onlineClient.createRoom(gameType, wagerAmount);
        pendingRoomPreview = null;
        await refreshEconomy();
        updateGameUrl(game.roomCode);
      } catch (error) {
        onlineError = onlineApi.mapOnlineError(error);
      } finally {
        onlineSubmitting = false;
        onlinePhase = onlineGame ? onlineGame.status === 'waiting' ? 'waiting' : 'active' : 'idle';
        render();
      }
    }

    async function previewOnlineRoom(roomCode = roomCodeInput.value) {
      if (!onlineClient || onlineSubmitting) return;
      const normalized = onlineApi.normalizeRoomCode(roomCode);
      roomCodeInput.value = normalized;
      if (!onlineApi.isValidRoomCode(normalized)) {
        onlineError = onlineApi.mapOnlineError(new Error('INVALID_ROOM_CODE'));
        render();
        return;
      }
      onlineSubmitting = true;
      onlinePhase = 'connecting';
      onlineError = '';
      pendingRoomPreview = null;
      render();
      try {
        pendingRoomPreview = await onlineClient.previewRoom(normalized, gameType);
      } catch (error) {
        onlineError = onlineApi.mapOnlineError(error);
      } finally {
        onlineSubmitting = false;
        onlinePhase = onlineGame ? onlineGame.status === 'waiting' ? 'waiting' : 'active' : 'idle';
        render();
      }
    }

    async function joinOnlineRoom(roomCode = roomCodeInput.value) {
      if (!onlineClient || onlineSubmitting || !pendingRoomPreview) return;
      const normalized = onlineApi.normalizeRoomCode(roomCode);
      onlineSubmitting = true;
      onlinePhase = 'connecting';
      onlineError = '';
      render();
      try {
        const game = await onlineClient.joinRoom(normalized, gameType);
        pendingRoomPreview = null;
        await refreshEconomy();
        updateGameUrl(game.roomCode);
        scrollToGameEntry({ roomCode: normalized, joined: true });
      } catch (error) {
        onlineError = onlineApi.mapOnlineError(error);
      } finally {
        onlineSubmitting = false;
        onlinePhase = onlineGame ? onlineGame.status === 'waiting' ? 'waiting' : 'active' : 'idle';
        render();
      }
    }

    async function requestOnlineRematch() {
      if (!onlineClient || onlineSubmitting || !onlineGame) return;
      onlineSubmitting = true;
      onlineError = '';
      render();
      try {
        await onlineClient.requestRematch();
        await refreshEconomy();
      } catch (error) {
        onlineError = onlineApi.mapOnlineError(error);
      } finally {
        onlineSubmitting = false;
        render();
      }
    }

    async function declineOnlineRematch() {
      if (!onlineClient || onlineSubmitting || !onlineGame) return;
      onlineSubmitting = true;
      onlineError = '';
      render();
      try {
        await onlineClient.declineRematch();
      } catch (error) {
        onlineError = onlineApi.mapOnlineError(error);
      } finally {
        onlineSubmitting = false;
        render();
      }
    }

    async function leaveOnlineRoom() {
      if (!onlineClient || onlineSubmitting || !onlineGame) return;
      onlineSubmitting = true;
      onlineError = '';
      render();
      try {
        await onlineClient.leaveRoom();
        stopOnlineRuntime();
        onlineGame = null;
        gameFriends.setWaitingRoom(null);
        rematchRejected = null;
        onlineConnected = false;
        onlinePhase = 'idle';
        state = createState({
          gameMode: 'online',
          difficulty: selectedValue('difficulty') || 'normal',
          firstPlayer: 'player',
        });
        pendingRoomPreview = null;
        await refreshEconomy();
        updateGameUrl(null);
      } catch (error) {
        onlineError = onlineApi.mapOnlineError(error);
      } finally {
        onlineSubmitting = false;
        render();
      }
    }

    async function copyInvitation() {
      if (!onlineGame) return;
      const inviteUrl = onlineApi.buildInviteUrl(globalScope.location.href, onlineGame.roomCode, gameType);
      try {
        await globalScope.navigator.clipboard.writeText(inviteUrl);
        onlineRoomMessage.textContent = '邀请链接已复制';
      } catch {
        onlineRoomMessage.textContent = `房间码：${onlineGame.roomCode}`;
      }
    }

    async function submitOnlineUndo(action) {
      if (!onlineClient || onlineSubmitting || !onlineGame) return;
      onlineSubmitting = true;
      onlineError = '';
      render();
      try {
        if (action === 'request') await onlineClient.requestUndo();
        if (action === 'accept') await onlineClient.respondUndo(true);
        if (action === 'reject') await onlineClient.respondUndo(false);
      } catch (error) {
        onlineError = onlineApi.mapOnlineError(error);
      } finally {
        onlineSubmitting = false;
        render();
      }
    }

    function enterGame(type, { replaceUrl = false, roomCode = null } = {}) {
      if (!GAME_TYPES.includes(type)) return;
      gameType = type;
      engine = engineFor(type);
      if (!engine) return;
      if (accountDialog?.open) accountDialog.close();
      leaderboardView.hidden = true;
      home.hidden = true;
      gameView.hidden = false;
      document.body.dataset.view = 'game';
      document.querySelector('input[name="game-mode"][value="ai"]').checked = true;
      const storedMode = globalScope.localStorage?.getItem(PLACEMENT_STORAGE_KEY);
      placementMode = getDefaultPlacementMode(
        globalScope.matchMedia?.('(pointer: coarse)').matches,
        storedMode,
      );
      const placementInput = document.querySelector(
        `input[name="placement-mode"][value="${placementMode}"]`,
      );
      if (placementInput) placementInput.checked = true;
      makeBoardCells();
      updateGameUrl(roomCode, replaceUrl);
      if (roomCode) {
        document.querySelector('input[name="game-mode"][value="online"]').checked = true;
        roomCodeInput.value = roomCode;
      }
      newRound();
      scrollToGameEntry({ roomCode, joined: false });
      if (roomCode) void previewOnlineRoom(roomCode);
    }

    async function resetGameSession() {
      cancelAI();
      stopOnlineRuntime();
      if (onlineGame && onlineClient) {
        try {
          await onlineClient.leaveRoom();
        } catch {
          await onlineClient.disconnect();
        }
      }
      onlineGame = null;
      gameFriends.setWaitingRoom(null);
      rematchRejected = null;
      pendingRoomPreview = null;
      gameType = null;
      state = null;
      selectedCandidate = null;
    }

    async function showGameHome({ replaceUrl = false } = {}) {
      await resetGameSession();
      gameView.hidden = true;
      leaderboardView.hidden = true;
      home.hidden = false;
      document.body.dataset.view = 'games';
      updateViewUrl('games', replaceUrl);
    }

    Object.assign(exported, {
      enterGame,
      openGameHome: showGameHome,
    });
    openLeaderboardButton?.addEventListener('click', () => void showLeaderboardView());
    leaderboardBackButton?.addEventListener('click', () => void showGameHome());
    leaderboardSeasonSelect?.addEventListener('change', () => {
      selectedSeasonId = leaderboardSeasonSelect.value || null;
      void loadLeaderboard();
    });
    leaderboardGameTabs?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-leaderboard-game]');
      if (!button || button.dataset.leaderboardGame === leaderboardGameType) return;
      leaderboardGameType = button.dataset.leaderboardGame;
      leaderboardGameTabs.querySelectorAll('[data-leaderboard-game]').forEach((tab) => {
        tab.setAttribute('aria-selected', String(tab === button));
      });
      void loadLeaderboard();
    });
    backHomeButton.addEventListener('click', () => void showGameHome());
    document.querySelectorAll('input[name="difficulty"], input[name="first-player"]')
      .forEach((input) => input.addEventListener('change', () => newRound()));
    document.querySelectorAll('input[name="game-mode"]')
      .forEach((input) => input.addEventListener('change', () => newRound()));
    document.querySelectorAll('input[name="placement-mode"]')
      .forEach((input) => input.addEventListener('change', () => {
        placementMode = selectedValue('placement-mode');
        selectedCandidate = null;
        globalScope.localStorage?.setItem(PLACEMENT_STORAGE_KEY, placementMode);
        render();
      }));

    boardElement.addEventListener('click', (event) => {
      const cell = event.target.closest('.cell');
      if (!cell) return;
      handleCell(Number(cell.dataset.index));
    });
    boardElement.addEventListener('keydown', (event) => {
      const cell = event.target.closest('.cell');
      if (!cell || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const current = Number(cell.dataset.index);
      let next = current;
      if (event.key === 'ArrowLeft' && current % engine.boardSize > 0) next -= 1;
      if (event.key === 'ArrowRight' && current % engine.boardSize < engine.boardSize - 1) next += 1;
      if (event.key === 'ArrowUp' && current >= engine.boardSize) next -= engine.boardSize;
      if (event.key === 'ArrowDown' && current < engine.cellCount - engine.boardSize) next += engine.boardSize;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = engine.cellCount - 1;
      if (next !== current) {
        event.preventDefault();
        cells[next].focus();
      }
    });

    function handleRoomCodeInput(isComposing = false) {
      if (!isComposing) {
        roomCodeInput.value = normalizeRoomCodeInput(roomCodeInput.value, false);
      }
      pendingRoomPreview = null;
      onlineError = '';
      render();
    }
    roomCodeInput.addEventListener('input', (event) => {
      handleRoomCodeInput(event.isComposing);
    });
    roomCodeInput.addEventListener('compositionend', () => handleRoomCodeInput(false));
    roomCodeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void previewOnlineRoom();
    });
    document.querySelectorAll('input[name="online-wager"]')
      .forEach((input) => input.addEventListener('change', () => {
        onlineError = '';
        render();
      }));
    createRoomButton.addEventListener('click', () => void createOnlineRoom());
    joinRoomButton.addEventListener('click', () => void previewOnlineRoom());
    confirmJoinButton.addEventListener('click', () => void joinOnlineRoom());
    cancelJoinButton.addEventListener('click', () => {
      pendingRoomPreview = null;
      onlineError = '';
      render();
    });
    copyRoomButton.addEventListener('click', () => void copyInvitation());
    leaveRoomButton.addEventListener('click', () => void leaveOnlineRoom());
    undoButton.addEventListener('click', () => {
      if (state.gameMode === 'online') void submitOnlineUndo('request');
      else undoLocal();
    });
    restartButton.addEventListener('click', () => {
      if (state.gameMode === 'online') void requestOnlineRematch();
      else newRound();
    });
    clearScoreButton.addEventListener('click', () => newRound({ clearScores: true }));

    globalScope.addEventListener('popstate', () => {
      const route = resolveAppRoute(globalScope.location.href);
      if (route.view === 'admin') {
        globalScope.location.replace('/admin/');
      } else if (route.view === 'game') {
        enterGame(route.gameType, { replaceUrl: true, roomCode: route.roomCode });
      } else if (route.view === 'games') {
        void showGameHome({ replaceUrl: true });
      } else void showGameHome({ replaceUrl: true });
    });

    if (initialRoute.view === 'game') {
      enterGame(initialRoute.gameType, {
        replaceUrl: true,
        roomCode: initialRoute.roomCode,
      });
    } else if (initialRoute.view === 'games') {
      void showGameHome({ replaceUrl: true });
    } else void showGameHome({ replaceUrl: true });
    accountPanel?.subscribe(({ identity, economySnapshot: nextEconomySnapshot }) => {
      accountIdentity = identity;
      economySnapshot = nextEconomySnapshot;
      if (state) render();
    });
    [gameEventPrimary, gameEventSecondary].forEach((button) => {
      button?.addEventListener('click', () => {
        const action = button.dataset.action;
        if (shouldDismissGameDialogAction(action)) {
          closeGameEventDialog({ dismiss: true });
        }
        if (action === 'restart') {
          if (state.gameMode === 'online') void requestOnlineRematch();
          else newRound();
        }
        if (action === 'accept-undo') void submitOnlineUndo('accept');
        if (action === 'reject-undo') void submitOnlineUndo('reject');
        if (action === 'accept-rematch') void requestOnlineRematch();
        if (action === 'reject-rematch') void declineOnlineRematch();
      });
    });
    gameEventDialog?.addEventListener('cancel', (event) => {
      if (!activeGameDialog?.dismissible) event.preventDefault();
      else closeGameEventDialog({ dismiss: true });
    });
    gameEventDialog?.addEventListener('click', (event) => {
      if (event.target === gameEventDialog && activeGameDialog?.dismissible) {
        closeGameEventDialog({ dismiss: true });
      }
    });
  }

  globalScope.GameApp = exported;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountGame, { once: true });
    } else {
      mountGame();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
