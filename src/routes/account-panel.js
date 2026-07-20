(function initAccountPanel(globalScope) {
  'use strict';

  let mounted = null;
  let mountOptions = {};

  function gameTypeLabel(type) {
    return type === 'gomoku' ? '五子棋' : '无限井字棋';
  }

  function formatMatchTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  function formatResult(result) {
    return { win: '胜利', draw: '平局', loss: '失败' }[result] || '结果未知';
  }

  function formatFinishReason(reason, result) {
    if (reason === 'active_exit') return result === 'win' ? '对手主动退出' : '主动退出判负';
    if (reason === 'disconnect') return result === 'win' ? '对手断线' : '断线判负';
    if (reason === 'draw') return '棋盘平局';
    if (reason === 'expired') return '房间超时';
    return '正常结束';
  }

  function mount(options = {}) {
    mountOptions = { ...mountOptions, ...options };
    if (mounted) return mounted;

    const accountButton = document.querySelector('#account-button');
    const accountDialog = document.querySelector('#account-dialog');
    if (!accountButton || !accountDialog) return null;

    const accountAvatar = document.querySelector('.account-avatar');
    const accountKindLabel = document.querySelector('#account-kind-label');
    const accountDisplayName = document.querySelector('#account-display-name');
    const accountCoinBalance = document.querySelector('#account-coin-balance');
    const accountCloseButton = document.querySelector('#account-close-button');
    const accountDialogTitle = document.querySelector('#account-dialog-title');
    const accountAuthView = document.querySelector('#account-auth-view');
    const accountLoginTab = document.querySelector('#account-login-tab');
    const accountRegisterTab = document.querySelector('#account-register-tab');
    const accountLoginForm = document.querySelector('#account-login-form');
    const accountRegisterForm = document.querySelector('#account-register-form');
    const accountProfileForm = document.querySelector('#account-profile-form');
    const accountLogoutButton = document.querySelector('#account-logout-button');
    const accountMessage = document.querySelector('#account-message');
    const profileUsername = document.querySelector('#profile-username');
    const profilePlayerUid = document.querySelector('#profile-player-uid');
    const profileGameName = document.querySelector('#profile-game-name');
    const profileRenameCardCount = document.querySelector('#profile-rename-card-count');
    const walletPanel = document.querySelector('#wallet-panel');
    const walletBalance = document.querySelector('#wallet-balance');
    const redeemCodeForm = document.querySelector('#redeem-code-form');
    const redeemCodeInput = document.querySelector('#redeem-code-input');
    const redeemMessage = document.querySelector('#redeem-message');
    const openAdminButton = document.querySelector('#open-admin-button');
    const matchHistoryPanel = document.querySelector('#match-history-panel');
    const matchHistoryFilter = document.querySelector('#match-history-filter');
    const matchHistoryList = document.querySelector('#match-history-list');
    const matchHistoryMessage = document.querySelector('#match-history-message');
    const loadMoreHistoryButton = document.querySelector('#load-more-history-button');
    const seasonSummary = document.querySelector('#season-summary');

    const accountApi = globalScope.PlayerAccount;
    const economyApi = globalScope.PlayerEconomy;
    const statsApi = globalScope.PlayerStats;
    const shopApi = globalScope.PlayerShop;
    const onlineApi = globalScope.OnlineGame;
    const accountClient = accountApi?.createAccountClient({
      config: globalScope.ONLINE_GAME_CONFIG,
      loadSupabase: onlineApi?.loadSupabaseSdk,
    });
    const economyClient = economyApi?.createEconomyClient({ accountClient });
    const statsClient = statsApi?.createStatsClient({ accountClient });
    const shopClient = shopApi?.createShopClient({ accountClient });
    const listeners = new Set();

    let identity = accountClient?.getIdentity() || {
      kind: 'guest',
      username: null,
      displayName: '匿名玩家',
      needsProfile: false,
    };
    let economySnapshot = economyClient?.getSnapshot() || {
      balance: 0,
      isAdmin: false,
      loaded: false,
    };
    let inventory = { makeupCard: 0, renameCard: 0 };
    let busy = false;
    let mode = 'login';
    let seasons = [];
    let standings = [];
    let history = [];
    let historyCursor = null;
    let historyHasMore = false;
    let historyBusy = false;
    let historyRequestId = 0;

    function snapshot() {
      return {
        identity: { ...identity },
        economySnapshot: { ...economySnapshot },
        inventory: { ...inventory },
      };
    }

    function notify() {
      const value = snapshot();
      mountOptions.onStateChange?.(value);
      listeners.forEach((listener) => listener(value));
    }

    function setMessage(element, message = '', stateName = '') {
      if (!element) return;
      element.textContent = message;
      element.dataset.state = stateName;
    }

    function setMode(nextMode, { clearMessage = true } = {}) {
      mode = nextMode === 'register' ? 'register' : 'login';
      const registering = mode === 'register';
      accountLoginForm.hidden = registering;
      accountRegisterForm.hidden = !registering;
      accountLoginTab.setAttribute('aria-selected', String(!registering));
      accountRegisterTab.setAttribute('aria-selected', String(registering));
      accountDialogTitle.textContent = registering ? '注册账号' : '登录账号';
      if (clearMessage) setMessage(accountMessage);
    }

    function transitionMode(nextMode) {
      const normalized = nextMode === 'register' ? 'register' : 'login';
      if (normalized === mode) return;
      const apply = () => setMode(normalized);
      if (globalScope.HYLAppleUI?.transition) {
        globalScope.HYLAppleUI?.transition(apply, 'account-tab');
      } else {
        apply();
      }
    }

    function setBusy(nextBusy) {
      busy = nextBusy;
      accountDialog.querySelectorAll('button, input, select').forEach((control) => {
        control.disabled = nextBusy;
      });
      accountDialog.setAttribute('aria-busy', String(nextBusy));
    }

    function renderSeasonSummary() {
      if (!seasonSummary) return;
      seasonSummary.textContent = '';
      const season = seasons.find((item) => item.status === 'active') || seasons[0];
      if (!season) {
        const empty = document.createElement('p');
        empty.className = 'history-empty-state';
        empty.textContent = '暂无赛季。';
        seasonSummary.append(empty);
        globalScope.HYLAppleUI?.refresh?.(seasonSummary);
        return;
      }
      const title = document.createElement('p');
      title.className = 'season-summary-title';
      title.textContent = season.status === 'active' ? `${season.name} · 进行中` : season.name;
      seasonSummary.append(title);
      ['tic_tac_toe', 'gomoku'].forEach((type) => {
        const standing = standings.find((item) => item.gameType === type);
        const item = document.createElement('article');
        item.className = 'season-summary-item';
        item.dataset.appleCard = '';
        const name = document.createElement('span');
        name.textContent = gameTypeLabel(type);
        const points = document.createElement('strong');
        points.dataset.appleCounter = '';
        points.textContent = `${standing?.points || 0} 分`;
        const meta = document.createElement('small');
        meta.textContent = standing
          ? `第 ${standing.rank} 名 · ${standing.wins}胜 ${standing.draws}平 ${standing.losses}负`
          : '暂未上榜';
        item.append(name, points, meta);
        seasonSummary.append(item);
      });
      globalScope.HYLAppleUI?.refresh?.(seasonSummary);
    }

    function renderHistory() {
      if (!matchHistoryList) return;
      matchHistoryList.textContent = '';
      if (history.length === 0 && !historyBusy) {
        const empty = document.createElement('p');
        empty.className = 'history-empty-state';
        empty.textContent = '暂无在线战绩。';
        matchHistoryList.append(empty);
      } else {
        const fragment = document.createDocumentFragment();
        history.forEach((match) => {
          const item = document.createElement('article');
          item.className = 'match-history-item';
          item.dataset.result = match.result;
          item.dataset.appleCard = '';
          item.dataset.appleReveal = '';
          item.dataset.appleListItem = '';
          const heading = document.createElement('div');
          heading.className = 'match-history-item-heading';
          const opponent = document.createElement('strong');
          opponent.textContent = `${formatResult(match.result)} · ${match.opponentName}`;
          const time = document.createElement('time');
          time.dateTime = match.finishedAt;
          time.textContent = formatMatchTime(match.finishedAt);
          heading.append(opponent, time);
          const meta = document.createElement('p');
          meta.textContent = `${gameTypeLabel(match.gameType)} · ${formatFinishReason(match.finishReason, match.result)} · ${match.seasonName || '不计分对局'}`;
          const values = document.createElement('div');
          values.className = 'match-history-values';
          const points = document.createElement('span');
          points.textContent = match.pointsAwarded === null ? '不计分' : `积分 +${match.pointsAwarded}`;
          if (match.pointsAwarded !== null) points.dataset.appleCounter = '';
          const wager = document.createElement('span');
          wager.textContent = match.wagerAmount === 0
            ? '无彩头'
            : `彩头 ${match.coinDelta > 0 ? '+' : ''}${match.coinDelta}`;
          if (match.wagerAmount !== 0) wager.dataset.appleCounter = '';
          values.append(points, wager);
          item.append(heading, meta, values);
          fragment.append(item);
        });
        matchHistoryList.append(fragment);
      }
      globalScope.HYLAppleUI?.refresh?.(matchHistoryList);
      if (loadMoreHistoryButton) {
        loadMoreHistoryButton.hidden = !historyHasMore;
        loadMoreHistoryButton.disabled = historyBusy;
      }
      if (matchHistoryFilter) matchHistoryFilter.disabled = historyBusy;
    }

    async function loadHistory({ reset = false } = {}) {
      if (!statsClient || identity.kind !== 'registered' || (historyBusy && !reset)) return;
      const requestId = ++historyRequestId;
      historyBusy = true;
      if (reset) {
        history = [];
        historyCursor = null;
        historyHasMore = false;
      }
      setMessage(matchHistoryMessage, reset ? '正在加载个人战绩' : '正在加载更多战绩');
      renderHistory();
      try {
        if (seasons.length === 0) seasons = await statsClient.listSeasons();
        if (requestId !== historyRequestId) return;
        if (reset) {
          const season = seasons.find((item) => item.status === 'active') || seasons[0];
          standings = season ? await statsClient.getMyStandings(season.id) : [];
          if (requestId !== historyRequestId) return;
          renderSeasonSummary();
        }
        const items = await statsClient.getHistory({
          gameType: matchHistoryFilter?.value || null,
          beforeFinishedAt: historyCursor?.finishedAt || null,
          beforeId: historyCursor?.id || null,
          limit: 20,
        });
        if (requestId !== historyRequestId) return;
        history.push(...items);
        const last = items.at(-1);
        historyCursor = last ? { finishedAt: last.finishedAt, id: last.id } : historyCursor;
        historyHasMore = items.length === 20;
        setMessage(matchHistoryMessage);
      } catch (error) {
        if (requestId === historyRequestId) {
          setMessage(matchHistoryMessage, statsApi.mapStatsError(error), 'error');
        }
      } finally {
        if (requestId === historyRequestId) {
          historyBusy = false;
          renderHistory();
        }
      }
    }

    function render() {
      const registered = identity.kind === 'registered';
      accountAvatar.textContent = registered ? identity.displayName.slice(0, 1) : '游';
      accountKindLabel.textContent = registered ? '个人资料' : '游客身份';
      accountDisplayName.textContent = identity.displayName;
      accountCoinBalance.hidden = !registered;
      accountCoinBalance.textContent = `金币 ${economySnapshot.balance}`;
      accountAuthView.hidden = registered;
      accountProfileForm.hidden = !registered;
      walletPanel.hidden = !registered;
      matchHistoryPanel.hidden = !registered;
      walletBalance.textContent = String(economySnapshot.balance);
      if (profileRenameCardCount) profileRenameCardCount.textContent = String(inventory.renameCard || 0);
      openAdminButton.hidden = !registered || !economySnapshot.isAdmin;
      if (registered) {
        accountDialogTitle.textContent = '个人资料';
        profileUsername.textContent = identity.username;
        if (profilePlayerUid) profilePlayerUid.textContent = identity.uid || '未分配';
        if (document.activeElement !== profileGameName) profileGameName.value = identity.displayName;
      } else {
        history = [];
        historyCursor = null;
        historyHasMore = false;
        standings = [];
        renderHistory();
        renderSeasonSummary();
        setMode(mode, { clearMessage: false });
        const freeWager = document.querySelector('input[name="online-wager"][value="0"]');
        if (freeWager) freeWager.checked = true;
      }
      document.querySelectorAll('input[name="online-wager"]').forEach((input) => {
        input.disabled = !registered && input.value !== '0';
      });
      accountButton.disabled = busy;
      notify();
    }

    async function refreshEconomy({ reportError = false } = {}) {
      if (!economyClient) return economySnapshot;
      try {
        economySnapshot = await economyClient.refresh();
      } catch (error) {
        economySnapshot = { balance: 0, isAdmin: false, loaded: false };
        if (reportError) setMessage(redeemMessage, economyApi.mapEconomyError(error), 'error');
      }
      render();
      return economySnapshot;
    }

    async function refreshInventory({ reportError = false } = {}) {
      if (!shopClient || identity.kind !== 'registered') {
        inventory = { makeupCard: 0, renameCard: 0 };
        render();
        return inventory;
      }
      try {
        inventory = await shopClient.getInventory();
      } catch (error) {
        inventory = { makeupCard: 0, renameCard: 0 };
        if (reportError) setMessage(accountMessage, shopApi.mapShopError(error), 'error');
      }
      render();
      return inventory;
    }

    async function runAction(action, successMessage) {
      if (!accountClient || busy) return;
      setBusy(true);
      setMessage(accountMessage);
      try {
        identity = await action();
        if (identity.renameCardQuantity != null) {
          inventory = { ...inventory, renameCard: Number(identity.renameCardQuantity || 0) };
        }
        await Promise.all([refreshEconomy(), refreshInventory()]);
        setMessage(accountMessage, successMessage, 'success');
      } catch (error) {
        setMessage(accountMessage, accountApi.mapAccountError(error), 'error');
      } finally {
        setBusy(false);
        render();
      }
    }

    accountButton.addEventListener('click', () => {
      render();
      if (identity.kind === 'registered') {
        void refreshEconomy({ reportError: true });
        void refreshInventory({ reportError: true });
        void loadHistory({ reset: true });
      }
      if (!accountClient?.isConfigured()) {
        setMessage(accountMessage, '账号服务尚未配置，游客仍可使用本地模式', 'error');
      }
      accountDialog.showModal();
    });
    accountCloseButton?.addEventListener('click', () => accountDialog.close());
    accountLoginTab?.addEventListener('click', () => transitionMode('login'));
    accountRegisterTab?.addEventListener('click', () => transitionMode('register'));
    accountLoginForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(accountLoginForm);
      void runAction(() => accountClient.login({
        username: data.get('username'),
        password: data.get('password'),
      }), '登录成功');
    });
    accountRegisterForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(accountRegisterForm);
      void runAction(() => accountClient.register({
        username: data.get('username'),
        password: data.get('password'),
        gameName: data.get('gameName'),
      }), '注册成功');
    });
    accountProfileForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(accountProfileForm);
      void runAction(() => accountClient.updateGameName(data.get('gameName')), '游戏名已保存');
    });
    accountLogoutButton?.addEventListener('click', () => {
      void runAction(() => accountClient.logout(), '已退出账号');
    });
    redeemCodeForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!economyClient || busy) return;
      setBusy(true);
      setMessage(redeemMessage);
      try {
        const result = await economyClient.redeemCode(redeemCodeInput.value);
        economySnapshot = { ...economySnapshot, balance: result.balance, loaded: true };
        redeemCodeInput.value = '';
        setMessage(redeemMessage, `已领取 ${result.grantedAmount} 金币`, 'success');
      } catch (error) {
        setMessage(redeemMessage, economyApi.mapEconomyError(error), 'error');
      } finally {
        setBusy(false);
        render();
      }
    });
    redeemCodeInput?.addEventListener('input', () => {
      redeemCodeInput.value = economyApi.formatRedeemCode(redeemCodeInput.value);
      setMessage(redeemMessage);
    });
    matchHistoryFilter?.addEventListener('change', () => void loadHistory({ reset: true }));
    loadMoreHistoryButton?.addEventListener('click', () => void loadHistory());
    openAdminButton?.addEventListener('click', () => {
      accountDialog.close();
      if (mountOptions.onAdminOpen) mountOptions.onAdminOpen();
      else globalScope.location.assign('/admin/');
    });
    accountDialog.addEventListener('click', (event) => {
      if (event.target === accountDialog) accountDialog.close();
    });

    accountClient?.subscribe((nextIdentity) => {
      identity = nextIdentity;
      historyRequestId += 1;
      historyBusy = false;
      history = [];
      historyCursor = null;
      historyHasMore = false;
      standings = [];
      render();
      void refreshEconomy();
      void refreshInventory();
      if (identity.kind === 'registered') void loadHistory({ reset: true });
    });
    economyClient?.subscribe((nextSnapshot) => {
      economySnapshot = nextSnapshot;
      render();
    });

    mounted = {
      accountClient,
      economyClient,
      statsClient,
      shopClient,
      getIdentity: () => ({ ...identity }),
      getEconomySnapshot: () => ({ ...economySnapshot }),
      getInventory: () => ({ ...inventory }),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      open() {
        accountButton.click();
      },
      close() {
        if (accountDialog.open) accountDialog.close();
      },
      refreshEconomy,
      refreshInventory,
    };

    render();
    if (accountClient?.isConfigured()) {
      void accountClient.initialize().then((nextIdentity) => {
        identity = nextIdentity;
        render();
        return Promise.all([refreshEconomy(), refreshInventory()]);
      }).catch((error) => {
        setMessage(accountMessage, accountApi.mapAccountError(error), 'error');
      });
    }
    return mounted;
  }

  const accountPanel = { mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = accountPanel;
  globalScope.HYLAccountPanel = accountPanel;
  if (typeof document !== 'undefined') {
    const autoMount = () => {
      if (!document.querySelector('#game-home')) mount();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoMount, { once: true });
    } else {
      autoMount();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
