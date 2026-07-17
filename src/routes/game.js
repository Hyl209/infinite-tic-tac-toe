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

  function formatAdminCodeExpiry(value) {
    if (!value) return '永久有效';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间无效';
    return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
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
    getDefaultPlacementMode,
    getLocalUndoCount,
    getScoreKey,
    formatAdminCodeExpiry,
    formatOnlineScoreName,
    resolvePlacementSelection,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;

  function mountGame() {
    const home = document.querySelector('#game-home');
    const gameView = document.querySelector('#game-view');
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
    const acceptUndoButton = document.querySelector('#accept-undo-button');
    const rejectUndoButton = document.querySelector('#reject-undo-button');
    const cancelUndoButton = document.querySelector('#cancel-undo-button');
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
    const accountButton = document.querySelector('#account-button');
    const accountAvatar = document.querySelector('.account-avatar');
    const accountKindLabel = document.querySelector('#account-kind-label');
    const accountDisplayName = document.querySelector('#account-display-name');
    const accountCoinBalance = document.querySelector('#account-coin-balance');
    const accountDialog = document.querySelector('#account-dialog');
    const accountCloseButton = document.querySelector('#account-close-button');
    const accountDialogTitle = document.querySelector('#account-dialog-title');
    const accountDialogDescription = document.querySelector('#account-dialog-description');
    const accountAuthView = document.querySelector('#account-auth-view');
    const accountLoginTab = document.querySelector('#account-login-tab');
    const accountRegisterTab = document.querySelector('#account-register-tab');
    const accountLoginForm = document.querySelector('#account-login-form');
    const accountRegisterForm = document.querySelector('#account-register-form');
    const accountProfileForm = document.querySelector('#account-profile-form');
    const accountLogoutButton = document.querySelector('#account-logout-button');
    const accountMessage = document.querySelector('#account-message');
    const profileUsername = document.querySelector('#profile-username');
    const profileGameName = document.querySelector('#profile-game-name');
    const walletPanel = document.querySelector('#wallet-panel');
    const walletBalance = document.querySelector('#wallet-balance');
    const redeemCodeForm = document.querySelector('#redeem-code-form');
    const redeemCodeInput = document.querySelector('#redeem-code-input');
    const redeemMessage = document.querySelector('#redeem-message');
    const openAdminButton = document.querySelector('#open-admin-button');
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
    const adminView = document.querySelector('#admin-view');
    const adminBackButton = document.querySelector('#admin-back-button');
    const adminRedeemForm = document.querySelector('#admin-redeem-form');
    const adminGeneratedCode = document.querySelector('#admin-generated-code');
    const adminGeneratedCodeValue = document.querySelector('#admin-generated-code-value');
    const copyGeneratedCodeButton = document.querySelector('#copy-generated-code-button');
    const adminMessage = document.querySelector('#admin-message');
    const adminRedeemList = document.querySelector('#admin-redeem-list');
    const refreshAdminCodesButton = document.querySelector('#refresh-admin-codes-button');

    const onlineApi = globalScope.OnlineGame;
    const accountApi = globalScope.PlayerAccount;
    const economyApi = globalScope.PlayerEconomy;
    const accountClient = accountApi?.createAccountClient({
      config: globalScope.ONLINE_GAME_CONFIG,
      loadSupabase: onlineApi?.loadSupabaseSdk,
    });
    const economyClient = economyApi?.createEconomyClient({ accountClient });
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
    let onlineGame = null;
    let onlinePhase = 'idle';
    let onlineConnected = false;
    let onlineSubmitting = false;
    let onlineError = '';
    let pendingRoomPreview = null;
    let heartbeatTimer = null;
    let disconnectTimer = null;
    let disconnectDeadline = 0;
    let claimingDisconnect = false;
    let accountIdentity = accountClient?.getIdentity() || {
      kind: 'guest',
      username: null,
      displayName: '匿名玩家',
      needsProfile: false,
    };
    let accountBusy = false;
    let accountMode = 'login';
    let economySnapshot = economyClient?.getSnapshot() || {
      balance: 0,
      isAdmin: false,
      loaded: false,
    };
    let adminCodes = [];

    function setAccountMessage(message = '', stateName = '') {
      if (!accountMessage) return;
      accountMessage.textContent = message;
      accountMessage.dataset.state = stateName;
    }

    function setRedeemMessage(message = '', stateName = '') {
      if (!redeemMessage) return;
      redeemMessage.textContent = message;
      redeemMessage.dataset.state = stateName;
    }

    function setAdminMessage(message = '', stateName = '') {
      if (!adminMessage) return;
      adminMessage.textContent = message;
      adminMessage.dataset.state = stateName;
    }

    async function refreshEconomy({ reportError = false } = {}) {
      if (!economyClient) return economySnapshot;
      try {
        economySnapshot = await economyClient.refresh();
      } catch (error) {
        economySnapshot = {
          balance: 0,
          isAdmin: false,
          loaded: false,
        };
        if (reportError) setRedeemMessage(economyApi.mapEconomyError(error), 'error');
      }
      renderAccount();
      if (state) render();
      return economySnapshot;
    }

    function setAccountMode(mode, { clearMessage = true } = {}) {
      accountMode = mode === 'register' ? 'register' : 'login';
      const registering = accountMode === 'register';
      accountLoginForm.hidden = registering;
      accountRegisterForm.hidden = !registering;
      accountLoginTab.setAttribute('aria-selected', String(!registering));
      accountRegisterTab.setAttribute('aria-selected', String(registering));
      accountDialogTitle.textContent = registering ? '注册账号' : '登录账号';
      accountDialogDescription.textContent = registering
        ? '用户名用于登录，游戏名会显示给在线对手。'
        : '登录后，游戏名会同步到其他设备。';
      if (clearMessage) setAccountMessage();
    }

    function setAccountBusy(busy) {
      accountBusy = busy;
      accountDialog.querySelectorAll('button, input').forEach((control) => {
        control.disabled = busy;
      });
      accountDialog.setAttribute('aria-busy', String(busy));
    }

    function renderAccount() {
      if (!accountButton || !accountDialog) return;
      const registered = accountIdentity.kind === 'registered';
      accountAvatar.textContent = registered ? accountIdentity.displayName.slice(0, 1) : '游';
      accountKindLabel.textContent = registered ? '个人资料' : '游客身份';
      accountDisplayName.textContent = accountIdentity.displayName;
      accountCoinBalance.hidden = !registered;
      accountCoinBalance.textContent = `金币 ${economySnapshot.balance}`;
      accountAuthView.hidden = registered;
      accountProfileForm.hidden = !registered;
      walletPanel.hidden = !registered;
      walletBalance.textContent = String(economySnapshot.balance);
      openAdminButton.hidden = !registered || !economySnapshot.isAdmin;
      if (registered) {
        accountDialogTitle.textContent = '个人资料';
        accountDialogDescription.textContent = '修改后的游戏名会用于之后加入的在线房间。';
        profileUsername.textContent = accountIdentity.username;
        if (document.activeElement !== profileGameName) {
          profileGameName.value = accountIdentity.displayName;
        }
      } else {
        setAccountMode(accountMode, { clearMessage: false });
        document.querySelector('input[name="online-wager"][value="0"]').checked = true;
      }
      document.querySelectorAll('input[name="online-wager"]').forEach((input) => {
        input.disabled = !registered && input.value !== '0';
      });
      accountButton.disabled = accountBusy;
    }

    async function runAccountAction(action, successMessage) {
      if (!accountClient || accountBusy) return;
      setAccountBusy(true);
      setAccountMessage();
      try {
        accountIdentity = await action();
        await refreshEconomy();
        renderAccount();
        setAccountMessage(successMessage, 'success');
      } catch (error) {
        setAccountMessage(accountApi.mapAccountError(error), 'error');
      } finally {
        setAccountBusy(false);
        renderAccount();
      }
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

    function updateUrl(roomCode = null, replace = true) {
      if (!globalScope.history?.pushState) return;
      const url = new URL(globalScope.location.href);
      if (gameType) url.searchParams.set('game', gameType);
      else url.searchParams.delete('game');
      if (roomCode) url.searchParams.set('room', roomCode);
      else url.searchParams.delete('room');
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
      const showRequest = state.gameMode === 'online' && Boolean(request);
      onlineUndoRequest.hidden = !showRequest;
      if (!showRequest) return;
      const ownRequest = request.requesterMark === onlineGame.playerMark;
      const opponentMark = onlineGame.playerMark === 'X' ? 'O' : 'X';
      const requesterName = onlineGame.playerNames?.[request.requesterMark] || '对方';
      const opponentName = onlineGame.playerNames?.[opponentMark] || '对方';
      const seconds = Math.max(1, Math.ceil((Date.parse(request.expiresAt) - Date.now()) / 1000));
      onlineUndoMessage.textContent = ownRequest
        ? `等待${opponentName}回应，${seconds} 秒后自动取消`
        : `${requesterName}申请撤回最近一手，剩余 ${seconds} 秒`;
      acceptUndoButton.hidden = ownRequest;
      rejectUndoButton.hidden = ownRequest;
      cancelUndoButton.hidden = !ownRequest;
      undoRenderTimer = setTimeout(render, Math.min(1000, seconds * 1000));
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
      statusText.textContent = statusMessage();
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
        const worker = new Worker('src/workers/gomoku-ai-worker.js');
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
        onlineGame = game;
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
        updateUrl(game.roomCode);
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
        updateUrl(game.roomCode);
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

    async function leaveOnlineRoom() {
      if (!onlineClient || onlineSubmitting || !onlineGame) return;
      onlineSubmitting = true;
      onlineError = '';
      render();
      try {
        await onlineClient.leaveRoom();
        stopOnlineRuntime();
        onlineGame = null;
        onlineConnected = false;
        onlinePhase = 'idle';
        state = createState({
          gameMode: 'online',
          difficulty: selectedValue('difficulty') || 'normal',
          firstPlayer: 'player',
        });
        pendingRoomPreview = null;
        await refreshEconomy();
        updateUrl(null);
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

    function renderAdminCodes() {
      adminRedeemList.textContent = '';
      if (adminCodes.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'admin-empty-state';
        empty.textContent = '还没有兑换码，先生成一个。';
        adminRedeemList.append(empty);
        return;
      }
      const fragment = document.createDocumentFragment();
      adminCodes.forEach((code) => {
        const row = document.createElement('article');
        row.className = 'admin-code-row';
        const expired = code.expiresAt && Date.parse(code.expiresAt) <= Date.now();
        const exhausted = code.claimCount >= code.maxClaims;
        const status = !code.active ? '已停用' : expired ? '已过期' : exhausted ? '已领完' : '可领取';

        const main = document.createElement('div');
        const hint = document.createElement('strong');
        hint.textContent = code.codeHint;
        const meta = document.createElement('span');
        meta.textContent = `${code.amount} 金币 · ${code.claimCount}/${code.maxClaims} 人 · ${formatAdminCodeExpiry(code.expiresAt)} · ${status}`;
        main.append(hint, meta);

        const disableButton = document.createElement('button');
        disableButton.type = 'button';
        disableButton.className = 'button secondary';
        disableButton.dataset.disableCode = code.id;
        disableButton.textContent = '停用';
        disableButton.disabled = !code.active;
        row.append(main, disableButton);
        fragment.append(row);
      });
      adminRedeemList.append(fragment);
    }

    async function loadAdminCodes() {
      if (!economyClient || !economySnapshot.isAdmin) return;
      setAdminMessage('正在加载兑换码');
      try {
        adminCodes = await economyClient.listRedeemCodes();
        setAdminMessage();
        renderAdminCodes();
      } catch (error) {
        setAdminMessage(economyApi.mapEconomyError(error), 'error');
      }
    }

    function showAdminView() {
      if (!economySnapshot.isAdmin) return;
      if (accountDialog?.open) accountDialog.close();
      home.hidden = true;
      gameView.hidden = true;
      adminView.hidden = false;
      void loadAdminCodes();
    }

    async function createAdminRedeemCode() {
      if (!economyClient || !economySnapshot.isAdmin) return;
      const data = new FormData(adminRedeemForm);
      const expiryValue = String(data.get('expiresAt') || '');
      const expiresAt = expiryValue ? new Date(expiryValue).toISOString() : null;
      setAdminMessage('正在生成兑换码');
      try {
        const code = await economyClient.createRedeemCode({
          amount: Number(data.get('amount')),
          maxClaims: Number(data.get('maxClaims')),
          expiresAt,
        });
        adminGeneratedCodeValue.textContent = code.code;
        adminGeneratedCode.hidden = false;
        setAdminMessage('兑换码已生成，请立即复制保存', 'success');
        await loadAdminCodes();
      } catch (error) {
        setAdminMessage(economyApi.mapEconomyError(error), 'error');
      }
    }

    async function disableAdminRedeemCode(id) {
      if (!economyClient || !economySnapshot.isAdmin) return;
      try {
        await economyClient.disableRedeemCode(id);
        setAdminMessage('兑换码已停用', 'success');
        await loadAdminCodes();
      } catch (error) {
        setAdminMessage(economyApi.mapEconomyError(error), 'error');
      }
    }

    async function redeemCoins() {
      if (!economyClient || accountBusy) return;
      setAccountBusy(true);
      setRedeemMessage();
      try {
        const result = await economyClient.redeemCode(redeemCodeInput.value);
        economySnapshot = { ...economySnapshot, balance: result.balance, loaded: true };
        redeemCodeInput.value = '';
        setRedeemMessage(`已领取 ${result.grantedAmount} 金币`, 'success');
      } catch (error) {
        setRedeemMessage(economyApi.mapEconomyError(error), 'error');
      } finally {
        setAccountBusy(false);
        renderAccount();
        if (state) render();
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
        if (action === 'cancel') await onlineClient.cancelUndo();
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
      adminView.hidden = true;
      home.hidden = true;
      gameView.hidden = false;
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
      updateUrl(roomCode, replaceUrl);
      if (roomCode) {
        document.querySelector('input[name="game-mode"][value="online"]').checked = true;
        roomCodeInput.value = roomCode;
      }
      newRound();
      if (roomCode) void previewOnlineRoom(roomCode);
    }

    async function showHome({ replaceUrl = false } = {}) {
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
      pendingRoomPreview = null;
      gameType = null;
      state = null;
      selectedCandidate = null;
      gameView.hidden = true;
      adminView.hidden = true;
      home.hidden = false;
      updateUrl(null, replaceUrl);
    }

    document.querySelectorAll('[data-game-type]').forEach((button) => {
      button.addEventListener('click', () => enterGame(button.dataset.gameType));
    });
    accountButton?.addEventListener('click', () => {
      renderAccount();
      if (accountIdentity.kind === 'registered') void refreshEconomy({ reportError: true });
      if (!accountClient?.isConfigured()) {
        setAccountMessage('账号服务尚未配置，游客仍可使用本地模式', 'error');
      }
      accountDialog.showModal();
    });
    accountCloseButton?.addEventListener('click', () => accountDialog.close());
    accountLoginTab?.addEventListener('click', () => setAccountMode('login'));
    accountRegisterTab?.addEventListener('click', () => setAccountMode('register'));
    accountLoginForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(accountLoginForm);
      void runAccountAction(() => accountClient.login({
        username: data.get('username'),
        password: data.get('password'),
      }), '登录成功');
    });
    accountRegisterForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(accountRegisterForm);
      void runAccountAction(() => accountClient.register({
        username: data.get('username'),
        password: data.get('password'),
        gameName: data.get('gameName'),
      }), '注册成功');
    });
    accountProfileForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(accountProfileForm);
      void runAccountAction(
        () => accountClient.updateGameName(data.get('gameName')),
        '游戏名已保存',
      );
    });
    accountLogoutButton?.addEventListener('click', () => {
      void runAccountAction(() => accountClient.logout(), '已退出账号');
    });
    redeemCodeForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void redeemCoins();
    });
    redeemCodeInput?.addEventListener('input', () => {
      redeemCodeInput.value = economyApi.formatRedeemCode(redeemCodeInput.value);
      setRedeemMessage();
    });
    openAdminButton?.addEventListener('click', showAdminView);
    accountDialog?.addEventListener('click', (event) => {
      if (event.target === accountDialog) accountDialog.close();
    });
    adminBackButton?.addEventListener('click', () => void showHome());
    adminRedeemForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void createAdminRedeemCode();
    });
    copyGeneratedCodeButton?.addEventListener('click', async () => {
      const code = adminGeneratedCodeValue.textContent;
      if (!code) return;
      try {
        await globalScope.navigator.clipboard.writeText(code);
        setAdminMessage('兑换码已复制', 'success');
      } catch {
        setAdminMessage(`请手动复制：${code}`, 'error');
      }
    });
    refreshAdminCodesButton?.addEventListener('click', () => void loadAdminCodes());
    adminRedeemList?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-disable-code]');
      if (button) void disableAdminRedeemCode(button.dataset.disableCode);
    });
    backHomeButton.addEventListener('click', () => void showHome());
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

    roomCodeInput.addEventListener('input', () => {
      roomCodeInput.value = onlineApi.normalizeRoomCode(roomCodeInput.value);
      pendingRoomPreview = null;
      onlineError = '';
      render();
    });
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
    acceptUndoButton.addEventListener('click', () => void submitOnlineUndo('accept'));
    rejectUndoButton.addEventListener('click', () => void submitOnlineUndo('reject'));
    cancelUndoButton.addEventListener('click', () => void submitOnlineUndo('cancel'));
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
      const url = new URL(globalScope.location.href);
      const requestedGame = url.searchParams.get('game');
      if (GAME_TYPES.includes(requestedGame)) enterGame(requestedGame, { replaceUrl: true });
      else void showHome({ replaceUrl: true });
    });

    const initialUrl = new URL(globalScope.location.href);
    const requestedRoom = onlineApi?.normalizeRoomCode(initialUrl.searchParams.get('room'));
    const requestedGame = initialUrl.searchParams.get('game') || (requestedRoom ? 'tic_tac_toe' : null);
    if (GAME_TYPES.includes(requestedGame)) {
      enterGame(requestedGame, {
        replaceUrl: true,
        roomCode: onlineApi?.isValidRoomCode(requestedRoom) ? requestedRoom : null,
      });
    }
    accountClient?.subscribe((identity) => {
      accountIdentity = identity;
      renderAccount();
      void refreshEconomy();
    });
    economyClient?.subscribe((snapshot) => {
      economySnapshot = snapshot;
      renderAccount();
      if (state) render();
    });
    renderAccount();
    if (accountClient?.isConfigured()) {
      void accountClient.initialize().then((identity) => {
        accountIdentity = identity;
        renderAccount();
        return refreshEconomy();
      }).catch((error) => {
        setAccountMessage(accountApi.mapAccountError(error), 'error');
      });
    }
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
