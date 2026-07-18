(function initPlayerFriends(globalScope) {
  'use strict';

  const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
  const PLAYER_UID_PATTERN = /^\d{6}$/;
  const ERROR_MESSAGES = {
    ACCOUNT_CLIENT_REQUIRED: '缺少账号客户端',
    REGISTERED_ACCOUNT_REQUIRED: '请先登录正式账号',
    INVALID_USERNAME: '请输入完整用户名，需为 3 至 20 位英文、数字或下划线',
    INVALID_PLAYER_UID: '玩家 UID 必须是 6 位数字',
    PLAYER_NOT_FOUND: '没有找到该玩家',
    PLAYER_UID_EXHAUSTED: '玩家 UID 已发放完毕，请联系管理员',
    PLAYER_UID_IMMUTABLE: '玩家 UID 不可修改',
    CANNOT_FRIEND_SELF: '不能添加自己为好友',
    FRIEND_REQUEST_EXISTS: '好友申请已存在',
    ALREADY_FRIENDS: '你们已经是好友',
    FRIEND_REQUEST_NOT_FOUND: '好友申请不存在',
    FRIEND_REQUEST_NOT_RECIPIENT: '只有收件人可以处理该申请',
    FRIENDSHIP_NOT_FOUND: '好友关系不存在',
    NOT_FRIENDS: '只能邀请已添加的好友',
    ROOM_NOT_FOUND: '房间不存在',
    ROOM_EXPIRED: '房间已过期',
    ROOM_FULL: '房间已满',
    ROOM_NOT_WAITING: '房间已不在等待对手',
    NOT_ROOM_OWNER: '只有房主可以邀请好友',
    GAME_INVITE_EXISTS: '该房间已有待处理邀请',
    GAME_INVITE_NOT_FOUND: '游戏邀请不存在或已处理',
    GAME_INVITE_EXPIRED: '游戏邀请已过期',
    GAME_INVITE_NOT_SENDER: '只有发送者可以取消邀请',
    GAME_INVITE_NOT_RECIPIENT: '只有接收者可以拒绝邀请',
  };

  function errorCode(error) {
    const text = [error?.code, error?.message, error?.details, error?.hint]
      .filter(Boolean).join(' ');
    return Object.keys(ERROR_MESSAGES).find((code) => text.includes(code));
  }

  function mapFriendsError(error) {
    return ERROR_MESSAGES[errorCode(error)] || '好友服务暂时不可用，请稍后重试';
  }

  function fail(code) {
    throw new Error(code);
  }

  function formatPlayerUid(value) {
    const uid = Number(value);
    if (!Number.isInteger(uid) || uid < 0 || uid > 999999) fail('INVALID_PLAYER_UID');
    return String(uid).padStart(6, '0');
  }

  function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
  }

  function firstRpcRow(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function registeredIdentityKey(identity = {}) {
    return `registered:${identity.uid ?? identity.userId ?? identity.id ?? identity.username ?? ''}`;
  }

  function mapPlayer(row, prefix = '') {
    return {
      id: prefix ? (row?.[`${prefix}id`] ?? null) : (row?.user_id ?? row?.id ?? null),
      uid: formatPlayerUid(row?.[`${prefix}player_uid`]),
      username: row?.[`${prefix}username`] ?? null,
      displayName: row?.[`${prefix}game_name`] ?? null,
    };
  }

  function mapSearchResult(row) {
    if (!row) return null;
    return {
      ...mapPlayer(row),
      relationshipState: row.relationship_state || 'none',
    };
  }

  function mapFriend(row) {
    return {
      ...mapPlayer(row),
      online: Boolean(row?.online),
      lastSeenAt: row?.last_seen_at ?? null,
    };
  }

  function mapRequest(row) {
    return {
      id: row?.id ?? null,
      direction: row?.direction === 'incoming' ? 'incoming' : 'outgoing',
      player: {
        id: row?.other_user_id ?? null,
        uid: formatPlayerUid(row?.other_player_uid),
        username: row?.other_username ?? null,
        displayName: row?.other_game_name ?? null,
      },
      createdAt: row?.created_at ?? null,
    };
  }

  function mapInvite(row) {
    return {
      id: row?.id ?? null,
      gameId: row?.game_id ?? null,
      gameType: row?.game_type ?? null,
      roomCode: row?.room_code ?? null,
      wagerAmount: Number(row?.wager_amount || 0),
      sender: mapPlayer(row, 'sender_'),
      recipient: mapPlayer(row, 'recipient_'),
      direction: row?.direction === 'incoming' ? 'incoming' : 'outgoing',
      status: row?.status ?? null,
      expiresAt: row?.expires_at ?? null,
      createdAt: row?.created_at ?? null,
    };
  }

  function createFriendsClient({
    accountClient,
    documentObject = globalScope.document,
    setIntervalFn = globalScope.setInterval?.bind(globalScope),
    clearIntervalFn = globalScope.clearInterval?.bind(globalScope),
    autoStart = true,
  } = {}) {
    if (!accountClient
      || typeof accountClient.getIdentity !== 'function'
      || typeof accountClient.getSupabaseClient !== 'function') {
      fail('ACCOUNT_CLIENT_REQUIRED');
    }

    const listeners = new Set();
    let channel = null;
    let channelSupabase = null;
    let channelVersion = 0;
    let presenceTimer = null;
    let unsubscribeIdentity = null;
    let destroyed = false;

    function requireRegistered() {
      const identity = accountClient.getIdentity();
      if (!identity || identity.kind !== 'registered') fail('REGISTERED_ACCOUNT_REQUIRED');
      return identity;
    }

    async function getSupabaseClient() {
      const client = await accountClient.getSupabaseClient();
      if (!client || typeof client.rpc !== 'function') fail('ACCOUNT_CLIENT_REQUIRED');
      return client;
    }

    async function callRpc(name, params) {
      const identityKey = registeredIdentityKey(requireRegistered());
      const client = await getSupabaseClient();
      if (registeredIdentityKey(requireRegistered()) !== identityKey) fail('ACCOUNT_IDENTITY_CHANGED');
      const result = await client.rpc(name, params);
      if (result?.error) throw result.error;
      return result?.data;
    }

    async function searchExact(value) {
      requireRegistered();
      const input = String(value || '').trim();
      const data = PLAYER_UID_PATTERN.test(input)
        ? await callRpc('search_player_by_uid', { p_player_uid: Number(input) })
        : await (async () => {
          const username = normalizeUsername(input);
          if (!USERNAME_PATTERN.test(username)) fail('INVALID_USERNAME');
          return callRpc('search_player_by_username', { p_username: username });
        })();
      return mapSearchResult(firstRpcRow(data));
    }

    async function listFriends() {
      return (await callRpc('list_friends', undefined) || []).map(mapFriend);
    }

    async function listRequests() {
      return (await callRpc('list_friend_requests', undefined) || []).map(mapRequest);
    }

    async function sendRequest(userId) {
      return firstRpcRow(await callRpc('send_friend_request', { p_recipient_id: userId }));
    }

    async function acceptRequest(requestId) {
      return firstRpcRow(await callRpc('accept_friend_request', { p_request_id: requestId }));
    }

    async function rejectRequest(requestId) {
      return firstRpcRow(await callRpc('reject_friend_request', { p_request_id: requestId }));
    }

    async function removeFriend(userId) {
      return firstRpcRow(await callRpc('remove_friend', { p_friend_id: userId }));
    }

    async function heartbeat() {
      return firstRpcRow(await callRpc('heartbeat_player_presence', undefined));
    }

    async function listInvites() {
      return (await callRpc('list_game_invites', undefined) || []).map(mapInvite);
    }

    async function sendGameInvite(gameId, friendId) {
      return firstRpcRow(await callRpc('send_game_invite', {
        p_game_id: gameId,
        p_recipient_id: friendId,
      }));
    }

    async function cancelGameInvite(inviteId) {
      return firstRpcRow(await callRpc('cancel_game_invite', { p_invite_id: inviteId }));
    }

    async function declineGameInvite(inviteId) {
      return firstRpcRow(await callRpc('decline_game_invite', { p_invite_id: inviteId }));
    }

    function notifyChanged() {
      [...listeners].forEach((listener) => {
        try { listener({ type: 'changed' }); } catch { /* Keep notifying. */ }
      });
    }

    async function removeChannel(target = channel, supabase = channelSupabase) {
      if (target && supabase?.removeChannel) await supabase.removeChannel(target);
      if (target === channel) {
        channel = null;
        channelSupabase = null;
      }
    }

    async function replaceChannel() {
      const version = ++channelVersion;
      await removeChannel();
      if (destroyed || listeners.size === 0 || accountClient.getIdentity()?.kind !== 'registered') return;
      const supabase = await getSupabaseClient();
      if (destroyed || version !== channelVersion || listeners.size === 0) return;
      const nextChannel = supabase.channel('player-social');
      nextChannel.on('postgres_changes', {
        event: '*', schema: 'public', table: 'friend_requests',
      }, notifyChanged);
      nextChannel.on('postgres_changes', {
        event: '*', schema: 'public', table: 'game_invites',
      }, notifyChanged);
      await new Promise((resolve, reject) => {
        nextChannel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
            reject(new Error(status));
          }
        });
      });
      if (destroyed || version !== channelVersion || listeners.size === 0) {
        await removeChannel(nextChannel, supabase);
        return;
      }
      channel = nextChannel;
      channelSupabase = supabase;
    }

    async function subscribe(listener) {
      requireRegistered();
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      if (!channel) {
        try {
          await replaceChannel();
        } catch (error) {
          listeners.delete(listener);
          throw error;
        }
      }
      let cleaned = false;
      return async function unsubscribe() {
        if (cleaned) return;
        cleaned = true;
        listeners.delete(listener);
        if (listeners.size === 0) {
          channelVersion += 1;
          await removeChannel();
        }
      };
    }

    function stopPresence() {
      if (presenceTimer == null) return;
      clearIntervalFn?.(presenceTimer);
      presenceTimer = null;
    }

    function startPresence() {
      stopPresence();
      if (destroyed || accountClient.getIdentity()?.kind !== 'registered') return;
      void heartbeat().catch(() => {});
      presenceTimer = setIntervalFn?.(async () => {
        if (documentObject?.visibilityState === 'hidden') return;
        try { await heartbeat(); } catch { /* Retry on the next heartbeat. */ }
      }, 45000) ?? null;
    }

    async function handleVisibilityChange() {
      if (destroyed || documentObject?.visibilityState !== 'visible'
        || accountClient.getIdentity()?.kind !== 'registered') return;
      try { await heartbeat(); } catch { /* Retry on the next heartbeat. */ }
    }

    function handleIdentityChange() {
      startPresence();
      if (listeners.size > 0) void replaceChannel().catch(() => {});
    }

    async function disconnect() {
      if (destroyed) return;
      destroyed = true;
      stopPresence();
      documentObject?.removeEventListener?.('visibilitychange', handleVisibilityChange);
      unsubscribeIdentity?.();
      unsubscribeIdentity = null;
      listeners.clear();
      channelVersion += 1;
      await removeChannel();
    }

    if (autoStart) {
      documentObject?.addEventListener?.('visibilitychange', handleVisibilityChange);
      if (typeof accountClient.subscribe === 'function') {
        unsubscribeIdentity = accountClient.subscribe(handleIdentityChange) || null;
      }
      startPresence();
    }

    return {
      acceptRequest,
      cancelGameInvite,
      declineGameInvite,
      disconnect,
      heartbeat,
      listFriends,
      listInvites,
      listRequests,
      rejectRequest,
      removeFriend,
      searchExact,
      sendGameInvite,
      sendRequest,
      subscribe,
    };
  }

  const playerFriends = {
    createFriendsClient,
    formatPlayerUid,
    mapFriendsError,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = playerFriends;
  globalScope.PlayerFriends = playerFriends;
})(typeof window !== 'undefined' ? window : globalThis);
