(function initOnlineGame(globalScope) {
  'use strict';

  const SUPABASE_SDK_LOADS = new WeakMap();

  const roomCodeUtils = typeof module !== 'undefined' && module.exports
    ? require('../utils/room-code.js')
    : globalScope.RoomCodeUtils;
  const { ROOM_ALPHABET, isValidRoomCode, normalizeRoomCode } = roomCodeUtils;
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
    REGISTERED_ACCOUNT_REQUIRED: '有彩头的房间仅限注册玩家',
    INVALID_WAGER: '请选择正确的彩头金额',
    INSUFFICIENT_COINS: '金币不足',
    OPPONENT_STILL_ONLINE: '对手仍在线，暂时不能判负',
    REMATCH_NOT_PENDING: '当前没有待处理的再来一局申请',
  };

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
      playerNames: {
        X: row.x_player_name,
        O: row.o_player_name,
      },
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
      wagerAmount: Number(row.wager_amount || 0),
      stakeLocked: {
        X: Boolean(row.x_stake_locked),
        O: Boolean(row.o_stake_locked),
      },
      wagerSettledAt: row.wager_settled_at || null,
      finishReason: row.finish_reason || null,
      lastSeenAt: {
        X: row.x_last_seen_at || null,
        O: row.o_last_seen_at || null,
      },
      opponentOnline,
      version: row.version,
    };
  }

  function mapRoomPreview(row) {
    return {
      gameType: row.game_type,
      hostName: row.host_name,
      wagerAmount: Number(row.wager_amount || 0),
      status: row.status,
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
    const ownName = game.playerNames?.[game.playerMark] || '你';
    const opponentMark = game.playerMark === 'X' ? 'O' : 'X';
    const opponentName = game.playerNames?.[opponentMark] || '对手';
    if (game.status === 'waiting') {
      return game.playerNames?.X ? `等待对手加入，${game.playerNames.X}执 X` : '等待对手加入房间';
    }
    if (game.status === 'abandoned') return `${opponentName}已退出房间`;
    if (!connected) return '连接中断，正在等待恢复';

    if (game.status === 'playing') {
      if (!game.opponentOnline) return `${opponentName}离线，棋局已保留`;
      return game.currentMark === game.playerMark
        ? `轮到你（${ownName}）落子`
        : `等待 ${opponentName} 落子`;
    }

    if (game.status === 'x_win' || game.status === 'o_win') {
      if (game.rematchReady?.[game.playerMark]) {
        return `等待${opponentName}确认再来一局`;
      }

      if (game.rematchReady?.[opponentMark]) return `${opponentName}已申请再来一局`;
      const winner = game.status === 'x_win' ? 'X' : 'O';
      const winnerName = game.playerNames?.[winner] || (winner === game.playerMark ? ownName : opponentName);
      if (game.finishReason === 'disconnect') return `${winnerName}因对手掉线获胜`;
      if (game.finishReason === 'active_exit') return `${winnerName}因对手退出获胜`;
      return `${winnerName}获胜`;
    }

    if (game.status === 'draw') {
      if (game.rematchReady?.[game.playerMark]) return `等待${opponentName}确认再来一局`;
      return '平局';
    }

    return '线上棋局状态已更新';
  }

  async function loadSupabaseSdk({
    documentObject = globalScope.document,
    browser = globalScope,
  } = {}) {
    if (browser.supabase?.createClient) return browser.supabase;
    if (SUPABASE_SDK_LOADS.has(browser)) return SUPABASE_SDK_LOADS.get(browser);

    const loading = new Promise((resolve, reject) => {
      const script = documentObject.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      script.async = true;
      script.onload = () => {
        if (browser.supabase?.createClient) resolve(browser.supabase);
        else reject(new Error('SUPABASE_SDK_LOAD_FAILED'));
      };
      script.onerror = () => {
        script.remove?.();
        reject(new Error('SUPABASE_SDK_LOAD_FAILED'));
      };
      documentObject.head.append(script);
    }).catch((error) => {
      SUPABASE_SDK_LOADS.delete(browser);
      throw error;
    });
    SUPABASE_SDK_LOADS.set(browser, loading);
    return loading;
  }

  function firstRpcRow(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function createOnlineClient({
    accountClient = null,
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
    let playerName = '';

    function isConfigured() {
      return Boolean(accountClient?.isConfigured());
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
      if (!accountClient) throw new Error('ONLINE_NOT_CONFIGURED');
      const session = await accountClient.ensureOnlineIdentity();
      supabase = session.supabase;
      user = session.user;
      playerName = session.identity.displayName;
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
              display_name: playerName,
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

    async function createRoom(gameType = 'tic_tac_toe', wagerAmount = 0) {
      await connect();
      const row = await callRpc('create_online_game', {
        p_game_type: gameType,
        p_guest_name: playerName,
        p_wager_amount: Number(wagerAmount),
      });
      await subscribeToRoom(row);
      return currentGame;
    }

    async function previewRoom(roomCode, gameType = 'tic_tac_toe') {
      const normalized = normalizeRoomCode(roomCode);
      if (!isValidRoomCode(normalized)) throw new Error('INVALID_ROOM_CODE');
      const row = await callRpc('preview_online_game', {
        p_room_code: normalized,
        p_game_type: gameType,
      });
      return mapRoomPreview(row);
    }

    async function joinRoom(roomCode, gameType = 'tic_tac_toe') {
      const normalized = normalizeRoomCode(roomCode);
      if (!isValidRoomCode(normalized)) throw new Error('INVALID_ROOM_CODE');
      await connect();
      const row = await callRpc('join_online_game', {
        p_room_code: normalized,
        p_game_type: gameType,
        p_guest_name: playerName,
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

    async function declineRematch() {
      if (!currentRow) throw new Error('ROOM_NOT_FOUND');
      const row = await callRpc('decline_online_rematch', {
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

    async function heartbeat() {
      if (!currentRow) throw new Error('ROOM_NOT_FOUND');
      const row = await callRpc('heartbeat_online_game', { p_game_id: currentRow.id });
      return acceptRow(row);
    }

    async function claimDisconnect() {
      if (!currentRow) throw new Error('ROOM_NOT_FOUND');
      const row = await callRpc('claim_online_disconnect', { p_game_id: currentRow.id });
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
      claimDisconnect,
      createRoom,
      declineRematch,
      disconnect,
      heartbeat,
      isConfigured,
      joinRoom,
      leaveRoom,
      makeMove,
      previewRoom,
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
    mapRoomPreview,
    normalizeRoomCode,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = onlineGame;
  }

  globalScope.OnlineGame = onlineGame;
})(typeof window !== 'undefined' ? window : globalThis);
