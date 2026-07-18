(function initNotificationBell(globalScope) {
  'use strict';

  function formatUnreadCount(value) {
    const count = Math.max(0, Math.floor(Number(value) || 0));
    if (count === 0) return '';
    return count > 99 ? '99+' : String(count);
  }

  function getIdentityKey(identity = {}) {
    return `${identity.kind || 'guest'}:${identity.username || ''}`;
  }

  function mount(options = {}) {
    const documentRef = options.document || globalScope.document;
    const accountPanel = options.accountPanel || globalScope.HYLAccountPanel?.mount();
    const notificationsApi = options.notificationsApi || globalScope.PlayerNotifications;
    const friendsApi = options.friendsApi || globalScope.PlayerFriends;
    const accountClient = accountPanel?.accountClient;
    const bell = documentRef?.querySelector('#notification-bell');
    const badge = documentRef?.querySelector('#notification-unread-count');
    if (!documentRef || !accountPanel || !accountClient || !bell || !badge
      || typeof notificationsApi?.createNotificationsClient !== 'function') return null;

    const accountReady = typeof accountClient.initialize === 'function'
      ? Promise.resolve(accountClient.initialize()).catch(() => null)
      : null;
    let notificationsClient = null;
    let friendsClient = null;
    let identity = accountPanel.getIdentity?.() || accountClient.getIdentity?.() || { kind: 'guest' };
    let requestVersion = 0;
    let pendingRefresh = null;
    let siteUnreadCount = 0;
    let socialPendingCount = 0;
    let siteCountKnown = false;
    let socialCountKnown = false;
    let socialCountVersion = 0;
    let destroyed = false;

    function clearBadge() {
      siteUnreadCount = 0;
      socialPendingCount = 0;
      siteCountKnown = false;
      socialCountKnown = false;
      badge.hidden = true;
      badge.textContent = '';
      bell.setAttribute('aria-label', '查看通知');
    }

    function renderUnread(count) {
      const text = formatUnreadCount(count);
      badge.textContent = text;
      badge.hidden = !text;
      bell.setAttribute('aria-label', text ? `${text} 条未读通知` : '查看通知');
    }

    function renderVerifiedCounts() {
      if (!siteCountKnown && !socialCountKnown) {
        clearBadge();
        return;
      }
      renderUnread(
        (siteCountKnown ? siteUnreadCount : 0)
        + (socialCountKnown ? socialPendingCount : 0),
      );
    }

    async function countSocialPending() {
      if (typeof friendsApi?.createFriendsClient !== 'function') return 0;
      friendsClient ||= friendsApi.createFriendsClient({ accountClient, autoStart: false });
      const [requests, invites] = await Promise.all([
        friendsClient.listRequests(),
        friendsClient.listInvites(),
      ]);
      return requests.filter((request) => request.direction === 'incoming').length
        + invites.filter((invite) => invite.direction === 'incoming' && invite.status === 'pending').length;
    }

    function refresh() {
      if (destroyed) return Promise.resolve();
      const version = requestVersion;
      const socialVersion = socialCountVersion;
      if (pendingRefresh?.version === version) return pendingRefresh.promise;

      const currentIdentity = identity;
      const promise = (async () => {
        try {
          if (accountReady) await accountReady;
          if (destroyed || version !== requestVersion) return;
          notificationsClient ||= notificationsApi.createNotificationsClient({ accountClient });
          if (currentIdentity.kind === 'registered') {
            try {
              void Promise.resolve(notificationsClient.list({ limit: 5 })).catch(() => {});
            } catch { /* The list result is not needed for the badge count. */ }
            const [siteResult, socialResult] = await Promise.allSettled([
              notificationsClient.countUnread(),
              countSocialPending(),
            ]);
            if (!destroyed && version === requestVersion) {
              if (siteResult.status === 'fulfilled') {
                siteUnreadCount = Math.max(0, Math.floor(Number(siteResult.value) || 0));
                siteCountKnown = true;
              }
              if (socialResult.status === 'fulfilled' && socialVersion === socialCountVersion) {
                socialPendingCount = Math.max(0, Math.floor(Number(socialResult.value) || 0));
                socialCountKnown = true;
              }
              renderVerifiedCounts();
            }
          } else {
            await notificationsClient.list({ limit: 5 });
            if (!destroyed && version === requestVersion) clearBadge();
          }
        } catch (_) {
          if (!destroyed && version === requestVersion) renderVerifiedCounts();
        }
      })();

      pendingRefresh = { version, promise };
      void promise.finally(() => {
        if (pendingRefresh?.promise === promise) pendingRefresh = null;
      });
      return promise;
    }

    function handleAccountState(nextState) {
      const nextIdentity = nextState?.identity || nextState || { kind: 'guest' };
      if (getIdentityKey(nextIdentity) === getIdentityKey(identity)) return;
      identity = { ...nextIdentity };
      requestVersion += 1;
      clearBadge();
      void refresh();
    }

    function handleVisibilityChange() {
      if (documentRef.visibilityState === 'visible') void refresh();
    }

    function handleSocialCount(event) {
      if (destroyed || identity.kind !== 'registered') return;
      socialCountVersion += 1;
      socialPendingCount = Math.max(0, Math.floor(Number(event?.detail?.count) || 0));
      socialCountKnown = true;
      renderVerifiedCounts();
    }

    const unsubscribeAccount = accountPanel.subscribe?.(handleAccountState) || (() => {});
    documentRef.addEventListener('visibilitychange', handleVisibilityChange);
    documentRef.addEventListener('hyl:social-count', handleSocialCount);
    clearBadge();
    void refresh();

    return {
      refresh,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        requestVersion += 1;
        pendingRefresh = null;
        unsubscribeAccount();
        documentRef.removeEventListener('visibilitychange', handleVisibilityChange);
        documentRef.removeEventListener('hyl:social-count', handleSocialCount);
        void Promise.resolve(friendsClient?.disconnect?.()).catch(() => {});
        friendsClient = null;
        clearBadge();
      },
    };
  }

  const notificationBell = { formatUnreadCount, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = notificationBell;
  globalScope.HYLNotificationBell = notificationBell;
  if (typeof document !== 'undefined') {
    const autoMount = () => mount();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoMount, { once: true });
    } else {
      autoMount();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
