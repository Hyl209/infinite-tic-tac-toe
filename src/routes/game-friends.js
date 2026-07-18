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
    let requestVersion = 0;
    let unsubscribeRealtime = null;
    let realtimeStart = null;

    function isRegistered() {
      return accountPanel.getIdentity?.().kind === 'registered';
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
        return;
      }
      if (pendingInvite) {
        list.replaceChildren(pendingCard(pendingInvite));
        return;
      }
      if (friends.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'friend-invite-empty';
        empty.textContent = busy ? '正在加载好友' : '暂无可邀请的好友';
        list.replaceChildren(empty);
        return;
      }
      list.replaceChildren(...friends.map(friendCard));
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
      const roomId = waitingRoom.roomId;
      realtimeStart = friendsClient.subscribe(() => void refresh({ loadFriends: dialog.open }))
        .then(async (cleanup) => {
          realtimeStart = null;
          if (destroyed || waitingRoom?.roomId !== roomId) {
            await cleanup?.();
            return;
          }
          unsubscribeRealtime = cleanup;
        })
        .catch((error) => {
          realtimeStart = null;
          if (waitingRoom?.roomId === roomId) {
            setMessage(friendsApi.mapFriendsError?.(error) || '好友服务暂时不可用', 'error');
          }
        });
      await realtimeStart;
    }

    async function refresh({ loadFriends = false } = {}) {
      if (!waitingRoom || !isRegistered()) return;
      const version = ++requestVersion;
      const roomId = waitingRoom.roomId;
      try {
        const [nextInvites, nextFriends] = await Promise.all([
          friendsClient.listInvites(),
          loadFriends ? friendsClient.listFriends() : Promise.resolve(friends),
        ]);
        if (destroyed || version !== requestVersion || waitingRoom?.roomId !== roomId) return;
        pendingInvite = nextInvites.find((invite) => (
          invite.direction === 'outgoing'
          && invite.status === 'pending'
          && invite.gameId === roomId
        )) || null;
        friends = nextFriends;
        busy = false;
        render();
      } catch (error) {
        if (destroyed || version !== requestVersion || waitingRoom?.roomId !== roomId) return;
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
      const roomId = waitingRoom.roomId;
      busy = true;
      setMessage('正在发送邀请');
      render();
      try {
        const result = await friendsClient.sendGameInvite(roomId, friend.id);
        if (!isEligibleRoom(waitingRoom) || waitingRoom.roomId !== roomId) return;
        pendingInvite = { id: result, gameId: roomId, recipient: friend, status: 'pending' };
        busy = false;
        setMessage('邀请已发送，等待回应', 'success');
        render();
        await refresh();
      } catch (error) {
        if (!waitingRoom || waitingRoom.roomId !== roomId) return;
        busy = false;
        setMessage(friendsApi.mapFriendsError?.(error) || '好友服务暂时不可用', 'error');
        render();
      }
    }

    async function cancelInvite() {
      if (!pendingInvite?.id || busy) return;
      const inviteId = pendingInvite.id;
      busy = true;
      render();
      try {
        await friendsClient.cancelGameInvite(inviteId);
        pendingInvite = null;
        busy = false;
        setMessage('邀请已取消', 'success');
        render();
      } catch (error) {
        busy = false;
        setMessage(friendsApi.mapFriendsError?.(error) || '好友服务暂时不可用', 'error');
        render();
      }
    }

    function clearWaitingRoom() {
      requestVersion += 1;
      waitingRoom = null;
      friends = [];
      pendingInvite = null;
      busy = false;
      if (dialog.open) dialog.close();
      setMessage();
      render();
      return stopRealtime();
    }

    function setWaitingRoom(gameOrNull) {
      if (destroyed) return controller;
      if (!isEligibleRoom(gameOrNull)) {
        void clearWaitingRoom();
        return controller;
      }
      const roomChanged = waitingRoom?.roomId !== gameOrNull.roomId;
      waitingRoom = gameOrNull;
      if (roomChanged) {
        requestVersion += 1;
        friends = [];
        pendingInvite = null;
        setMessage();
        void stopRealtime().then(() => startRealtime());
      }
      render();
      void refresh();
      return controller;
    }

    async function destroy() {
      if (destroyed) return;
      destroyed = true;
      requestVersion += 1;
      inviteButton.removeEventListener('click', openDialog);
      closeButton.removeEventListener('click', closeDialog);
      dialog.removeEventListener('click', closeOnBackdrop);
      unsubscribeAccount?.();
      await clearWaitingRoom();
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
    const unsubscribeAccount = accountPanel.subscribe?.(() => {
      if (!isRegistered()) void clearWaitingRoom();
      else render();
    });
    inviteButton.hidden = true;

    const controller = { setWaitingRoom, destroy };
    return controller;
  }

  const api = { mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.HYLGameFriends = api;
}(typeof window !== 'undefined' ? window : globalThis));
