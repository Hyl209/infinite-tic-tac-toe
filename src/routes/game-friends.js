(function initGameFriends(globalScope) {
  'use strict';

  function mount({ accountPanel, onMessage } = {}) {
    const inviteButton = document.querySelector('#invite-friend-button');
    const dialog = document.querySelector('#friend-invite-dialog');
    const closeButton = document.querySelector('#friend-invite-close');
    const list = document.querySelector('#friend-invite-list');
    const message = document.querySelector('#friend-invite-message');
    const friendsApi = globalScope.PlayerFriends;
    const accountClient = accountPanel?.accountClient;
    if (!inviteButton || !dialog || !closeButton || !list || !message
      || !friendsApi?.createFriendsClient || !accountClient) return null;

    const friendsClient = friendsApi.createFriendsClient({ accountClient });
    let waitingRoom = null;
    let friends = [];
    let pendingInvite = null;
    let busy = false;
    let destroyed = false;
    let generation = 0;
    let refreshRequestId = 0;
    let activeIdentityKey = getIdentityKey();
    let unsubscribeRealtime = null;
    let realtimeStart = null;

    function getIdentityKey(identity = accountPanel.getIdentity?.()) {
      if (identity?.kind !== 'registered') return identity?.kind || 'guest';
      return `registered:${identity.uid ?? identity.userId ?? identity.username ?? ''}`;
    }

    function isRegistered() {
      return accountPanel.getIdentity?.().kind === 'registered';
    }

    function captureLifecycle(inviteId = null) {
      return {
        generation,
        roomId: waitingRoom?.roomId || null,
        identityKey: activeIdentityKey,
        inviteId,
      };
    }

    function isCurrentLifecycle(lifecycle) {
      return Boolean(
        !destroyed
        && lifecycle.generation === generation
        && lifecycle.roomId === (waitingRoom?.roomId || null)
        && lifecycle.identityKey === activeIdentityKey
        && lifecycle.identityKey === getIdentityKey(),
      );
    }

    function isEligibleRoom(game) {
      const hasOpponent = Boolean(
        game?.playerNames?.O || game?.oPlayer || game?.oPlayerId || game?.opponentId,
      );
      return Boolean(
        isRegistered()
        && game?.roomId
        && game.status === 'waiting'
        && game.playerMark === 'X'
        && !hasOpponent,
      );
    }

    function setMessage(text = '', state = '') {
      message.textContent = text;
      message.dataset.state = state;
      onMessage?.(text, state);
    }

    function playerUid(player) {
      const value = player?.uid ?? player?.playerUid;
      if (value == null) return '------';
      try {
        return friendsApi.formatPlayerUid ? friendsApi.formatPlayerUid(value) : String(value);
      } catch {
        return String(value);
      }
    }

    function playerName(player) {
      return player?.displayName || player?.username || '好友';
    }

    function actionButton(label, action, handler) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action === 'cancel' ? 'button danger' : 'button primary';
      button.dataset.action = action;
      button.textContent = label;
      button.disabled = busy;
      button.addEventListener('click', handler);
      return button;
    }

    function friendCard(friend) {
      const item = document.createElement('article');
      item.className = 'friend-invite-item';
      item.dataset.appleReveal = '';
      item.dataset.appleListItem = '';
      const details = document.createElement('div');
      details.className = 'friend-invite-player';
      const name = document.createElement('strong');
      name.textContent = playerName(friend);
      const meta = document.createElement('span');
      meta.textContent = `UID ${playerUid(friend)} · ${friend.online ? '在线' : '离线'}`;
      details.append(name, meta);
      item.append(details, actionButton('邀请', 'invite', () => void sendInvite(friend)));
      return item;
    }

    function pendingCard(invite) {
      const recipient = invite.recipient || invite.friend || {};
      const item = document.createElement('article');
      item.className = 'friend-invite-item is-pending';
      item.dataset.appleReveal = '';
      item.dataset.appleListItem = '';
      const details = document.createElement('div');
      details.className = 'friend-invite-player';
      const name = document.createElement('strong');
      name.textContent = playerName(recipient);
      const meta = document.createElement('span');
      meta.textContent = `UID ${playerUid(recipient)} · 等待回应`;
      details.append(name, meta);
      item.append(details, actionButton('取消邀请', 'cancel', () => void cancelInvite()));
      return item;
    }

    function renderList() {
      if (!waitingRoom) {
        list.replaceChildren();
        globalScope.HYLAppleUI?.refresh?.(list);
        return;
      }
      if (pendingInvite) {
        list.replaceChildren(pendingCard(pendingInvite));
        globalScope.HYLAppleUI?.refresh?.(list);
        return;
      }
      if (friends.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'friend-invite-empty';
        empty.textContent = busy ? '正在加载好友' : '暂无可邀请的好友';
        list.replaceChildren(empty);
        globalScope.HYLAppleUI?.refresh?.(list);
        return;
      }
      list.replaceChildren(...friends.map(friendCard));
      globalScope.HYLAppleUI?.refresh?.(list);
    }

    function render() {
      inviteButton.hidden = !isEligibleRoom(waitingRoom);
      renderList();
    }

    async function stopRealtime() {
      const cleanup = unsubscribeRealtime;
      unsubscribeRealtime = null;
      realtimeStart = null;
      if (cleanup) await cleanup();
    }

    async function startRealtime() {
      if (unsubscribeRealtime || realtimeStart || !waitingRoom || !isRegistered()) return;
      const lifecycle = captureLifecycle();
      const start = friendsClient.subscribe(() => {
        if (isCurrentLifecycle(lifecycle)) void refresh({ loadFriends: dialog.open });
      })
        .then(async (cleanup) => {
          if (!isCurrentLifecycle(lifecycle)) {
            await cleanup?.();
            return;
          }
          unsubscribeRealtime = cleanup;
        })
        .catch((error) => {
          if (isCurrentLifecycle(lifecycle)) {
            setMessage(friendsApi.mapFriendsError?.(error) || '好友服务暂时不可用', 'error');
          }
        })
        .finally(() => {
          if (realtimeStart === start) realtimeStart = null;
        });
      realtimeStart = start;
      await start;
    }

    async function refresh({ loadFriends = false } = {}) {
      if (!waitingRoom || !isRegistered()) return;
      const lifecycle = captureLifecycle();
      const requestId = ++refreshRequestId;
      try {
        const [nextInvites, nextFriends] = await Promise.all([
          friendsClient.listInvites(),
          loadFriends ? friendsClient.listFriends() : Promise.resolve(null),
        ]);
        if (!isCurrentLifecycle(lifecycle) || requestId !== refreshRequestId) return;
        pendingInvite = nextInvites.find((invite) => (
          invite.direction === 'outgoing'
          && invite.status === 'pending'
          && invite.gameId === lifecycle.roomId
        )) || null;
        if (loadFriends) friends = nextFriends;
        busy = false;
        render();
      } catch (error) {
        if (!isCurrentLifecycle(lifecycle) || requestId !== refreshRequestId) return;
        busy = false;
        setMessage(friendsApi.mapFriendsError?.(error) || '好友服务暂时不可用', 'error');
        render();
      }
    }

    async function openDialog() {
      if (!isEligibleRoom(waitingRoom) || busy) return;
      dialog.showModal();
      busy = true;
      setMessage(pendingInvite ? '邀请已发送，等待回应' : '');
      render();
      await refresh({ loadFriends: true });
    }

    async function sendInvite(friend) {
      if (!isEligibleRoom(waitingRoom) || busy || pendingInvite) return;
      const lifecycle = captureLifecycle();
      busy = true;
      setMessage('正在发送邀请');
      render();
      try {
        const result = await friendsClient.sendGameInvite(lifecycle.roomId, friend.id);
        if (!isCurrentLifecycle(lifecycle) || !isEligibleRoom(waitingRoom)) return;
        refreshRequestId += 1;
        pendingInvite = {
          id: result, gameId: lifecycle.roomId, recipient: friend, status: 'pending',
        };
        busy = false;
        setMessage('邀请已发送，等待回应', 'success');
        render();
        await refresh();
      } catch (error) {
        if (!isCurrentLifecycle(lifecycle)) return;
        busy = false;
        setMessage(friendsApi.mapFriendsError?.(error) || '好友服务暂时不可用', 'error');
        render();
      }
    }

    async function cancelInvite() {
      if (!pendingInvite?.id || busy) return;
      const inviteId = pendingInvite.id;
      const lifecycle = captureLifecycle(inviteId);
      busy = true;
      render();
      try {
        await friendsClient.cancelGameInvite(inviteId);
        if (!isCurrentLifecycle(lifecycle) || pendingInvite?.id !== lifecycle.inviteId) return;
        refreshRequestId += 1;
        pendingInvite = null;
        busy = false;
        setMessage('邀请已取消', 'success');
        render();
      } catch (error) {
        if (!isCurrentLifecycle(lifecycle) || pendingInvite?.id !== lifecycle.inviteId) return;
        busy = false;
        setMessage(friendsApi.mapFriendsError?.(error) || '好友服务暂时不可用', 'error');
        render();
      }
    }

    function resetLifecycle(nextRoom = null) {
      generation += 1;
      refreshRequestId += 1;
      waitingRoom = nextRoom;
      friends = [];
      pendingInvite = null;
      busy = false;
      if (dialog.open) dialog.close();
      setMessage();
      render();
      return stopRealtime();
    }

    function clearWaitingRoom() {
      return resetLifecycle(null);
    }

    function setWaitingRoom(gameOrNull) {
      if (destroyed) return controller;
      if (!isEligibleRoom(gameOrNull)) {
        void clearWaitingRoom();
        return controller;
      }
      const roomChanged = waitingRoom?.roomId !== gameOrNull.roomId;
      if (roomChanged) {
        void resetLifecycle(gameOrNull).then(() => startRealtime());
      } else {
        waitingRoom = gameOrNull;
        render();
      }
      void refresh();
      return controller;
    }

    async function destroy() {
      if (destroyed) return;
      generation += 1;
      refreshRequestId += 1;
      destroyed = true;
      inviteButton.removeEventListener('click', openDialog);
      closeButton.removeEventListener('click', closeDialog);
      dialog.removeEventListener('click', closeOnBackdrop);
      unsubscribeAccount?.();
      waitingRoom = null;
      friends = [];
      pendingInvite = null;
      busy = false;
      if (dialog.open) dialog.close();
      message.textContent = '';
      message.dataset.state = '';
      onMessage?.('', '');
      render();
      await stopRealtime();
      await friendsClient.disconnect();
    }

    function closeDialog() {
      if (dialog.open) dialog.close();
    }

    function closeOnBackdrop(event) {
      if (event.target === dialog) closeDialog();
    }

    inviteButton.addEventListener('click', openDialog);
    closeButton.addEventListener('click', closeDialog);
    dialog.addEventListener('click', closeOnBackdrop);
    const unsubscribeAccount = accountPanel.subscribe?.(({ identity } = {}) => {
      const nextIdentityKey = getIdentityKey(identity);
      if (nextIdentityKey === activeIdentityKey) {
        render();
        return;
      }
      activeIdentityKey = nextIdentityKey;
      const nextRoom = identity?.kind === 'registered' && isEligibleRoom(waitingRoom)
        ? waitingRoom
        : null;
      void resetLifecycle(nextRoom).then(() => {
        if (!nextRoom || destroyed) return;
        void startRealtime();
        if (!dialog.open) void refresh();
      });
    });
    inviteButton.hidden = true;

    const controller = { setWaitingRoom, destroy };
    return controller;
  }

  const api = { mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.HYLGameFriends = api;
}(typeof window !== 'undefined' ? window : globalThis));
