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
    const accountClient = accountPanel?.accountClient;
    const badge = documentRef?.querySelector('#notification-unread-count');
    if (!documentRef || !accountPanel || !accountClient || !badge
      || typeof notificationsApi?.createNotificationsClient !== 'function') return null;

    const accountReady = typeof accountClient.initialize === 'function'
      ? Promise.resolve(accountClient.initialize()).catch(() => null)
      : null;
    let notificationsClient = null;
    let identity = accountPanel.getIdentity?.() || accountClient.getIdentity?.() || { kind: 'guest' };
    let requestVersion = 0;
    let pendingRefresh = null;
    let destroyed = false;

    function clearBadge() {
      badge.hidden = true;
      badge.textContent = '';
    }

    function renderUnread(count) {
      const text = formatUnreadCount(count);
      badge.textContent = text;
      badge.hidden = !text;
    }

    function refresh() {
      if (destroyed) return Promise.resolve();
      const version = requestVersion;
      if (pendingRefresh?.version === version) return pendingRefresh.promise;

      const currentIdentity = identity;
      const promise = (async () => {
        try {
          if (accountReady) await accountReady;
          if (destroyed || version !== requestVersion) return;
          notificationsClient ||= notificationsApi.createNotificationsClient({ accountClient });
          if (currentIdentity.kind === 'registered') {
            const [, unreadCount] = await Promise.all([
              notificationsClient.list({ limit: 5 }),
              notificationsClient.countUnread(),
            ]);
            if (!destroyed && version === requestVersion) renderUnread(unreadCount);
          } else {
            await notificationsClient.list({ limit: 5 });
            if (!destroyed && version === requestVersion) clearBadge();
          }
        } catch (_) {
          if (!destroyed && version === requestVersion) clearBadge();
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

    const unsubscribeAccount = accountPanel.subscribe?.(handleAccountState) || (() => {});
    documentRef.addEventListener('visibilitychange', handleVisibilityChange);
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
