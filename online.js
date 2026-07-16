(function initOnlineGame(globalScope) {
  'use strict';

  const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ERROR_MESSAGES = {
    ONLINE_NOT_CONFIGURED: '线上服务尚未配置',
    INVALID_ROOM_CODE: '请输入正确的六位房间码',
    ROOM_NOT_FOUND: '房间不存在',
    ROOM_FULL: '房间已满',
    ROOM_GAME_MISMATCH: '这个房间属于另一种游戏',
    ROOM_EXPIRED: '房间已过期',
    NOT_YOUR_TURN: '还没轮到你',
    CELL_OCCUPIED: '这个格子已经有棋子',
    GAME_NOT_PLAYING: '对局尚未开始或已经结束',
    NOT_A_PLAYER: '你不是这个房间的玩家',
    UNDO_PENDING: '正在等待悔棋回应',
    UNDO_NOT_PENDING: '当前没有待处理的悔棋请求',
    UNDO_NOT_REQUESTER: '只有发起方可以取消悔棋',
    UNDO_LIMIT_REACHED: '本局悔棋次数已经用完',
    UNDO_EXPIRED: '悔棋请求已经超时',
    NOTHING_TO_UNDO: '当前没有可以撤回的落子',
  };

  function normalizeRoomCode(value) {
    return String(value || '')
      .toUpperCase()
      .split('')
      .filter((character) => ROOM_ALPHABET.includes(character))
      .join('')
      .slice(0, 6);
  }

  function isValidRoomCode(value) {
    const normalized = normalizeRoomCode(value);
    return normalized.length === 6 && normalized === String(value || '').toUpperCase();
  }

  function mapOnlineGame(row, userId, { opponentOnline = false } = {}) {
    const playerMark = row.x_player === userId
      ? 'X'
      : row.o_player === userId
        ? 'O'
        : null;

    return {
      gameMode: 'online',
      gameType: row.game_type,
      roomId: row.id,
      roomCode: row.room_code,
      playerMark,
      status: row.status,
      board: [...row.board],
      moveOrders: {
        X: [...row.x_order],
        O: [...row.o_order],
      },
      moveHistory: [...row.move_history],
      currentMark: row.current_mark,
      winningLine: [...row.winning_line],
      scores: { X: row.x_score, O: row.o_score },
      round: row.round,
      rematchReady: { X: row.x_rematch, O: row.o_rematch },
      undoRemaining: {
        X: row.x_undos_remaining,
        O: row.o_undos_remaining,
      },
      undoRequest: row.undo_request_mark && row.undo_expires_at
        ? {
          requesterMark: row.undo_request_mark,
          expiresAt: row.undo_expires_at,
        }
        : null,
      opponentOnline,
      version: row.version,
    };
  }

  function canOnlineMove(game, index, { connected, submitting }) {
    const undoPending = game?.undoRequest?.expiresAt
      && Date.parse(game.undoRequest.expiresAt) > Date.now();
    return Boolean(
      game
      && connected
      && !submitting
      && !undoPending
      && game.status === 'playing'
      && game.playerMark
      && game.currentMark === game.playerMark
      && Number.isInteger(index)
      && index >= 0
      && index < game.board.length
      && game.board[index] === null,
    );
  }

  function mapOnlineError(error) {
    const message = error?.message || String(error || '');
    const code = Object.keys(ERROR_MESSAGES).find((item) => message.includes(item));
    return code
      ? ERROR_MESSAGES[code]
      : '线上服务暂时不可用，请稍后重试';
  }

  function buildInviteUrl(currentUrl, roomCode, gameType = 'tic_tac_toe') {
    const url = new URL(currentUrl);
    url.searchParams.set('game', gameType);
    url.searchParams.set('room', normalizeRoomCode(roomCode));
    return url.toString();
  }

  function getOnlineStatusMessage({
    phase = 'idle',
    game = null,
    connected = false,
    submitting = false,
    error = '',
    displayMark = (mark) => mark,
  } = {}) {
    if (error) return error;
    if (submitting || phase === 'connecting') return '正在连接线上房间';
    if (!game) return '创建房间或输入房间码加入好友';
    if (game.status === 'waiting') return '等待对手加入房间';
    if (game.status === 'abandoned') return '对手已退出房间';
    if (!connected) return '连接中断，正在等待恢复';

    if (game.status === 'playing') {
      if (!game.opponentOnline) return '对手离线，棋局已保留';
      return game.currentMark === game.playerMark
        ? `轮到你落子，你是 ${displayMark(game.playerMark)}`
        : `等待对手落子，你是 ${displayMark(game.playerMark)}`;
    }

    if (game.status === 'x_win' || game.status === 'o_win') {
      if (game.rematchReady?.[game.playerMark]) {
        return '等待对手确认再来一局';
      }

      const opponentMark = game.playerMark === 'X' ? 'O' : 'X';
      if (game.rematchReady?.[opponentMark]) return '对手已申请再来一局';
      const winner = game.status === 'x_win' ? 'X' : 'O';
      return winner === game.playerMark ? '你赢了！漂亮的一局' : '对手赢了，再来一局';
    }

    if (game.status === 'draw') {
      if (game.rematchReady?.[game.playerMark]) return '等待对手确认再来一局';
      return '本局平局，再来一局';
    }

    return '线上棋局状态已更新';
  }

  async function loadSupabaseSdk({
    documentObject = globalScope.document,
    browser = globalScope,
  } = {}) {
    if (browser.supabase?.createClient) return browser.supabase;

    return new Promise((resolve, reject) => {
      const script = documentObject.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      script.async = true;
      script.onload = () => resolve(browser.supabase);
      script.onerror = () => reject(new Error('SUPABASE_SDK_LOAD_FAILED'));
      documentObject.head.append(script);
    });
  }

  function firstRpcRow(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function createOnlineClient({
    config = globalScope.ONLINE_GAME_CONFIG || {},
    loadSupabase = loadSupabaseSdk,
    onState = () => {},
    onConnection = () => {},
    onPresence = () => {},
    onError = () => {},
  } = {}) {
    let supabase = null;
    let user = null;
    let roomChannel = null;
    let currentRow = null;
    let currentGame = null;
    let connected = false;
    let opponentOnline = false;

    function isConfigured() {
      return Boolean(config.supabaseUrl && config.supabaseAnonKey);
    }

    function emitState() {
      if (!currentRow || !user) return null;
      currentGame = mapOnlineGame(currentRow, user.id, { opponentOnline });
      onState(currentGame);
      return currentGame;
    }

    function acceptRow(row) {
      if (!row) return currentGame;
      if (currentRow && row.version < currentRow.version) return currentGame;
      currentRow = row;
      return emitState();
    }

    async function connect() {
      if (supabase && user) return user;
      if (!isConfigured()) throw new Error('ONLINE_NOT_CONFIGURED');

      const sdk = await loadSupabase();
      supabase = sdk.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      });

      const sessionResult = await supabase.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      user = sessionResult.data.session?.user || null;

      if (!user) {
        const signInResult = await supabase.auth.signInAnonymously();
        if (signInResult.error) throw signInResult.error;
        user = signInResult.data.user;
      }

      return user;
    }

    async function disconnect() {
      if (roomChannel && supabase) {
        await supabase.removeChannel(roomChannel);
      }
      roomChannel = null;
      connected = false;
      opponentOnline = false;
      onConnection(false);
      onPresence(false);
    }

    async function subscribeToRoom(row) {
      if (roomChannel) await disconnect();
      currentRow = row;
      emitState();

      const channelName = `room:${row.id}`;
      roomChannel = supabase.channel(channelName, {
        config: {
          private: true,
          presence: { key: user.id },
        },
      });

      roomChannel
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'online_games',
          filter: `id=eq.${row.id}`,
        }, (payload) => {
          acceptRow(payload.new);
        })
        .on('presence', { event: 'sync' }, () => {
          const presence = roomChannel.presenceState();
          opponentOnline = Object.keys(presence).some((key) => key !== user.id);
          onPresence(opponentOnline);
          emitState();
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            connected = true;
            onConnection(true);
            roomChannel.track({
              user_id: user.id,
              mark: currentGame?.playerMark,
            }).catch(onError);
            return;
          }

          if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
            connected = false;
            opponentOnline = false;
            onConnection(false);
            onPresence(false);
            emitState();
          }
        });
    }

    async function callRpc(name, params) {
      await connect();
      const result = await supabase.rpc(name, params);
      if (result.error) throw result.error;
      return firstRpcRow(result.data);
    }

    async function createRoom(gameType = 'tic_tac_toe') {
      const row = await callRpc('create_online_game', { p_game_type: gameType });
      await subscribeToRoom(row);
      return currentGame;
    }

    async function joinRoom(roomCode, gameType = 'tic_tac_toe') {
      const normalized = normalizeRoomCode(roomCode);
      if (!isValidRoomCode(normalized)) throw new Error('INVALID_ROOM_CODE');
      const row = await callRpc('join_online_game', {
        p_room_code: normalized,
        p_game_type: gameType,
      });
      await subscribeToRoom(row);
      return currentGame;
    }

    async function makeMove(index) {
      if (!currentRow) throw new Error('ROOM_NOT_FOUND');
      const row = await callRpc('play_online_move', {
        p_game_id: currentRow.id,
        p_cell: index,
      });
      return acceptRow(row);
    }

    async function requestRematch() {
      if (!currentRow) throw new Error('ROOM_NOT_FOUND');
      const row = await callRpc('request_online_rematch', {
        p_game_id: currentRow.id,
      });
      return acceptRow(row);
    }

    async function requestUndo() {
      if (!currentRow) throw new Error('ROOM_NOT_FOUND');
      const row = await callRpc('request_online_undo', { p_game_id: currentRow.id });
      return acceptRow(row);
    }

    async function respondUndo(accept) {
      if (!currentRow) throw new Error('ROOM_NOT_FOUND');
      const row = await callRpc('respond_online_undo', {
        p_game_id: currentRow.id,
        p_accept: Boolean(accept),
      });
      return acceptRow(row);
    }

    async function cancelUndo() {
      if (!currentRow) throw new Error('ROOM_NOT_FOUND');
      const row = await callRpc('cancel_online_undo', { p_game_id: currentRow.id });
      return acceptRow(row);
    }

    async function leaveRoom() {
      if (!currentRow) return;
      await callRpc('leave_online_game', { p_game_id: currentRow.id });
      await disconnect();
      currentRow = null;
      currentGame = null;
    }

    return {
      connect,
      cancelUndo,
      createRoom,
      disconnect,
      isConfigured,
      joinRoom,
      leaveRoom,
      makeMove,
      requestUndo,
      requestRematch,
      respondUndo,
    };
  }

  const onlineGame = {
    ROOM_ALPHABET,
    buildInviteUrl,
    canOnlineMove,
    createOnlineClient,
    getOnlineStatusMessage,
    isValidRoomCode,
    loadSupabaseSdk,
    mapOnlineError,
    mapOnlineGame,
    normalizeRoomCode,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = onlineGame;
  }

  globalScope.OnlineGame = onlineGame;
})(typeof window !== 'undefined' ? window : globalThis);
