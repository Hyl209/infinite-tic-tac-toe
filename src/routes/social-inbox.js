(function initSocialInbox(globalScope) {
  'use strict';

  const SOCIAL_COUNT_EVENT = 'hyl:social-count';

  function getIdentityKey(identity = {}) {
    return `${identity.kind || 'guest'}:${identity.id || identity.username || ''}`;
  }

  function getPendingItems(requests = [], invites = []) {
    return [
      ...requests
        .filter((request) => request.direction === 'incoming')
        .map((request) => ({ type: 'request', item: request })),
      ...invites
        .filter((invite) => invite.direction === 'incoming' && invite.status === 'pending')
        .map((invite) => ({ type: 'invite', item: invite })),
    ];
  }

  function mount(options = {}) {
    const documentRef = options.document || globalScope.document;
    const accountPanel = options.accountPanel || globalScope.HYLAccountPanel?.mount();
    const friendsApi = options.friendsApi || globalScope.PlayerFriends;
    const accountClient = accountPanel?.accountClient;
    const toastRegion = documentRef?.querySelector?.('#social-toast-region');
    if (!documentRef || !accountPanel || !accountClient || !toastRegion
      || typeof friendsApi?.createFriendsClient !== 'function') return null;

    const seenIds = new Set();
    let identity = accountPanel.getIdentity?.() || accountClient.getIdentity?.() || { kind: 'guest' };
    let lifecycleVersion = 0;
    let refreshVersion = 0;
    let realtimeVersion = 0;
    let friendsClient = null;
    let unsubscribeRealtime = null;
    let destroyed = false;

    function emitCount(count) {
      const safeCount = Math.max(0, Math.floor(Number(count) || 0));
      try {
        documentRef.dispatchEvent?.(new globalScope.CustomEvent(SOCIAL_COUNT_EVENT, {
          detail: { count: safeCount },
        }));
      } catch { /* A missing event implementation must not break the page. */ }
    }

    function clearToasts() {
      toastRegion.replaceChildren();
    }

    function showToast(entry) {
      const toast = documentRef.createElement('article');
      toast.className = 'social-toast';
      toast.setAttribute('role', 'status');

      const message = documentRef.createElement('p');
      const playerName = entry.type === 'request'
        ? entry.item.player?.displayName
        : entry.item.sender?.displayName;
      message.textContent = playerName
        ? `${playerName}${entry.type === 'request' ? ' 发来了好友申请' : ' 发来了游戏邀请'}`
        : (entry.type === 'request' ? '收到新的好友申请' : '收到新的游戏邀请');

      const link = documentRef.createElement('a');
      link.setAttribute('href', '/player/?tab=friends');
      link.textContent = '前往处理';

      const closeButton = documentRef.createElement('button');
      closeButton.setAttribute('type', 'button');
      closeButton.setAttribute('aria-label', '关闭社交提醒');
      closeButton.textContent = '关闭';
      closeButton.addEventListener('click', () => toast.remove());

      toast.append(message, link, closeButton);
      toastRegion.append(toast);
    }

    async function refresh({ notifyNew = false, version = lifecycleVersion, client = friendsClient } = {}) {
      if (destroyed || !client || version !== lifecycleVersion) return;
      const requestId = ++refreshVersion;
      try {
        const [requests, invites] = await Promise.all([
          client.listRequests(),
          client.listInvites(),
        ]);
        if (destroyed || version !== lifecycleVersion || client !== friendsClient
          || requestId !== refreshVersion) return;
        const pendingItems = getPendingItems(requests, invites);
        pendingItems.forEach((entry) => {
          const id = `${entry.type}:${entry.item.id}`;
          if (notifyNew && !seenIds.has(id)) showToast(entry);
          seenIds.add(id);
        });
        emitCount(pendingItems.length);
      } catch { /* Keep the last verified database count until the next event. */ }
    }

    function stopClient() {
      const cleanup = unsubscribeRealtime;
      const client = friendsClient;
      unsubscribeRealtime = null;
      friendsClient = null;
      if (cleanup) void Promise.resolve(cleanup()).catch(() => {});
      if (client?.disconnect) void Promise.resolve(client.disconnect()).catch(() => {});
    }

    async function startClient(version) {
      const client = friendsApi.createFriendsClient({ accountClient });
      if (destroyed || version !== lifecycleVersion) {
        await client.disconnect?.();
        return;
      }
      friendsClient = client;
      try {
        const baselineRealtimeVersion = realtimeVersion;
        const cleanup = await client.subscribe(() => {
          realtimeVersion += 1;
          void refresh({ notifyNew: true, version, client });
        });
        if (destroyed || version !== lifecycleVersion || client !== friendsClient) {
          await cleanup?.();
          await client.disconnect?.();
          return;
        }
        unsubscribeRealtime = cleanup;
        if (realtimeVersion === baselineRealtimeVersion) await refresh({ version, client });
      } catch {
        if (!destroyed && version === lifecycleVersion && client === friendsClient) {
          await refresh({ version, client });
        }
      }
    }

    function applyIdentity(nextState) {
      const nextIdentity = nextState?.identity || nextState || { kind: 'guest' };
      if (getIdentityKey(nextIdentity) === getIdentityKey(identity)) return;
      identity = { ...nextIdentity };
      lifecycleVersion += 1;
      refreshVersion += 1;
      realtimeVersion += 1;
      stopClient();
      clearToasts();
      emitCount(0);
      if (identity.kind === 'registered') void startClient(lifecycleVersion);
    }

    const initialIdentity = identity;
    identity = { kind: '__initial__' };
    const unsubscribeAccount = accountPanel.subscribe?.(applyIdentity) || (() => {});
    applyIdentity(initialIdentity);

    return {
      refresh: () => refresh(),
      destroy() {
        if (destroyed) return;
        destroyed = true;
        lifecycleVersion += 1;
        refreshVersion += 1;
        realtimeVersion += 1;
        unsubscribeAccount();
        stopClient();
        clearToasts();
        emitCount(0);
      },
    };
  }

  const socialInbox = { getPendingItems, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = socialInbox;
  globalScope.HYLSocialInbox = socialInbox;
  if (typeof document !== 'undefined') {
    const autoMount = () => mount();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoMount, { once: true });
    } else {
      autoMount();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
