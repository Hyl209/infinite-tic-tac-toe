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

  function mount() {
    if (mounted || typeof document === 'undefined') return mounted;

    const tabButtons = Array.from(document.querySelectorAll('[data-player-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-player-panel]'));
    const tabList = document.querySelector('.player-tabs');
    const summaryName = document.querySelector('#player-summary-name');
    const summaryKind = document.querySelector('#player-summary-kind');
    const summaryBalance = document.querySelector('#player-summary-balance');
    const checkinGuest = document.querySelector('#checkin-guest-state');
    const checkinLoginButton = document.querySelector('#checkin-login-button');
    const checkinCalendar = document.querySelector('#checkin-calendar');
    const activityList = document.querySelector('#activity-list');
    const notificationList = document.querySelector('#notification-list');
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
    let actionPending = false;
    let activityItems = [];
    let notificationItems = [];
    let openNotificationId = null;
    const activityClaims = new Set();
    const notificationClaims = new Set();
    const notificationReads = new Set();
    let identityKind = accountPanel?.getIdentity()?.kind || 'guest';

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

    function createNode(tagName, className = '', text = '') {
      const node = document.createElement(tagName);
      node.className = className;
      if (text) node.textContent = text;
      return node;
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
        return true;
      } catch (error) {
        if (destroyed || request !== activityRequest) return false;
        const text = globalScope.PlayerActivities?.mapActivitiesError?.(error)
          || '活动加载失败，请稍后重试';
        renderRetryState(activityList, text, 'activityRetry', refreshActivities);
        setMessage(text, 'error');
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
      activityClaims.add(activityId);
      button.disabled = true;
      button.textContent = '领取中…';
      button.setAttribute('aria-busy', 'true');
      renderActivities();
      try {
        const result = await activitiesClient.claimReward(activityId, createRequestId());
        if (destroyed) return;
        activity.claimed = true;
        activity.claimedAt = result?.claimedAt || activity.claimedAt || null;
        const refreshed = await refreshWallet();
        if (destroyed) return;
        setMessage(refreshed
          ? `活动奖励领取成功，获得 ${formatCoinDelta(result?.rewardAmount ?? activity.rewardAmount)}`
          : '奖励已领取，但钱包刷新失败，请刷新页面', refreshed ? 'success' : 'error');
      } catch (error) {
        if (destroyed) return;
        const text = globalScope.PlayerActivities?.mapActivitiesError?.(error)
          || '活动领取失败，请稍后重试';
        if (text.includes('已经领取') || text.includes('已领取')) activity.claimed = true;
        setMessage(text, activity.claimed ? 'success' : 'error');
      } finally {
        activityClaims.delete(activityId);
        button.disabled = Boolean(activity.claimed);
        button.setAttribute('aria-busy', 'false');
        if (!destroyed) renderActivities();
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
          item.append(heading, createNode('p', 'notification-body', notification.body || '该通知暂无正文。'));

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

          const actions = createNode('div', 'notification-actions');
          const openButton = createNode('button', 'player-secondary-action', opened ? '收起详情' : '查看详情');
          openButton.type = 'button';
          openButton.dataset.notificationOpen = notification.id;
          openButton.setAttribute('aria-expanded', String(opened));
          openButton.addEventListener('click', () => void toggleNotification(notification.id), { signal });
          actions.append(openButton);
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
          item.append(actions);
          inbox.append(item);
        });
      notificationList.className = 'notification-list';
      notificationList.replaceChildren(inbox);
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
      if (notification.isRead || notificationReads.has(notificationId)
          || accountPanel?.getIdentity()?.kind !== 'registered') return;
      notificationReads.add(notificationId);
      try {
        const result = await notificationsClient.markRead(notificationId);
        if (destroyed) return;
        notification.isRead = true;
        notification.readAt = result?.readAt || notification.readAt || null;
        renderNotifications();
      } catch (error) {
        if (destroyed) return;
        const text = globalScope.PlayerNotifications?.mapNotificationsError?.(error)
          || '通知已读状态更新失败，请重试';
        setMessage(text, 'error');
      } finally {
        notificationReads.delete(notificationId);
      }
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
        return true;
      } catch (error) {
        if (destroyed || request !== notificationRequest) return false;
        const text = globalScope.PlayerNotifications?.mapNotificationsError?.(error)
          || '通知加载失败，请稍后重试';
        renderRetryState(notificationList, text, 'notificationRetry', refreshNotifications);
        setMessage(text, 'error');
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
      notificationClaims.add(notificationId);
      button.disabled = true;
      button.textContent = '领取中…';
      button.setAttribute('aria-busy', 'true');
      try {
        const result = await notificationsClient.claimReward(notificationId, createRequestId());
        if (destroyed) return;
        notification.rewardClaimed = true;
        notification.rewardClaimedAt = result?.claimedAt || notification.rewardClaimedAt || null;
        const refreshed = await refreshWallet();
        if (destroyed) return;
        setMessage(refreshed
          ? `通知奖励领取成功，获得 ${formatCoinDelta(result?.rewardAmount ?? notification.rewardAmount)}`
          : '奖励已领取，但钱包刷新失败，请刷新页面', refreshed ? 'success' : 'error');
      } catch (error) {
        if (destroyed) return;
        const text = globalScope.PlayerNotifications?.mapNotificationsError?.(error)
          || '通知奖励领取失败，请稍后重试';
        if (text.includes('奖励已领取') || text === '已领取') notification.rewardClaimed = true;
        setMessage(text, notification.rewardClaimed ? 'success' : 'error');
      } finally {
        notificationClaims.delete(notificationId);
        button.disabled = Boolean(notification.rewardClaimed);
        button.setAttribute('aria-busy', 'false');
        if (!destroyed) renderNotifications();
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
      actionPending = true;
      setActionDisabled(true);
      let completed = false;
      let refreshed = false;
      try {
        const requestId = createRequestId();
        const result = type === 'checkin'
          ? await checkinClient.checkIn(requestId)
          : await checkinClient.makeUp(day.checkinDate, 'coins', requestId);
        completed = true;
        if (destroyed) return;
        dialog?.close?.();
        const refreshResults = await Promise.all([refreshCheckinMonth(), refreshWallet()]);
        refreshed = refreshResults.every(Boolean);
        if (destroyed) return;
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
        if (destroyed) return;
        const text = completed
          ? '操作已成功，但状态刷新失败，请刷新页面'
          : globalScope.PlayerCheckin?.mapCheckinError?.(error)
            || '签到失败，请稍后重试';
        setMessage(text, 'error');
      } finally {
        actionPending = false;
        if (!destroyed) setActionDisabled(completed && !refreshed);
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
    narrowTabs?.addEventListener?.('change', syncTabOrientation);
    const unsubscribe = accountPanel?.subscribe((state) => {
      const nextKind = state?.identity?.kind || accountPanel?.getIdentity()?.kind || 'guest';
      renderSummary(state);
      if (nextKind === identityKind) return;
      identityKind = nextKind;
      calendarRequest += 1;
      activityRequest += 1;
      notificationRequest += 1;
      if (nextKind === 'registered') void refreshCheckinMonth();
      else renderGuestCalendar();
      void refreshActivities();
      void refreshNotifications();
    }) || (() => {});

    syncTabOrientation();
    renderTabs();
    renderSummary();
    if (!accountPanel || !checkinClient || !activitiesClient || !notificationsClient || !economyClient) {
      setMessage('玩家服务暂时不可用，请稍后刷新页面', 'error');
    }
    if (identityKind === 'registered' && checkinClient) void refreshCheckinMonth();
    else renderGuestCalendar();
    void refreshActivities();
    void refreshNotifications();

    instance = {
      accountClient,
      economyClient,
      checkinClient,
      activitiesClient,
      notificationsClient,
      getTab: () => currentTab,
      refreshActivities,
      refreshNotifications,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        calendarRequest += 1;
        activityRequest += 1;
        notificationRequest += 1;
        eventController.abort();
        narrowTabs?.removeEventListener?.('change', syncTabOrientation);
        unsubscribe();
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
