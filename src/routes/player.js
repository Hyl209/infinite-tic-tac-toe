(function initPlayerCenter(globalScope) {
  'use strict';

  const VALID_TABS = new Set(['checkin', 'activities', 'notifications']);
  let mounted = null;

  function normalizePlayerTab(value) {
    return VALID_TABS.has(value) ? value : 'checkin';
  }

  function readPlayerRoute(value) {
    let url;
    try {
      url = new URL(value, 'https://hhhyl.me/player/');
    } catch {
      url = new URL('https://hhhyl.me/player/');
    }
    const tab = normalizePlayerTab(url.searchParams.get('tab'));
    const activity = tab === 'activities'
      ? String(url.searchParams.get('activity') || '').trim() || null
      : null;
    return { tab, activity };
  }

  function mount() {
    if (mounted || typeof document === 'undefined') return mounted;

    const tabButtons = Array.from(document.querySelectorAll('[data-player-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-player-panel]'));
    const summaryName = document.querySelector('#player-summary-name');
    const summaryKind = document.querySelector('#player-summary-kind');
    const summaryBalance = document.querySelector('#player-summary-balance');
    const checkinGuest = document.querySelector('#checkin-guest-state');
    const checkinLoginButton = document.querySelector('#checkin-login-button');
    const message = document.querySelector('#player-message');
    if (tabButtons.length === 0 || panels.length === 0) return null;

    const accountPanel = globalScope.HYLAccountPanel?.mount();
    const accountClient = accountPanel?.accountClient || null;
    const economyClient = accountPanel?.economyClient || null;
    const checkinClient = accountClient
      ? globalScope.PlayerCheckin?.createCheckinClient({ accountClient })
      : null;
    const activitiesClient = accountClient
      ? globalScope.PlayerActivities?.createActivitiesClient({ accountClient })
      : null;
    const notificationsClient = accountClient
      ? globalScope.PlayerNotifications?.createNotificationsClient({ accountClient })
      : null;
    let currentTab = readPlayerRoute(globalScope.location?.href).tab;

    function setMessage(text = '', state = '') {
      if (!message) return;
      message.textContent = text;
      message.dataset.state = state;
    }

    function renderSummary(state) {
      const identity = state?.identity || accountPanel?.getIdentity() || {
        kind: 'guest',
        displayName: '匿名玩家',
      };
      const economySnapshot = state?.economySnapshot || accountPanel?.getEconomySnapshot() || {
        balance: 0,
      };
      const registered = identity.kind === 'registered';
      if (summaryName) summaryName.textContent = identity.displayName || '匿名玩家';
      if (summaryKind) summaryKind.textContent = registered ? '正式玩家' : '游客身份';
      if (summaryBalance) {
        summaryBalance.hidden = !registered;
        summaryBalance.textContent = `金币 ${Number(economySnapshot.balance || 0)}`;
      }
      if (checkinGuest) checkinGuest.hidden = registered;
    }

    function renderTabs() {
      tabButtons.forEach((button) => {
        const selected = button.dataset.playerTab === currentTab;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.playerPanel !== currentTab;
      });
    }

    function replaceTab(tab) {
      currentTab = normalizePlayerTab(tab);
      const url = new URL(globalScope.location.href);
      url.searchParams.set('tab', currentTab);
      if (currentTab !== 'activities') url.searchParams.delete('activity');
      globalScope.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      renderTabs();
    }

    function focusTab(index) {
      const button = tabButtons[(index + tabButtons.length) % tabButtons.length];
      button?.focus();
      if (button) replaceTab(button.dataset.playerTab);
    }

    tabButtons.forEach((button, index) => {
      button.addEventListener('click', () => replaceTab(button.dataset.playerTab));
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault();
          focusTab(index + 1);
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault();
          focusTab(index - 1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          focusTab(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          focusTab(tabButtons.length - 1);
        }
      });
    });

    checkinLoginButton?.addEventListener('click', () => accountPanel?.open());
    const unsubscribe = accountPanel?.subscribe((state) => renderSummary(state)) || (() => {});

    renderTabs();
    renderSummary();
    if (!accountPanel || !checkinClient || !activitiesClient || !notificationsClient || !economyClient) {
      setMessage('玩家服务暂时不可用，请稍后刷新页面', 'error');
    }

    mounted = {
      accountClient,
      economyClient,
      checkinClient,
      activitiesClient,
      notificationsClient,
      getTab: () => currentTab,
      destroy() {
        unsubscribe();
        mounted = null;
      },
    };
    return mounted;
  }

  const playerCenter = { mount, normalizePlayerTab, readPlayerRoute };
  if (typeof module !== 'undefined' && module.exports) module.exports = playerCenter;
  globalScope.HYLPlayerCenter = playerCenter;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
