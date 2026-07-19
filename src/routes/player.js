(function initPlayerCenter(globalScope) {
  'use strict';

  const VALID_TABS = new Set(['checkin', 'activities', 'notifications', 'friends', 'shop', 'inventory']);
  const DEFINITIVE_SHOP_ERRORS = [
    'PRODUCT_NOT_FOUND', 'PRODUCT_INACTIVE', 'PRODUCT_PRICE_INVALID',
    'PURCHASE_LIMIT_REACHED', 'INSUFFICIENT_COINS', 'INVALID_REQUEST_ID',
  ];
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

  function getHongKongDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function formatCoinDelta(value) {
    const amount = Number(value || 0);
    return `${amount > 0 ? '+' : ''}${amount} 金币`;
  }

  function getCheckinAction(day, today = getHongKongDate()) {
    const date = String(day?.checkinDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || day?.checkedIn) return null;

    const rewardAmount = Number(day.rewardAmount || 0);
    if (date === today) {
      return {
        type: 'checkin',
        label: `签到领取 ${rewardAmount} 金币`,
        rewardAmount,
      };
    }

    if (!day.canMakeup || date >= today || date.slice(0, 7) !== today.slice(0, 7)) return null;
    const makeupCost = Number(day.makeupCost || 0);
    return {
      type: 'makeup',
      label: `补签 ${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`,
      rewardAmount,
      makeupCost,
      netAmount: rewardAmount - makeupCost,
    };
  }

  function buildCalendarCells(days, today) {
    const validDays = Array.isArray(days)
      ? days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day?.checkinDate || '')))
        .sort((left, right) => left.checkinDate.localeCompare(right.checkinDate))
      : [];
    if (validDays.length === 0) return [];

    const calendarToday = today
      || validDays.find((day) => day.isToday)?.checkinDate
      || getHongKongDate();
    const firstDate = validDays[0].checkinDate;
    const weekday = new Date(`${firstDate}T00:00:00Z`).getUTCDay();
    const leadingEmpty = (weekday + 6) % 7;
    const cells = Array.from({ length: leadingEmpty }, () => ({ kind: 'empty' }));

    validDays.forEach((day) => {
      const date = day.checkinDate;
      let status = 'missed';
      let statusLabel = '未签到';
      if (day.checkedIn && day.checkinType === 'makeup') {
        status = 'made-up';
        statusLabel = '已补签';
      } else if (day.checkedIn) {
        status = 'checked';
        statusLabel = '已签到';
      } else if (day.isToday || date === calendarToday) {
        status = 'today';
        statusLabel = '今日待签到';
      } else if (day.canMakeup && date < calendarToday && date.slice(0, 7) === calendarToday.slice(0, 7)) {
        status = 'makeup';
        statusLabel = '可补签';
      } else if (date > calendarToday) {
        status = 'future';
        statusLabel = '未来日期';
      }
      cells.push({
        ...day,
        kind: 'day',
        date,
        dayNumber: Number(date.slice(8, 10)),
        status,
        statusLabel,
      });
    });
    return cells;
  }

  function createRequestId() {
    if (typeof globalScope.crypto?.randomUUID === 'function') return globalScope.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (typeof globalScope.crypto?.getRandomValues === 'function') {
      globalScope.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function getAccountKey(identity) {
    const kind = identity?.kind || 'guest';
    return kind === 'registered'
      ? `${kind}:${String(identity?.username || '').trim().toLowerCase()}`
      : kind;
  }

  function mountFriendsPanel({ accountPanel, accountClient, getCurrentTab }) {
    const friendsApi = globalScope.PlayerFriends;
    const searchForm = document.querySelector('#friend-search-form');
    const searchInput = document.querySelector('#friend-search-input');
    const searchResult = document.querySelector('#friend-search-result');
    const incomingList = document.querySelector('#incoming-friend-requests');
    const outgoingList = document.querySelector('#outgoing-friend-requests');
    const friendList = document.querySelector('#friend-list');
    const inviteList = document.querySelector('#game-invite-list');
    const friendMessage = document.querySelector('#friend-message');
    const friendTab = document.querySelector('#player-tab-friends');
    if (!accountClient || typeof friendsApi?.createFriendsClient !== 'function'
      || !searchForm || !searchInput || !searchResult || !incomingList
      || !outgoingList || !friendList || !inviteList) return null;

    const friendsClient = friendsApi.createFriendsClient({ accountClient });
    const controller = new AbortController();
    const { signal } = controller;
    const pendingActions = new Set();
    let friends = [];
    let requests = [];
    let invites = [];
    let foundPlayer = null;
    let refreshVersion = 0;
    let searchRequestVersion = 0;
    let identityVersion = 0;
    let identityKey = getAccountKey(accountPanel?.getIdentity());
    let destroyed = false;
    let unsubscribeRealtime = null;
    let realtimeSubscriptionPending = false;
    let realtimeSubscriptionVersion = 0;

    function createNode(tagName, className = '', text = '') {
      const node = document.createElement(tagName);
      node.className = className;
      if (text) node.textContent = text;
      return node;
    }

    function setMessage(text = '', state = '') {
      if (!friendMessage) return;
      friendMessage.textContent = text;
      friendMessage.dataset.state = state;
    }

    function formatTime(value) {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return '尚无在线记录';
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Hong_Kong', month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(date);
    }

    function empty(text) {
      return createNode('p', 'friend-empty-state', text);
    }

    function playerCopy(player, meta = '') {
      const copy = createNode('div', 'friend-player-copy');
      copy.append(
        createNode('strong', '', player.displayName || player.username || '玩家'),
        createNode('span', 'friend-player-uid', `UID ${player.uid}`),
        createNode('small', '', meta || `@${player.username}`),
      );
      return copy;
    }

    function actionButton(label, action, key, variant = 'secondary') {
      const button = createNode('button', `friend-action player-${variant}-action`, label);
      button.type = 'button';
      button.disabled = pendingActions.has(key);
      button.addEventListener('click', () => void runAction(key, action), { signal });
      return button;
    }

    function renderRequests() {
      const incoming = requests.filter((request) => request.direction === 'incoming');
      const outgoing = requests.filter((request) => request.direction === 'outgoing');
      incomingList.replaceChildren(...(incoming.length ? incoming.map((request) => {
        const item = createNode('article', 'friend-row');
        const actions = createNode('div', 'friend-row-actions');
        actions.append(
          actionButton('接受申请', () => friendsClient.acceptRequest(request.id), `accept:${request.id}`, 'primary'),
          actionButton('拒绝申请', () => friendsClient.rejectRequest(request.id), `reject:${request.id}`),
        );
        item.append(playerCopy(request.player, `@${request.player.username}`), actions);
        return item;
      }) : [empty('暂无收到的好友申请。')]));
      outgoingList.replaceChildren(...(outgoing.length ? outgoing.map((request) => {
        const item = createNode('article', 'friend-row');
        item.append(playerCopy(request.player, `已向 @${request.player.username} 发出申请`));
        return item;
      }) : [empty('暂无发出的好友申请。')]));
    }

    function renderFriends() {
      friendList.replaceChildren(...(friends.length ? friends.map((friend) => {
        const item = createNode('article', 'friend-row');
        const status = createNode('span', 'friend-status', friend.online
          ? '在线' : `最近在线 ${formatTime(friend.lastSeenAt)}`);
        status.dataset.online = String(friend.online);
        const actions = createNode('div', 'friend-row-actions');
        actions.append(actionButton('删除好友', async () => {
          const confirmed = typeof globalScope.confirm !== 'function'
            || globalScope.confirm(`确认删除好友 ${friend.displayName}？`);
          if (!confirmed) return false;
          await friendsClient.removeFriend(friend.id);
          return true;
        }, `remove:${friend.id}`));
        item.append(playerCopy(friend, `@${friend.username}`), status, actions);
        return item;
      }) : [empty('还没有好友，可以先按 UID 或用户名查找。')]));
    }

    function inviteUrl(invite) {
      const gameUrl = new URL('/game/', globalScope.location?.href || 'https://hhhyl.me/');
      return globalScope.OnlineGame?.buildInviteUrl
        ? globalScope.OnlineGame.buildInviteUrl(gameUrl, invite.roomCode, invite.gameType)
        : `${gameUrl}?game=${encodeURIComponent(invite.gameType)}&room=${encodeURIComponent(invite.roomCode)}`;
    }

    function renderInvites() {
      const incoming = invites.filter((invite) => invite.direction === 'incoming' && invite.status === 'pending');
      inviteList.replaceChildren(...(incoming.length ? incoming.map((invite) => {
        const item = createNode('article', 'friend-row game-invite-row');
        const gameName = invite.gameType === 'gomoku' ? '五子棋' : '无限井字棋';
        const wager = invite.wagerAmount > 0 ? `彩头 ${invite.wagerAmount} 金币` : '无彩头';
        const hostName = invite.sender.displayName || invite.sender.username || '玩家';
        const details = createNode('div', 'friend-player-copy');
        details.append(
          createNode('strong', '', gameName),
          createNode('span', 'friend-player-uid', `房主：${hostName} · UID ${invite.sender.uid}`),
          createNode('small', '', `${wager} · ${formatTime(invite.expiresAt)}失效`),
        );
        const actions = createNode('div', 'friend-row-actions');
        const enter = createNode('a', 'friend-action player-primary-action', '进入房间');
        enter.href = inviteUrl(invite);
        actions.append(
          enter,
          actionButton('拒绝邀请', () => friendsClient.declineGameInvite(invite.id), `decline:${invite.id}`),
        );
        item.append(details, actions);
        return item;
      }) : [empty('暂无待处理的游戏邀请。')]));
    }

    function renderSearchResult() {
      if (!foundPlayer) {
        searchResult.replaceChildren();
        return;
      }
      const item = createNode('article', 'friend-search-player friend-row');
      const actions = createNode('div', 'friend-row-actions');
      const state = foundPlayer.relationshipState;
      if (state === 'none') {
        actions.append(actionButton('发送申请', () => friendsClient.sendRequest(foundPlayer.id), `send:${foundPlayer.id}`, 'primary'));
      } else if (state === 'incoming') {
        const request = requests.find((entry) => entry.direction === 'incoming' && entry.player.id === foundPlayer.id);
        if (request) actions.append(actionButton('接受申请', () => friendsClient.acceptRequest(request.id), `accept:${request.id}`, 'primary'));
      } else if (state === 'friends') {
        actions.append(createNode('span', 'friend-relationship-label', '已是好友'));
      } else if (state === 'outgoing') {
        actions.append(createNode('span', 'friend-relationship-label', '申请已发送'));
      } else {
        actions.append(createNode('span', 'friend-relationship-label', '这是你自己'));
      }
      item.append(playerCopy(foundPlayer, `@${foundPlayer.username}`), actions);
      searchResult.replaceChildren(item);
    }

    function updatePendingCount() {
      if (!friendTab) return;
      const count = requests.filter((request) => request.direction === 'incoming').length
        + invites.filter((invite) => invite.direction === 'incoming' && invite.status === 'pending').length;
      friendTab.dataset.pendingCount = String(count);
      friendTab.setAttribute('aria-label', count > 0 ? `好友，${count} 项待处理` : '好友');
      if (getCurrentTab() === 'friends') friendTab.dataset.seenCount = String(count);
    }

    function render() {
      renderRequests();
      renderFriends();
      renderInvites();
      renderSearchResult();
      updatePendingCount();
    }

    function renderGuest() {
      friends = [];
      requests = [];
      invites = [];
      foundPlayer = null;
      incomingList.replaceChildren(empty('登录正式账号后可接收好友申请。'));
      outgoingList.replaceChildren(empty('登录正式账号后可发送好友申请。'));
      friendList.replaceChildren(empty('登录正式账号后可管理好友。'));
      inviteList.replaceChildren(empty('登录正式账号后可接收游戏邀请。'));
      searchResult.replaceChildren();
      searchInput.disabled = true;
      searchForm.querySelector('button')?.setAttribute('disabled', '');
      setMessage('请先登录正式账号使用好友功能。');
      updatePendingCount();
    }

    function renderLoading() {
      friends = [];
      requests = [];
      invites = [];
      foundPlayer = null;
      pendingActions.clear();
      incomingList.replaceChildren(empty('正在加载好友申请。'));
      outgoingList.replaceChildren(empty('正在加载好友申请。'));
      friendList.replaceChildren(empty('正在加载好友列表。'));
      inviteList.replaceChildren(empty('正在加载游戏邀请。'));
      searchResult.replaceChildren();
      updatePendingCount();
      setMessage();
    }

    async function refresh({ preserveMessage = false } = {}) {
      if (destroyed) return false;
      if (accountPanel?.getIdentity()?.kind !== 'registered') {
        renderGuest();
        return false;
      }
      searchInput.disabled = false;
      searchForm.querySelector('button')?.removeAttribute('disabled');
      const version = ++refreshVersion;
      incomingList.setAttribute('aria-busy', 'true');
      try {
        const [nextFriends, nextRequests, nextInvites] = await Promise.all([
          friendsClient.listFriends(), friendsClient.listRequests(), friendsClient.listInvites(),
        ]);
        if (destroyed || version !== refreshVersion) return false;
        friends = nextFriends;
        requests = nextRequests;
        invites = nextInvites;
        render();
        if (!preserveMessage) setMessage();
        return true;
      } catch (error) {
        if (!destroyed && version === refreshVersion) {
          setMessage(friendsApi.mapFriendsError(error), 'error');
        }
        return false;
      } finally {
        if (!destroyed && version === refreshVersion) incomingList.removeAttribute('aria-busy');
      }
    }

    async function runAction(key, action) {
      if (pendingActions.has(key) || destroyed) return;
      const previousMessage = friendMessage?.textContent || '';
      const previousMessageState = friendMessage?.dataset.state || '';
      pendingActions.add(key);
      render();
      setMessage('正在处理。');
      try {
        const result = await action();
        if (destroyed) return;
        if (result === false) {
          setMessage(previousMessage, previousMessageState);
          return;
        }
        setMessage('操作成功。', 'success');
        foundPlayer = null;
        await refresh({ preserveMessage: true });
      } catch (error) {
        if (!destroyed) setMessage(friendsApi.mapFriendsError(error), 'error');
      } finally {
        pendingActions.delete(key);
        if (!destroyed) render();
      }
    }

    searchForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (destroyed || accountPanel?.getIdentity()?.kind !== 'registered') {
        accountPanel?.open();
        return;
      }
      const value = searchInput.value;
      const requestVersion = ++searchRequestVersion;
      const requestIdentityVersion = identityVersion;
      setMessage('正在查找玩家。');
      searchInput.disabled = true;
      try {
        const result = await friendsClient.searchExact(value);
        if (destroyed || requestVersion !== searchRequestVersion
          || requestIdentityVersion !== identityVersion) return;
        foundPlayer = result;
        renderSearchResult();
        setMessage(foundPlayer ? '' : '没有找到该玩家。', foundPlayer ? '' : 'error');
      } catch (error) {
        if (!destroyed && requestVersion === searchRequestVersion
          && requestIdentityVersion === identityVersion) {
          setMessage(friendsApi.mapFriendsError(error), 'error');
        }
      } finally {
        if (!destroyed && requestVersion === searchRequestVersion
          && requestIdentityVersion === identityVersion) searchInput.disabled = false;
      }
    }, { signal });

    async function stopRealtimeSubscription() {
      realtimeSubscriptionVersion += 1;
      realtimeSubscriptionPending = false;
      const cleanup = unsubscribeRealtime;
      unsubscribeRealtime = null;
      await cleanup?.();
    }

    async function ensureRealtimeSubscription() {
      if (destroyed || realtimeSubscriptionPending || unsubscribeRealtime
        || accountPanel?.getIdentity()?.kind !== 'registered') return;
      const version = ++realtimeSubscriptionVersion;
      realtimeSubscriptionPending = true;
      try {
        const cleanup = await friendsClient.subscribe(() => {
          if (destroyed) return;
          setMessage('好友状态已更新。');
          void refresh({ preserveMessage: true });
        });
        if (destroyed || version !== realtimeSubscriptionVersion
          || accountPanel?.getIdentity()?.kind !== 'registered') {
          await cleanup();
          return;
        }
        unsubscribeRealtime = cleanup;
      } catch {
        // Realtime is an enhancement; list refreshes and actions remain available.
      } finally {
        if (version === realtimeSubscriptionVersion) realtimeSubscriptionPending = false;
      }
    }

    const unsubscribeAccount = accountPanel?.subscribe((state) => {
      const nextIdentityKey = getAccountKey(state?.identity || accountPanel?.getIdentity());
      const identityChanged = nextIdentityKey !== identityKey;
      if (identityChanged) {
        identityKey = nextIdentityKey;
        identityVersion += 1;
        searchRequestVersion += 1;
        if (state?.identity?.kind === 'registered') renderLoading();
      }
      refreshVersion += 1;
      foundPlayer = null;
      if (state?.identity?.kind === 'registered') {
        void refresh();
        void ensureRealtimeSubscription();
      } else {
        void stopRealtimeSubscription();
        renderGuest();
      }
    }) || (() => {});

    if (accountPanel?.getIdentity()?.kind === 'registered') {
      void refresh();
      void ensureRealtimeSubscription();
    } else {
      renderGuest();
    }

    return {
      friendsClient,
      refresh,
      async destroy() {
        if (destroyed) return;
        destroyed = true;
        refreshVersion += 1;
        controller.abort();
        unsubscribeAccount();
        await stopRealtimeSubscription();
        await friendsClient.disconnect();
      },
    };
  }

  function mount() {
    if (mounted || typeof document === 'undefined') return mounted;

    const tabButtons = Array.from(document.querySelectorAll('[data-player-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-player-panel]'));
    const tabList = document.querySelector('.player-tabs');
    const summaryName = document.querySelector('#player-summary-name');
    const summaryKind = document.querySelector('#player-summary-kind');
    const summaryUid = document.querySelector('#player-summary-uid');
    const summaryBalance = document.querySelector('#player-summary-balance');
    const checkinGuest = document.querySelector('#checkin-guest-state');
    const checkinLoginButton = document.querySelector('#checkin-login-button');
    const checkinCalendar = document.querySelector('#checkin-calendar');
    const activityList = document.querySelector('#activity-list');
    const notificationList = document.querySelector('#notification-list');
    const shopProductList = document.querySelector('#shop-product-list');
    const inventoryList = document.querySelector('#inventory-list');
    const shopMessage = document.querySelector('#shop-message');
    const inventoryMessage = document.querySelector('#inventory-message');
    const purchaseDialog = document.querySelector('#shop-purchase-dialog');
    const purchaseName = document.querySelector('#shop-purchase-name');
    const purchasePrice = document.querySelector('#shop-purchase-price');
    const purchaseConfirm = document.querySelector('#shop-purchase-confirm');
    const purchaseCancel = document.querySelector('#shop-purchase-cancel');
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
    const shopClient = accountClient
      ? globalScope.PlayerShop?.createShopClient({ accountClient })
      : null;
    const eventController = new AbortController();
    const { signal } = eventController;
    const narrowTabs = globalScope.matchMedia?.('(max-width: 759px)') || null;
    const initialRoute = readPlayerRoute(globalScope.location?.href);
    let currentTab = initialRoute.tab;
    let currentActivityId = initialRoute.activity;
    let destroyed = false;
    let instance = null;
    let calendarRequest = 0;
    let activityRequest = 0;
    let notificationRequest = 0;
    let shopRequest = 0;
    let inventoryRequest = 0;
    let identityGeneration = 0;
    let actionPending = null;
    let activityItems = [];
    let notificationItems = [];
    let shopItems = [];
    let inventory = { makeupCard: 0, renameCard: 0 };
    let purchaseState = null;
    let purchasePending = false;
    let openNotificationId = null;
    const activityClaims = new Map();
    const notificationClaims = new Map();
    const notificationReads = new Map();
    const notificationReadFailures = new Set();
    let identityKey = getAccountKey(accountPanel?.getIdentity());
    const friendsPanel = mountFriendsPanel({
      accountPanel,
      accountClient,
      getCurrentTab: () => currentTab,
    });

    function setMessage(text = '', state = '', source = '') {
      if (!message) return;
      message.textContent = text;
      message.dataset.state = state;
      message.dataset.source = source;
    }

    function clearMessage(source) {
      if (message?.dataset.source === source) setMessage();
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
      if (summaryUid) {
        summaryUid.hidden = !registered;
        summaryUid.textContent = registered && identity.uid ? `UID ${identity.uid}` : '';
      }
      if (summaryBalance) {
        summaryBalance.hidden = !registered;
        summaryBalance.textContent = `金币 ${Number(economySnapshot.balance || 0)}`;
      }
      if (checkinGuest) checkinGuest.hidden = registered;
    }

    function createNode(tagName, className = '', text = '') {
      const node = document.createElement(tagName);
      node.className = className;
      if (text) node.textContent = text;
      return node;
    }

    function setPanelMessage(node, text = '', state = '') {
      if (!node) return;
      node.textContent = text;
      node.dataset.state = state;
    }

    function isRegistered() {
      return accountPanel?.getIdentity()?.kind === 'registered';
    }

    function shopFailureIsDefinitive(error) {
      const source = `${error?.code || ''} ${error?.message || ''}`;
      return DEFINITIVE_SHOP_ERRORS.some((code) => source.includes(code));
    }

    function productPurchaseState(product) {
      if (!isRegistered()) return { disabled: true, label: '登录后购买' };
      if (purchasePending && purchaseState?.product?.sku === product.sku) {
        return { disabled: true, label: '购买中' };
      }
      if (product.remainingLimit === 0) return { disabled: true, label: '已达限购' };
      const balance = Number(accountPanel?.getEconomySnapshot()?.balance || 0);
      if (balance < Number(product.price || 0)) return { disabled: true, label: '金币不足' };
      return { disabled: false, label: '购买道具' };
    }

    function renderShop() {
      if (!shopProductList) return;
      if (shopItems.length === 0) {
        shopProductList.replaceChildren(createNode('p', 'player-placeholder', '暂无上架商品。'));
        return;
      }
      const rows = shopItems.map((product) => {
        const row = createNode('article', 'shop-product-row');
        const copy = createNode('div', 'shop-product-copy');
        copy.append(
          createNode('strong', '', product.name),
          createNode('p', '', product.description),
        );
        const meta = createNode('div', 'shop-product-meta');
        const price = createNode('span', 'shop-product-price', `${Number(product.price || 0)} 金币`);
        const limit = product.purchaseLimit == null
          ? '不限购'
          : `已购 ${Number(product.purchasedCount || 0)} / ${product.purchaseLimit}`;
        const buttonState = productPurchaseState(product);
        const button = createNode('button', 'player-primary-action shop-buy-action', buttonState.label);
        button.type = 'button';
        button.dataset.shopBuy = product.sku;
        button.disabled = buttonState.disabled;
        button.addEventListener('click', () => openPurchase(product), { signal });
        meta.append(price, createNode('span', 'shop-product-limit', limit), button);
        row.append(copy, meta);
        return row;
      });
      shopProductList.replaceChildren(...rows);
    }

    function inventoryRow(name, quantity, actionLabel, target) {
      const row = createNode('article', 'inventory-row');
      const copy = createNode('div', 'inventory-copy');
      copy.append(createNode('strong', '', name), createNode('span', '', `${quantity} 张`));
      const link = createNode('a', 'player-secondary-link', actionLabel);
      if (target === 'account') {
        link.href = '#account-dialog';
        link.addEventListener('click', (event) => {
          event.preventDefault();
          accountPanel?.open();
        }, { signal });
      } else {
        link.href = `/player/?tab=${target}`;
      }
      row.append(copy, link);
      return row;
    }

    function renderInventory() {
      if (!inventoryList) return;
      inventoryList.replaceChildren(
        inventoryRow('补签卡', Number(inventory.makeupCard || 0), '去签到月历', 'checkin'),
        inventoryRow('改名卡', Number(inventory.renameCard || 0), '去修改游戏名', 'account'),
      );
      setPanelMessage(
        inventoryMessage,
        isRegistered() ? '' : '登录正式账号后可查看和使用背包道具。',
        isRegistered() ? '' : 'error',
      );
    }

    async function refreshShop() {
      if (!shopClient) return false;
      const request = ++shopRequest;
      shopProductList?.setAttribute('aria-busy', 'true');
      try {
        const products = await shopClient.listProducts();
        if (destroyed || request !== shopRequest) return false;
        shopItems = products;
        renderShop();
        setPanelMessage(shopMessage);
        return true;
      } catch (error) {
        if (destroyed || request !== shopRequest) return false;
        const text = globalScope.PlayerShop?.mapShopError?.(error)
          || '商城加载失败，请稍后重试';
        shopProductList?.replaceChildren(createNode('p', 'player-placeholder', text));
        setPanelMessage(shopMessage, text, 'error');
        return false;
      } finally {
        if (!destroyed && request === shopRequest) shopProductList?.setAttribute('aria-busy', 'false');
      }
    }

    async function refreshInventory() {
      const request = ++inventoryRequest;
      if (!shopClient || !isRegistered()) {
        inventory = { makeupCard: 0, renameCard: 0 };
        renderInventory();
        return false;
      }
      inventoryList?.setAttribute('aria-busy', 'true');
      try {
        const nextInventory = await shopClient.getInventory();
        if (destroyed || request !== inventoryRequest) return false;
        inventory = nextInventory;
        renderInventory();
        return true;
      } catch (error) {
        if (destroyed || request !== inventoryRequest) return false;
        const text = globalScope.PlayerShop?.mapShopError?.(error)
          || '背包加载失败，请稍后重试';
        setPanelMessage(inventoryMessage, text, 'error');
        return false;
      } finally {
        if (!destroyed && request === inventoryRequest) inventoryList?.setAttribute('aria-busy', 'false');
      }
    }

    function closePurchase({ clear = true } = {}) {
      purchaseDialog?.close?.();
      if (clear) purchaseState = null;
    }

    function openPurchase(product) {
      if (!purchaseDialog || purchasePending || productPurchaseState(product).disabled) return;
      purchaseState = { product, requestId: createRequestId() };
      if (purchaseName) purchaseName.textContent = product.name;
      if (purchasePrice) purchasePrice.textContent = `支付 ${Number(product.price || 0)} 金币`;
      purchaseDialog.showModal?.();
    }

    async function runPurchase() {
      if (!purchaseState || purchasePending || !shopClient) return;
      if (!purchaseState.requestId) purchaseState.requestId = createRequestId();
      const state = purchaseState;
      purchasePending = true;
      if (purchaseConfirm) {
        purchaseConfirm.disabled = true;
        purchaseConfirm.setAttribute('aria-busy', 'true');
      }
      renderShop();
      try {
        const result = await shopClient.buy(state.product.sku, state.requestId);
        if (destroyed || purchaseState !== state) return;
        const walletReady = await refreshWallet();
        const [shopReady, inventoryReady] = await Promise.all([refreshShop(), refreshInventory()]);
        if (destroyed || purchaseState !== state) return;
        if (!walletReady || !shopReady || !inventoryReady) {
          setPanelMessage(shopMessage, '购买成功，但状态刷新失败，请刷新页面', 'error');
          return;
        }
        closePurchase();
        setPanelMessage(shopMessage, `购买成功，支付 ${Number(result?.pricePaid || state.product.price)} 金币`, 'success');
      } catch (error) {
        if (destroyed || purchaseState !== state) return;
        if (shopFailureIsDefinitive(error)) state.requestId = null;
        const text = globalScope.PlayerShop?.mapShopError?.(error)
          || '购买失败，请稍后重试';
        setPanelMessage(shopMessage, text, 'error');
      } finally {
        purchasePending = false;
        if (!destroyed) {
          if (purchaseConfirm) {
            purchaseConfirm.disabled = false;
            purchaseConfirm.setAttribute('aria-busy', 'false');
          }
          renderShop();
        }
      }
    }

    function formatDate(value) {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) return '时间未定';
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
      }, {});
      return `${Number(parts.year)} 年 ${Number(parts.month)} 月 ${Number(parts.day)} 日`;
    }

    function formatActivityPeriod(activity) {
      if (activity.startsAt && activity.endsAt) {
        return `${formatDate(activity.startsAt)} 至 ${formatDate(activity.endsAt)}`;
      }
      if (activity.startsAt) return `${formatDate(activity.startsAt)} 起`;
      if (activity.endsAt) return `截至 ${formatDate(activity.endsAt)}`;
      return '长期有效';
    }

    function createExternalLink(url, label, className, dataKey) {
      const link = createNode('a', className, label);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset[dataKey] = '';
      return link;
    }

    function renderRetryState(container, text, dataKey, retry) {
      if (!container) return;
      const shell = createNode('div', 'player-state player-state--error');
      shell.append(createNode('p', '', text));
      const button = createNode('button', 'player-secondary-action', '重试');
      button.type = 'button';
      button.dataset[dataKey] = '';
      button.addEventListener('click', () => void retry(), { signal });
      shell.append(button);
      container.className = 'player-placeholder';
      container.replaceChildren(shell);
    }

    function createActivityCover(activity) {
      const cover = createNode('div', 'activity-cover');
      const fallback = createNode('span', 'activity-cover-fallback', activity.coverUrl ? '封面不可用' : '暂无封面');
      if (!activity.coverUrl) {
        cover.append(fallback);
        return cover;
      }
      fallback.hidden = true;
      const image = createNode('img', 'activity-cover-image');
      image.src = activity.coverUrl;
      image.alt = `${activity.title} 活动封面`;
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.dataset.activityCover = activity.id;
      image.addEventListener('error', () => {
        image.hidden = true;
        fallback.hidden = false;
      }, { signal, once: true });
      cover.append(image, fallback);
      return cover;
    }

    function activityStatus(activity) {
      const rewardAmount = Number(activity.rewardAmount || 0);
      if (rewardAmount <= 0) return activity.claimed ? '已参与' : '查看活动';
      return activity.claimed ? '已领取' : `领取 ${rewardAmount} 金币`;
    }

    function createActivityClaimButton(activity) {
      const rewardAmount = Number(activity.rewardAmount || 0);
      const button = createNode('button', 'player-primary-action', activityClaims.has(activity.id)
        ? '领取中…'
        : activityStatus(activity));
      button.type = 'button';
      button.dataset.activityClaim = activity.id;
      button.disabled = activity.claimed || activityClaims.has(activity.id);
      button.setAttribute('aria-busy', String(activityClaims.has(activity.id)));
      button.setAttribute('aria-label', activity.claimed
        ? `${activity.title}奖励已领取`
        : `领取${activity.title}的 ${rewardAmount} 金币`);
      button.addEventListener('click', () => void runActivityClaim(activity.id, button), { signal });
      return button;
    }

    function renderActivityDetail(activity) {
      const detail = createNode('article', 'activity-detail');
      detail.dataset.activityDetail = activity.id;
      detail.setAttribute('aria-label', `${activity.title}详情`);
      detail.append(
        createNode('p', 'activity-detail-kicker', '活动详情'),
        createNode('h3', '', activity.title),
        createNode('p', 'activity-detail-period', `有效期：${formatActivityPeriod(activity)}`),
        createNode('p', 'activity-detail-body', activity.body || '活动暂未提供更多说明。'),
      );

      const actions = createNode('div', 'activity-detail-actions');
      const rewardAmount = Number(activity.rewardAmount || 0);
      if (rewardAmount > 0) {
        actions.append(createActivityClaimButton(activity));
      } else {
        actions.append(createNode('span', 'activity-detail-status', activityStatus(activity)));
      }
      if (activity.actionUrl) {
        actions.append(createExternalLink(
          activity.actionUrl,
          activity.actionLabel || '查看活动页面',
          'player-secondary-link',
          'activityAction',
        ));
      }
      detail.append(actions);
      return detail;
    }

    function renderActivities() {
      if (!activityList) return;
      if (activityItems.length === 0) {
        activityList.className = 'player-placeholder';
        activityList.replaceChildren(createNode('p', '', '暂无可参与的活动。'));
        if (currentActivityId) setMessage('活动已下架或不可用', 'error');
        return;
      }

      const layout = createNode('div', 'activity-layout');
      const cards = createNode('div', 'activity-cards');
      activityItems.forEach((activity) => {
        const selected = activity.id === currentActivityId;
        const card = createNode('article', `activity-card${selected ? ' activity-card--selected' : ''}`);
        card.dataset.activityId = activity.id;
        if (selected) card.setAttribute('aria-current', 'true');
        const content = createNode('div', 'activity-card-content');
        content.append(
          createNode('h3', '', activity.title),
          createNode('p', 'activity-card-period', formatActivityPeriod(activity)),
          createNode('p', 'activity-card-reward', Number(activity.rewardAmount || 0) > 0
            ? `奖励 ${Number(activity.rewardAmount)} 金币`
            : '无金币奖励'),
          createNode('span', 'activity-card-status', activityStatus(activity)),
        );
        const openButton = createNode('button', 'player-secondary-action', selected ? '正在查看' : '查看详情');
        openButton.type = 'button';
        openButton.dataset.activityOpen = activity.id;
        openButton.disabled = selected;
        openButton.setAttribute('aria-label', `查看${activity.title}详情`);
        openButton.addEventListener('click', () => openActivity(activity.id), { signal });
        const actions = createNode('div', 'activity-card-actions');
        actions.append(openButton);
        if (Number(activity.rewardAmount || 0) > 0) {
          actions.append(createActivityClaimButton(activity));
        }
        content.append(actions);
        card.append(createActivityCover(activity), content);
        cards.append(card);
      });
      layout.append(cards);

      const selectedActivity = activityItems.find((activity) => activity.id === currentActivityId);
      if (selectedActivity) layout.append(renderActivityDetail(selectedActivity));
      else if (currentActivityId) setMessage('活动已下架或不可用', 'error');
      activityList.className = 'activity-list';
      activityList.replaceChildren(layout);
    }

    function openActivity(activityId, unavailableMessage = '活动已下架或不可用') {
      currentTab = 'activities';
      currentActivityId = activityId;
      const url = new URL(globalScope.location.href);
      url.searchParams.set('tab', 'activities');
      url.searchParams.set('activity', activityId);
      globalScope.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      renderTabs();
      renderActivities();
      if (!activityItems.some((activity) => activity.id === activityId)) {
        setMessage(unavailableMessage, 'error');
      }
    }

    async function refreshActivities() {
      if (!activitiesClient) {
        renderRetryState(activityList, '活动服务暂时不可用，请稍后重试', 'activityRetry', refreshActivities);
        return false;
      }
      const request = ++activityRequest;
      activityList?.setAttribute('aria-busy', 'true');
      try {
        const items = await activitiesClient.listActive();
        if (destroyed || request !== activityRequest) return false;
        activityItems = Array.isArray(items) ? items : [];
        renderActivities();
        clearMessage('activities-load');
        return true;
      } catch (error) {
        if (destroyed || request !== activityRequest) return false;
        const text = globalScope.PlayerActivities?.mapActivitiesError?.(error)
          || '活动加载失败，请稍后重试';
        renderRetryState(activityList, text, 'activityRetry', refreshActivities);
        setMessage(text, 'error', 'activities-load');
        return false;
      } finally {
        if (!destroyed && request === activityRequest) activityList?.setAttribute('aria-busy', 'false');
      }
    }

    async function runActivityClaim(activityId, button) {
      const activity = activityItems.find((item) => item.id === activityId);
      if (!activity || activity.claimed || activityClaims.has(activityId) || destroyed) return;
      if (accountPanel?.getIdentity()?.kind !== 'registered') {
        setMessage('请先登录正式账号领取活动奖励', 'error');
        accountPanel?.open();
        return;
      }
      const generation = identityGeneration;
      const token = { generation };
      activityClaims.set(activityId, token);
      button.disabled = true;
      button.textContent = '领取中…';
      button.setAttribute('aria-busy', 'true');
      renderActivities();
      try {
        const result = await activitiesClient.claimReward(activityId, createRequestId());
        if (destroyed || generation !== identityGeneration) return;
        const currentActivity = activityItems.find((item) => item.id === activityId);
        if (!currentActivity) return;
        currentActivity.claimed = true;
        currentActivity.claimedAt = result?.claimedAt || currentActivity.claimedAt || null;
        const refreshed = await refreshWallet();
        if (destroyed || generation !== identityGeneration) return;
        setMessage(refreshed
          ? `活动奖励领取成功，获得 ${formatCoinDelta(result?.rewardAmount ?? currentActivity.rewardAmount)}`
          : '奖励已领取，但钱包刷新失败，请刷新页面', refreshed ? 'success' : 'error');
      } catch (error) {
        if (destroyed || generation !== identityGeneration) return;
        const text = globalScope.PlayerActivities?.mapActivitiesError?.(error)
          || '活动领取失败，请稍后重试';
        const currentActivity = activityItems.find((item) => item.id === activityId);
        if (currentActivity && (text.includes('已经领取') || text.includes('已领取'))) currentActivity.claimed = true;
        if (currentActivity?.claimed) {
          let refreshed = false;
          try { refreshed = await refreshWallet(); } catch { /* Keep claimed state and report refresh failure. */ }
          if (destroyed || generation !== identityGeneration) return;
          setMessage(refreshed ? text : '奖励已领取，但钱包刷新失败，请刷新页面', refreshed ? 'success' : 'error');
        } else {
          setMessage(text, 'error');
        }
      } finally {
        if (activityClaims.get(activityId) === token) activityClaims.delete(activityId);
        if (!destroyed && generation === identityGeneration) {
          button.disabled = Boolean(activityItems.find((item) => item.id === activityId)?.claimed);
          button.setAttribute('aria-busy', 'false');
          renderActivities();
        }
      }
    }

    function isNotificationExpired(notification) {
      if (!notification.expiresAt) return false;
      const expiresAt = Date.parse(notification.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt <= Date.now();
    }

    function renderNotifications() {
      if (!notificationList) return;
      if (notificationItems.length === 0) {
        notificationList.className = 'player-placeholder';
        notificationList.replaceChildren(createNode('p', '', '暂无通知。'));
        return;
      }

      const inbox = createNode('div', 'notification-inbox');
      [...notificationItems]
        .sort((left, right) => (
          (Date.parse(right.visibleAt) || 0) - (Date.parse(left.visibleAt) || 0)
          || String(right.id).localeCompare(String(left.id))
        ))
        .forEach((notification) => {
          const expired = isNotificationExpired(notification);
          const opened = openNotificationId === notification.id;
          const item = createNode('article', `notification-item${opened ? ' notification-item--open' : ''}`);
          item.dataset.notificationId = notification.id;
          const heading = createNode('div', 'notification-heading');
          const title = createNode('h3', '', notification.title);
          if (!notification.isRead) {
            const unread = createNode('span', 'notification-unread-dot');
            unread.dataset.notificationUnread = '';
            unread.setAttribute('aria-label', '未读通知');
            heading.append(unread);
          }
          heading.append(title, createNode('time', 'notification-time', formatDate(notification.visibleAt)));
          item.append(heading);

          const statuses = createNode('div', 'notification-statuses');
          const rewardAmount = Number(notification.rewardAmount || 0);
          statuses.append(createNode('span', 'notification-read-status', notification.isRead ? '已读' : '未读'));
          if (expired) statuses.append(createNode('span', 'notification-expired-status', '已过期'));
          if (rewardAmount > 0) {
            statuses.append(createNode('span', 'notification-reward-status', notification.rewardClaimed
              ? `奖励 ${rewardAmount} 金币 · 已领取`
              : `奖励 ${rewardAmount} 金币 · 未领取`));
          } else {
            statuses.append(createNode('span', 'notification-reward-status', '无奖励'));
          }
          item.append(statuses);

          const detailId = `notification-detail-${notification.id}`;
          const openButton = createNode('button', 'player-secondary-action notification-toggle', opened ? '收起详情' : '查看详情');
          openButton.type = 'button';
          openButton.dataset.notificationOpen = notification.id;
          openButton.setAttribute('aria-expanded', String(opened));
          openButton.setAttribute('aria-controls', detailId);
          openButton.addEventListener('click', () => void toggleNotification(notification.id), { signal });
          item.append(openButton);

          const detail = createNode('div', 'notification-detail');
          detail.id = detailId;
          detail.hidden = !opened;
          detail.append(createNode('p', 'notification-body', notification.body || '该通知暂无正文。'));
          const actions = createNode('div', 'notification-actions');
          if (opened && !notification.isRead && notificationReadFailures.has(notification.id)) {
            const retryRead = createNode('button', 'player-secondary-action', notificationReads.has(notification.id)
              ? '正在标记…'
              : '重试标记已读');
            retryRead.type = 'button';
            retryRead.dataset.notificationReadRetry = notification.id;
            retryRead.disabled = notificationReads.has(notification.id);
            retryRead.setAttribute('aria-busy', String(notificationReads.has(notification.id)));
            retryRead.addEventListener('click', () => {
              retryRead.disabled = true;
              retryRead.textContent = '正在标记…';
              retryRead.setAttribute('aria-busy', 'true');
              void markNotificationRead(notification.id);
            }, { signal });
            actions.append(retryRead);
          }
          if (notification.activityId) {
            const activityButton = createNode('button', 'player-secondary-action', '查看关联活动');
            activityButton.type = 'button';
            activityButton.dataset.notificationActivity = notification.activityId;
            activityButton.addEventListener('click', () => {
              openActivity(notification.activityId, '关联活动可能已下架，请在活动页确认');
            }, { signal });
            actions.append(activityButton);
          }
          if (notification.actionUrl) {
            actions.append(createExternalLink(
              notification.actionUrl,
              '打开通知链接',
              'player-secondary-link',
              'notificationAction',
            ));
          }
          if (rewardAmount > 0) {
            const claimButton = createNode('button', 'player-primary-action', notificationClaims.has(notification.id)
              ? '领取中…'
              : notification.rewardClaimed ? '已领取' : `领取 ${rewardAmount} 金币`);
            claimButton.type = 'button';
            claimButton.dataset.notificationClaim = notification.id;
            claimButton.disabled = expired || notification.rewardClaimed || notificationClaims.has(notification.id);
            claimButton.setAttribute('aria-busy', String(notificationClaims.has(notification.id)));
            claimButton.setAttribute('aria-label', expired
              ? `${notification.title}奖励已过期`
              : notification.rewardClaimed ? `${notification.title}奖励已领取` : `领取${notification.title}奖励`);
            claimButton.addEventListener('click', () => void runNotificationClaim(notification.id, claimButton), { signal });
            actions.append(claimButton);
          }
          detail.append(actions);
          item.append(detail);
          inbox.append(item);
        });
      notificationList.className = 'notification-list';
      notificationList.replaceChildren(inbox);
    }

    async function markNotificationRead(notificationId) {
      const notification = notificationItems.find((item) => item.id === notificationId);
      if (!notification || notification.isRead || notificationReads.has(notificationId)
          || accountPanel?.getIdentity()?.kind !== 'registered' || destroyed) return;
      const generation = identityGeneration;
      const token = { generation };
      notificationReads.set(notificationId, token);
      notificationReadFailures.delete(notificationId);
      try {
        const result = await notificationsClient.markRead(notificationId);
        if (destroyed || generation !== identityGeneration) return;
        const currentNotification = notificationItems.find((item) => item.id === notificationId);
        if (!currentNotification) return;
        currentNotification.isRead = true;
        currentNotification.readAt = result?.readAt || currentNotification.readAt || null;
      } catch (error) {
        if (destroyed || generation !== identityGeneration) return;
        notificationReadFailures.add(notificationId);
        const text = globalScope.PlayerNotifications?.mapNotificationsError?.(error)
          || '通知已读状态更新失败，请重试';
        setMessage(text, 'error');
      } finally {
        if (notificationReads.get(notificationId) === token) notificationReads.delete(notificationId);
        if (!destroyed && generation === identityGeneration) renderNotifications();
      }
    }

    async function toggleNotification(notificationId) {
      const notification = notificationItems.find((item) => item.id === notificationId);
      if (!notification || destroyed) return;
      if (openNotificationId === notificationId) {
        openNotificationId = null;
        renderNotifications();
        return;
      }
      openNotificationId = notificationId;
      renderNotifications();
      await markNotificationRead(notificationId);
    }

    async function refreshNotifications() {
      if (!notificationsClient) {
        renderRetryState(notificationList, '通知服务暂时不可用，请稍后重试', 'notificationRetry', refreshNotifications);
        return false;
      }
      const request = ++notificationRequest;
      notificationList?.setAttribute('aria-busy', 'true');
      try {
        const items = await notificationsClient.list();
        if (destroyed || request !== notificationRequest) return false;
        notificationItems = Array.isArray(items) ? items : [];
        renderNotifications();
        clearMessage('notifications-load');
        return true;
      } catch (error) {
        if (destroyed || request !== notificationRequest) return false;
        const text = globalScope.PlayerNotifications?.mapNotificationsError?.(error)
          || '通知加载失败，请稍后重试';
        renderRetryState(notificationList, text, 'notificationRetry', refreshNotifications);
        setMessage(text, 'error', 'notifications-load');
        return false;
      } finally {
        if (!destroyed && request === notificationRequest) notificationList?.setAttribute('aria-busy', 'false');
      }
    }

    async function runNotificationClaim(notificationId, button) {
      const notification = notificationItems.find((item) => item.id === notificationId);
      if (!notification || notification.rewardClaimed || isNotificationExpired(notification)
          || notificationClaims.has(notificationId) || destroyed) return;
      if (accountPanel?.getIdentity()?.kind !== 'registered') {
        setMessage('请先登录正式账号领取通知奖励', 'error');
        accountPanel?.open();
        return;
      }
      const generation = identityGeneration;
      const token = { generation };
      notificationClaims.set(notificationId, token);
      button.disabled = true;
      button.textContent = '领取中…';
      button.setAttribute('aria-busy', 'true');
      try {
        const result = await notificationsClient.claimReward(notificationId, createRequestId());
        if (destroyed || generation !== identityGeneration) return;
        const currentNotification = notificationItems.find((item) => item.id === notificationId);
        if (!currentNotification) return;
        currentNotification.rewardClaimed = true;
        currentNotification.rewardClaimedAt = result?.claimedAt || currentNotification.rewardClaimedAt || null;
        const refreshed = await refreshWallet();
        if (destroyed || generation !== identityGeneration) return;
        setMessage(refreshed
          ? `通知奖励领取成功，获得 ${formatCoinDelta(result?.rewardAmount ?? currentNotification.rewardAmount)}`
          : '奖励已领取，但钱包刷新失败，请刷新页面', refreshed ? 'success' : 'error');
      } catch (error) {
        if (destroyed || generation !== identityGeneration) return;
        const text = globalScope.PlayerNotifications?.mapNotificationsError?.(error)
          || '通知奖励领取失败，请稍后重试';
        const currentNotification = notificationItems.find((item) => item.id === notificationId);
        if (currentNotification && (text.includes('奖励已领取') || text === '已领取')) {
          currentNotification.rewardClaimed = true;
        }
        if (currentNotification?.rewardClaimed) {
          let refreshed = false;
          try { refreshed = await refreshWallet(); } catch { /* Keep claimed state and report refresh failure. */ }
          if (destroyed || generation !== identityGeneration) return;
          setMessage(refreshed ? text : '奖励已领取，但钱包刷新失败，请刷新页面', refreshed ? 'success' : 'error');
        } else {
          setMessage(text, 'error');
        }
      } finally {
        if (notificationClaims.get(notificationId) === token) notificationClaims.delete(notificationId);
        if (!destroyed && generation === identityGeneration) {
          button.disabled = Boolean(notificationItems.find((item) => item.id === notificationId)?.rewardClaimed);
          button.setAttribute('aria-busy', 'false');
          renderNotifications();
        }
      }
    }

    function setActionDisabled(disabled) {
      checkinCalendar?.querySelectorAll('[data-checkin-action]').forEach((button) => {
        button.disabled = disabled;
      });
    }

    function renderGuestCalendar() {
      if (!checkinCalendar) return;
      checkinCalendar.className = 'player-placeholder';
      const prompt = createNode('p', '', '登录正式账号后，这里会显示当月签到记录。');
      checkinCalendar.replaceChildren(prompt);
    }

    function openMakeupConfirmation(day, action) {
      if (!checkinCalendar || actionPending) return;
      const oldDialog = checkinCalendar.querySelector('[data-makeup-dialog]');
      oldDialog?.close?.();
      oldDialog?.remove?.();

      const dialog = createNode('dialog', 'checkin-confirmation');
      dialog.dataset.makeupDialog = '';
      const titleId = `makeup-title-${day.checkinDate}`;
      dialog.setAttribute('aria-labelledby', titleId);
      const shell = createNode('div', 'checkin-confirmation-shell');
      const title = createNode('h4', '', `${Number(day.checkinDate.slice(5, 7))} 月 ${Number(day.checkinDate.slice(8, 10))} 日补签确认`);
      title.id = titleId;
      const details = createNode('div', 'checkin-confirmation-details');
      details.append(
        createNode('p', '', `奖励 ${action.rewardAmount} 金币`),
        createNode('p', '', `费用 ${action.makeupCost} 金币`),
        createNode('p', 'checkin-confirmation-net', `净变化 ${formatCoinDelta(action.netAmount)}`),
      );
      const controls = createNode('div', 'checkin-confirmation-actions');
      const cancelButton = createNode('button', 'checkin-secondary-action', '取消');
      cancelButton.type = 'button';
      const confirmButton = createNode('button', 'player-primary-action', '使用金币补签');
      confirmButton.type = 'button';
      confirmButton.dataset.checkinAction = 'confirm-makeup';
      controls.append(cancelButton, confirmButton);
      shell.append(title, details, controls);
      dialog.append(shell);
      checkinCalendar.append(dialog);

      cancelButton.addEventListener('click', () => dialog.close(), { signal });
      confirmButton.addEventListener('click', () => {
        void runCheckinAction({ type: 'makeup', day, action, dialog });
      }, { signal });
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }

    function renderCalendar(days) {
      if (!checkinCalendar) return;
      const calendarToday = days.find((day) => day.isToday)?.checkinDate || getHongKongDate();
      const cells = buildCalendarCells(days, calendarToday);
      if (cells.length === 0) {
        checkinCalendar.className = 'player-placeholder';
        checkinCalendar.replaceChildren(createNode('p', '', '本月暂无签到数据。'));
        return;
      }

      const firstDay = cells.find((cell) => cell.kind === 'day');
      const monthLabel = `${Number(firstDay.date.slice(0, 4))} 年 ${Number(firstDay.date.slice(5, 7))} 月`;
      const heading = createNode('div', 'checkin-calendar-heading');
      heading.append(
        createNode('h3', '', monthLabel),
        createNode('p', '', '每日奖励与签到状态'),
      );
      const weekdays = createNode('div', 'checkin-weekdays');
      weekdays.setAttribute('aria-hidden', 'true');
      ['一', '二', '三', '四', '五', '六', '日'].forEach((label) => {
        weekdays.append(createNode('span', '', label));
      });
      const grid = createNode('div', 'checkin-grid');
      grid.setAttribute('role', 'grid');
      grid.setAttribute('aria-label', `${monthLabel}签到月历`);

      let weekRow = null;
      cells.forEach((cell, index) => {
        if (index % 7 === 0) {
          weekRow = createNode('div', 'checkin-week');
          weekRow.setAttribute('role', 'row');
          grid.append(weekRow);
        }
        if (cell.kind === 'empty') {
          const empty = createNode('span', 'checkin-day checkin-day--empty');
          empty.dataset.calendarEmpty = '';
          empty.setAttribute('aria-hidden', 'true');
          weekRow.append(empty);
          return;
        }

        const dayNode = createNode('div', `checkin-day checkin-day--${cell.status}`);
        dayNode.dataset.checkinStatus = cell.status;
        dayNode.setAttribute('role', 'gridcell');
        dayNode.setAttribute(
          'aria-label',
          `${cell.date}，${cell.statusLabel}，奖励 ${Number(cell.rewardAmount || 0)} 金币`,
        );
        dayNode.append(
          createNode('strong', 'checkin-day-number', String(cell.dayNumber)),
          createNode('span', 'checkin-day-reward', `+${Number(cell.rewardAmount || 0)} 金币`),
          createNode('span', 'checkin-day-status', cell.statusLabel),
        );

        const action = getCheckinAction(cell, calendarToday);
        if (action) {
          const button = createNode('button', 'checkin-day-action', action.label);
          button.type = 'button';
          button.dataset.checkinAction = action.type;
          button.disabled = actionPending;
          if (action.type === 'checkin') {
            button.addEventListener('click', () => {
              void runCheckinAction({ type: 'checkin', day: cell, action });
            }, { signal });
          } else {
            button.addEventListener('click', () => openMakeupConfirmation(cell, action), { signal });
          }
          dayNode.append(button);
        }
        weekRow.append(dayNode);
      });

      checkinCalendar.className = 'checkin-calendar';
      checkinCalendar.replaceChildren(heading, weekdays, grid);
    }

    async function refreshCheckinMonth() {
      const identity = accountPanel?.getIdentity();
      if (!checkinClient || identity?.kind !== 'registered') {
        renderGuestCalendar();
        return false;
      }

      const request = ++calendarRequest;
      const month = getHongKongDate().slice(0, 7);
      checkinCalendar?.setAttribute('aria-busy', 'true');
      try {
        const days = await checkinClient.getMonth(month);
        if (destroyed || request !== calendarRequest) return false;
        renderCalendar(days);
        return true;
      } catch (error) {
        if (destroyed || request !== calendarRequest) return false;
        const text = globalScope.PlayerCheckin?.mapCheckinError?.(error)
          || '签到月历加载失败，请稍后重试';
        checkinCalendar?.replaceChildren(createNode('p', '', text));
        setMessage(text, 'error');
        return false;
      } finally {
        if (!destroyed && request === calendarRequest) {
          checkinCalendar?.setAttribute('aria-busy', 'false');
        }
      }
    }

    async function refreshWallet() {
      if (typeof accountPanel?.refreshEconomy === 'function') {
        const snapshot = await accountPanel.refreshEconomy({ reportError: false });
        return snapshot?.loaded !== false;
      } else if (typeof economyClient?.refresh === 'function') {
        const snapshot = await economyClient.refresh();
        return snapshot?.loaded !== false;
      }
      return false;
    }

    async function runCheckinAction({ type, day, action, dialog = null }) {
      if (actionPending || destroyed || !checkinClient) return;
      const generation = identityGeneration;
      const token = { generation };
      actionPending = token;
      setActionDisabled(true);
      let completed = false;
      let refreshed = false;
      try {
        const requestId = createRequestId();
        const result = type === 'checkin'
          ? await checkinClient.checkIn(requestId)
          : await checkinClient.makeUp(day.checkinDate, 'coins', requestId);
        completed = true;
        if (destroyed || generation !== identityGeneration || actionPending !== token) return;
        dialog?.close?.();
        const refreshResults = await Promise.all([refreshCheckinMonth(), refreshWallet()]);
        refreshed = refreshResults.every(Boolean);
        if (destroyed || generation !== identityGeneration || actionPending !== token) return;
        if (!refreshed) {
          setMessage('操作已成功，但状态刷新失败，请刷新页面', 'error');
          return;
        }
        const amount = type === 'checkin'
          ? Number(result?.rewardAmount ?? action.rewardAmount)
          : action.netAmount;
        setMessage(
          type === 'checkin'
            ? `签到成功，获得 ${formatCoinDelta(amount)}`
            : `补签成功，净变化 ${formatCoinDelta(amount)}`,
          'success',
        );
      } catch (error) {
        if (destroyed || generation !== identityGeneration || actionPending !== token) return;
        const text = completed
          ? '操作已成功，但状态刷新失败，请刷新页面'
          : globalScope.PlayerCheckin?.mapCheckinError?.(error)
            || '签到失败，请稍后重试';
        setMessage(text, 'error');
      } finally {
        if (actionPending === token) actionPending = null;
        if (!destroyed && generation === identityGeneration) setActionDisabled(completed && !refreshed);
      }
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

    function syncTabOrientation() {
      tabList?.setAttribute('aria-orientation', narrowTabs?.matches ? 'horizontal' : 'vertical');
    }

    function replaceTab(tab) {
      currentTab = normalizePlayerTab(tab);
      const url = new URL(globalScope.location.href);
      url.searchParams.set('tab', currentTab);
      if (currentTab !== 'activities') {
        currentActivityId = null;
        url.searchParams.delete('activity');
      } else if (currentActivityId) {
        url.searchParams.set('activity', currentActivityId);
      } else {
        url.searchParams.delete('activity');
      }
      globalScope.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      renderTabs();
      if (currentTab === 'friends') void friendsPanel?.refresh();
      if (currentTab === 'shop') void refreshShop();
      if (currentTab === 'inventory') void refreshInventory();
    }

    function focusTab(index) {
      const button = tabButtons[(index + tabButtons.length) % tabButtons.length];
      button?.focus();
      if (button) replaceTab(button.dataset.playerTab);
    }

    tabButtons.forEach((button, index) => {
      button.addEventListener('click', () => replaceTab(button.dataset.playerTab), { signal });
      button.addEventListener('keydown', (event) => {
        const orientation = tabList?.getAttribute('aria-orientation') || 'vertical';
        const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
        const previousKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
        if (event.key === nextKey) {
          event.preventDefault();
          focusTab(index + 1);
        } else if (event.key === previousKey) {
          event.preventDefault();
          focusTab(index - 1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          focusTab(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          focusTab(tabButtons.length - 1);
        }
      }, { signal });
    });

    checkinLoginButton?.addEventListener('click', () => accountPanel?.open(), { signal });
    purchaseConfirm?.addEventListener('click', () => void runPurchase(), { signal });
    purchaseCancel?.addEventListener('click', () => {
      if (!purchasePending) closePurchase();
    }, { signal });
    purchaseDialog?.addEventListener('cancel', (event) => {
      if (purchasePending) event.preventDefault();
      else purchaseState = null;
    }, { signal });
    narrowTabs?.addEventListener?.('change', syncTabOrientation);
    const unsubscribe = accountPanel?.subscribe((state) => {
      const nextIdentity = state?.identity || accountPanel?.getIdentity() || { kind: 'guest' };
      const nextKey = getAccountKey(nextIdentity);
      renderSummary(state);
      renderShop();
      if (nextKey === identityKey) return;
      identityKey = nextKey;
      identityGeneration += 1;
      calendarRequest += 1;
      activityRequest += 1;
      notificationRequest += 1;
      shopRequest += 1;
      inventoryRequest += 1;
      actionPending = null;
      activityItems = [];
      notificationItems = [];
      shopItems = [];
      inventory = { makeupCard: 0, renameCard: 0 };
      purchasePending = false;
      closePurchase();
      currentActivityId = null;
      openNotificationId = null;
      activityClaims.clear();
      notificationClaims.clear();
      notificationReads.clear();
      notificationReadFailures.clear();
      const url = new URL(globalScope.location.href);
      if (url.searchParams.has('activity')) {
        url.searchParams.delete('activity');
        globalScope.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
      renderActivities();
      renderNotifications();
      renderShop();
      renderInventory();
      checkinCalendar?.replaceChildren(createNode('p', '', '正在加载新账号的签到数据。'));
      setMessage();
      if (nextIdentity.kind === 'registered') void refreshCheckinMonth();
      else renderGuestCalendar();
      void refreshActivities();
      void refreshNotifications();
      void refreshShop();
      if (nextIdentity.kind === 'registered') void refreshInventory();
    }) || (() => {});

    syncTabOrientation();
    renderTabs();
    renderSummary();
    if (!accountPanel || !checkinClient || !activitiesClient || !notificationsClient || !shopClient || !economyClient) {
      setMessage('玩家服务暂时不可用，请稍后刷新页面', 'error');
    }
    if (accountPanel?.getIdentity()?.kind === 'registered' && checkinClient) void refreshCheckinMonth();
    else renderGuestCalendar();
    void refreshActivities();
    void refreshNotifications();
    void refreshShop();
    void refreshInventory();

    instance = {
      accountClient,
      economyClient,
      checkinClient,
      activitiesClient,
      notificationsClient,
      shopClient,
      friendsClient: friendsPanel?.friendsClient || null,
      getTab: () => currentTab,
      refreshActivities,
      refreshNotifications,
      refreshShop,
      refreshInventory,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        identityGeneration += 1;
        calendarRequest += 1;
        activityRequest += 1;
        notificationRequest += 1;
        shopRequest += 1;
        inventoryRequest += 1;
        purchasePending = false;
        closePurchase();
        eventController.abort();
        narrowTabs?.removeEventListener?.('change', syncTabOrientation);
        unsubscribe();
        void friendsPanel?.destroy();
        if (mounted === instance) mounted = null;
      },
    };
    mounted = instance;
    return instance;
  }

  const playerCenter = {
    buildCalendarCells,
    formatCoinDelta,
    getCheckinAction,
    mount,
    normalizePlayerTab,
    readPlayerRoute,
  };
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
