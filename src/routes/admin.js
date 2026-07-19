(function initAdminCenter(globalScope) {
  'use strict';

  const RULE_NUMBER_FIELDS = [
    'mondayReward', 'tuesdayReward', 'wednesdayReward', 'thursdayReward',
    'fridayReward', 'saturdayReward', 'sundayReward', 'makeupCost',
  ];

  function adminAccountKey(identity = {}) {
    return identity.kind === 'registered'
      ? `registered:${String(identity.username || '')}`
      : String(identity.kind || 'guest');
  }

  function resolveAdminAccess({ identity, economySnapshot } = {}) {
    if (identity?.kind !== 'registered') return 'login';
    if (!economySnapshot?.loaded) return 'loading';
    return economySnapshot.isAdmin ? 'admin' : 'forbidden';
  }

  async function initializeAdminAccess({ accountClient, economyClient } = {}) {
    if (!accountClient || !economyClient) throw new Error('ADMIN_SERVICES_UNAVAILABLE');
    const initializedIdentity = await accountClient.initialize();
    const economySnapshot = await economyClient.refresh();
    const identity = accountClient.getIdentity?.() || initializedIdentity;
    return {
      identity,
      economySnapshot,
      access: resolveAdminAccess({ identity, economySnapshot }),
    };
  }

  function localDateTimeToIso(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('时间无效');
    return date.toISOString();
  }

  function localInputValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatLocalDateTime(value) {
    if (!value) return '未设置';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间无效';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  function activityScheduledMessage(publishAt) {
    return `已排期，将于 ${formatLocalDateTime(publishAt)} 自动发布`;
  }

  function canEditAdminActivity(activity) {
    return Boolean(activity?.active);
  }

  function notificationActivitySource(notification = {}) {
    const activityId = String(notification.activityId || '').trim();
    return activityId ? `关联活动：${activityId}` : '独立通知';
  }

  function validateAdminPublicUrl(value, { allowRelative = false } = {}) {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    if (/\s|\\|[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new Error('公开地址不能包含空白或控制字符');
    }
    if (allowRelative && normalized.startsWith('/') && !normalized.startsWith('//')) {
      return normalized;
    }
    try {
      const url = new URL(normalized);
      if (url.protocol === 'https:' && url.host) return normalized;
    } catch {
      // Use the stable field-specific message below.
    }
    throw new Error(allowRelative
      ? '操作地址仅支持 HTTPS 外链或 / 开头的站内路径'
      : '封面地址仅支持 HTTPS 外链');
  }

  function validateAdminActivityLinks(input = {}) {
    const coverUrl = validateAdminPublicUrl(input.coverUrl);
    const actionLabel = String(input.actionLabel || '').trim() || null;
    const actionUrl = validateAdminPublicUrl(input.actionUrl, { allowRelative: true });
    if (Boolean(actionLabel) !== Boolean(actionUrl)) {
      throw new Error('操作文字和操作地址必须同时填写');
    }
    if (actionLabel && actionLabel.length > 30) throw new Error('操作文字最多 30 个字符');
    return { coverUrl, actionLabel, actionUrl };
  }

  function validateAdminNotificationTitle(value) {
    const title = String(value || '').trim();
    if (!title || title.length > 80) throw new Error('通知标题须为 1 至 80 个字符');
    return title;
  }

  function hongKongToday(now = Date.now()) {
    return new Date(new Date(now).getTime() + (8 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  }

  function validateCheckinRule(rule = {}, today = hongKongToday()) {
    const effectiveFrom = String(rule.effectiveFrom || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || effectiveFrom < today) {
      throw new Error('生效日期不得早于香港今天');
    }
    const normalized = { effectiveFrom };
    RULE_NUMBER_FIELDS.forEach((field) => {
      const value = Number(rule[field]);
      if (!Number.isInteger(value)) throw new Error('签到奖励和补签费用必须为整数');
      if (value < 0 || value > 1_000_000) throw new Error('签到奖励和补签费用须为 0 至 1000000');
      normalized[field] = value;
    });
    return normalized;
  }

  function formatAdminCodeExpiry(value) {
    return value ? `${formatLocalDateTime(value)} 到期` : '永久有效';
  }

  function validateShopProductInput(input = {}) {
    const sku = String(input.sku || '');
    if (!['makeup_card', 'rename_card'].includes(sku)) throw new Error('商品不存在');
    const price = Number(input.price);
    if (!Number.isInteger(price)) throw new Error('价格必须为整数');
    if (price < 0 || price > 1_000_000) throw new Error('价格须为 0 至 1000000');
    const active = Boolean(input.active);
    if (active && price < 1) throw new Error('上架商品价格至少为 1');
    const rawLimit = String(input.purchaseLimit ?? '').trim();
    let purchaseLimit = null;
    if (rawLimit) {
      purchaseLimit = Number(rawLimit);
      if (!Number.isInteger(purchaseLimit) || purchaseLimit < 1 || purchaseLimit > 100_000) {
        throw new Error('限购须为 1 至 100000');
      }
    }
    return { sku, price, active, purchaseLimit };
  }

  const exported = {
    activityScheduledMessage,
    canEditAdminActivity,
    formatAdminCodeExpiry,
    hongKongToday,
    initializeAdminAccess,
    localDateTimeToIso,
    notificationActivitySource,
    resolveAdminAccess,
    validateAdminActivityLinks,
    validateAdminNotificationTitle,
    validateAdminPublicUrl,
    validateCheckinRule,
    validateShopProductInput,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;

  function mountAdminCenter() {
    const workspace = document.querySelector('#admin-workspace');
    const accessState = document.querySelector('#admin-access-state');
    const loginButton = document.querySelector('#admin-login-button');
    const retryButton = document.querySelector('#admin-retry-button');
    if (!workspace || !accessState) return null;

    const activityForm = document.querySelector('#admin-activity-form');
    const activityCancel = document.querySelector('#admin-activity-cancel');
    const activityList = document.querySelector('#admin-activity-list');
    const activityMessage = document.querySelector('#admin-activity-message');
    const checkinForm = document.querySelector('#admin-checkin-form');
    const checkinList = document.querySelector('#admin-checkin-list');
    const checkinMessage = document.querySelector('#admin-checkin-message');
    const notificationForm = document.querySelector('#admin-notification-form');
    const notificationList = document.querySelector('#admin-notification-list');
    const notificationMessage = document.querySelector('#admin-notification-message');
    const seasonForm = document.querySelector('#admin-season-form');
    const currentSeasonElement = document.querySelector('#admin-current-season');
    const endSeasonButton = document.querySelector('#end-current-season-button');
    const seasonList = document.querySelector('#admin-season-list');
    const seasonMessage = document.querySelector('#admin-season-message');
    const redeemForm = document.querySelector('#admin-redeem-form');
    const redeemList = document.querySelector('#admin-redeem-list');
    const redeemMessage = document.querySelector('#admin-redeem-message');
    const generatedCode = document.querySelector('#admin-generated-code');
    const generatedCodeValue = document.querySelector('#admin-generated-code-value');
    const copyCodeButton = document.querySelector('#copy-generated-code-button');
    const systemStatus = document.querySelector('#admin-system-status');
    const shopForms = Array.from(document.querySelectorAll('[data-admin-shop-form]'));
    const shopMessage = document.querySelector('#admin-shop-message');

    const accountPanel = globalScope.HYLAccountPanel?.mount();
    const accountClient = accountPanel?.accountClient;
    const economyClient = accountPanel?.economyClient;
    const statsClient = accountPanel?.statsClient;
    let activitiesClient = null;
    let checkinClient = null;
    let notificationsClient = null;
    let shopClient = null;
    let access = 'loading';
    let accountKey = adminAccountKey(accountPanel?.getIdentity?.());
    let generation = 0;
    let activatingGeneration = null;
    let activities = [];
    let checkinRules = [];
    let notifications = [];
    let seasons = [];
    let redeemCodes = [];
    let shopProducts = [];
    let economySnapshot = accountPanel?.getEconomySnapshot?.() || {
      loaded: false,
      isAdmin: false,
      balance: 0,
    };

    function setMessage(element, message = '', state = '') {
      if (!element) return;
      element.textContent = message;
      element.dataset.state = state;
    }

    function setFormBusy(form, busy) {
      if (!form) return;
      form.setAttribute('aria-busy', String(busy));
      form.querySelectorAll('button, input, textarea, select').forEach((control) => {
        control.disabled = busy;
      });
    }

    function emptyRecord(message) {
      const element = document.createElement('p');
      element.className = 'admin-empty';
      element.textContent = message;
      return element;
    }

    function recordRow(title, lines = [], actions = []) {
      const row = document.createElement('article');
      row.className = 'admin-record-row';
      const main = document.createElement('div');
      main.className = 'admin-record-main';
      const heading = document.createElement('strong');
      heading.textContent = title;
      main.append(heading);
      lines.filter(Boolean).forEach((line) => {
        const meta = document.createElement('span');
        meta.textContent = line;
        main.append(meta);
      });
      row.append(main);
      if (actions.length > 0) {
        const controls = document.createElement('div');
        controls.className = 'admin-record-actions';
        actions.forEach((action) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = action.danger ? 'admin-danger-button' : 'admin-secondary-button';
          button.textContent = action.label;
          button.dataset[action.dataName] = action.dataValue;
          button.disabled = Boolean(action.disabled);
          controls.append(button);
        });
        row.append(controls);
      }
      return row;
    }

    function setAccess(nextAccess, message, state = '') {
      access = nextAccess;
      workspace.hidden = nextAccess !== 'admin';
      loginButton.hidden = nextAccess !== 'login';
      retryButton.hidden = !['error', 'forbidden'].includes(nextAccess);
      setMessage(accessState, message, state);
    }

    function mapError(api, error, fallback) {
      return api?.(error) || fallback;
    }

    function activityStatus(activity) {
      const now = Date.now();
      if (!activity.active) return '已下架';
      if (activity.endsAt && Date.parse(activity.endsAt) <= now) return '已结束';
      if (activity.publishAt && Date.parse(activity.publishAt) > now) return '待发布';
      if (activity.startsAt && Date.parse(activity.startsAt) > now) return '已发布，待开始';
      return '进行中';
    }

    function renderActivities() {
      activityList.replaceChildren();
      if (activities.length === 0) {
        activityList.append(emptyRecord('暂无活动排期。'));
        return;
      }
      activities.forEach((activity) => {
        activityList.append(recordRow(activity.title, [
          `${activityStatus(activity)} · 发布 ${formatLocalDateTime(activity.publishAt)}`,
          `${formatLocalDateTime(activity.startsAt)} 至 ${formatLocalDateTime(activity.endsAt)} · 奖励 ${activity.rewardAmount} 金币 · ${activity.claimCount || 0} 人领取`,
        ], [
          { label: '编辑', dataName: 'editActivity', dataValue: activity.id, disabled: !activity.active },
          { label: '提前下架', dataName: 'unpublishActivity', dataValue: activity.id, danger: true, disabled: !activity.active },
        ]));
      });
    }

    function resetActivityForm() {
      activityForm.reset();
      activityForm.elements.id.value = '';
      activityCancel.hidden = true;
    }

    function editActivity(id) {
      const activity = activities.find((item) => String(item.id) === String(id));
      if (!activity || !activity.active) return;
      const fields = {
        id: activity.id,
        title: activity.title,
        body: activity.body,
        coverUrl: activity.coverUrl || '',
        actionLabel: activity.actionLabel || '',
        actionUrl: activity.actionUrl || '',
        publishAt: localInputValue(activity.publishAt),
        startsAt: localInputValue(activity.startsAt),
        endsAt: localInputValue(activity.endsAt),
        rewardAmount: activity.rewardAmount,
      };
      Object.entries(fields).forEach(([name, value]) => { activityForm.elements[name].value = value; });
      activityCancel.hidden = false;
      activityForm.elements.title.focus();
    }

    function renderCheckinRules() {
      checkinList.replaceChildren();
      if (checkinRules.length === 0) {
        checkinList.append(emptyRecord('暂无签到规则版本。'));
        return;
      }
      checkinRules.forEach((rule) => {
        checkinList.append(recordRow(`生效日期 ${rule.effectiveFrom}`, [
          `周一至周日：${[
            rule.mondayReward, rule.tuesdayReward, rule.wednesdayReward,
            rule.thursdayReward, rule.fridayReward, rule.saturdayReward,
            rule.sundayReward,
          ].join(' / ')} 金币`,
          `补签费用 ${rule.makeupCost} 金币 · 创建于 ${formatLocalDateTime(rule.createdAt)}`,
        ]));
      });
    }

    function notificationStatus(notification) {
      const now = Date.now();
      if (!notification.active) return '已停用';
      if (notification.expiresAt && Date.parse(notification.expiresAt) <= now) return '已失效';
      if (Date.parse(notification.visibleAt) > now) return '待可见';
      return '可见';
    }

    function renderNotifications() {
      notificationList.replaceChildren();
      if (notifications.length === 0) {
        notificationList.append(emptyRecord('暂无站点通知。'));
        return;
      }
      notifications.forEach((notification) => {
        notificationList.append(recordRow(notification.title, [
          `${notificationStatus(notification)} · ${formatLocalDateTime(notification.visibleAt)} 可见${notification.expiresAt ? ` · ${formatLocalDateTime(notification.expiresAt)} 失效` : ''}`,
          `奖励 ${notification.rewardAmount || 0} 金币 · ${notification.claimCount || 0} 人领取 · ${notification.readCount || 0} 人已读`,
          notificationActivitySource(notification),
        ], [{
          label: '停用',
          dataName: 'disableNotification',
          dataValue: notification.id,
          danger: true,
          disabled: !notification.active,
        }]));
      });
    }

    function renderSeasons() {
      const current = seasons.find((season) => season.status === 'active') || null;
      currentSeasonElement.replaceChildren();
      const title = document.createElement('strong');
      title.textContent = current ? current.name : '当前没有进行中的赛季';
      const meta = document.createElement('span');
      meta.textContent = current
        ? `开始于 ${formatLocalDateTime(current.startedAt)}；已开局对局仍会计入本赛季。`
        : '空窗期对局保留历史，但不产生赛季积分。';
      currentSeasonElement.append(title, meta);
      seasonForm.hidden = Boolean(current);
      endSeasonButton.hidden = !current;
      seasonList.replaceChildren();
      const history = seasons.filter((season) => season.status === 'ended');
      if (history.length === 0) {
        seasonList.append(emptyRecord('暂无历史赛季。'));
        return;
      }
      history.forEach((season) => seasonList.append(recordRow(season.name, [
        `${formatLocalDateTime(season.startedAt)} 至 ${formatLocalDateTime(season.endedAt)}`,
      ])));
    }

    function redeemCodeStatus(code) {
      if (!code.active) return '已停用';
      if (code.expiresAt && Date.parse(code.expiresAt) <= Date.now()) return '已过期';
      if (code.claimCount >= code.maxClaims) return '已领完';
      return '可领取';
    }

    function renderRedeemCodes() {
      redeemList.replaceChildren();
      if (redeemCodes.length === 0) {
        redeemList.append(emptyRecord('暂无兑换码。'));
        return;
      }
      redeemCodes.forEach((code) => redeemList.append(recordRow(code.codeHint, [
        `${code.amount} 金币 · ${code.claimCount}/${code.maxClaims} 人 · ${formatAdminCodeExpiry(code.expiresAt)} · ${redeemCodeStatus(code)}`,
      ], [{
        label: '停用',
        dataName: 'disableCode',
        dataValue: code.id,
        danger: true,
        disabled: !code.active,
      }])));
    }

    function renderSystemStatus() {
      systemStatus.replaceChildren();
      const rows = [
        ['账号身份', accountPanel?.getIdentity?.().displayName || '未知'],
        ['管理权限', economySnapshot.isAdmin ? '已通过' : '未通过'],
        ['经济快照', economySnapshot.loaded ? `已连接 · 余额 ${economySnapshot.balance}` : '未加载'],
        ['活动配置', `${activities.length} 条`],
        ['签到规则', `${checkinRules.length} 个版本`],
        ['站点通知', `${notifications.length} 条`],
        ['竞技赛季', `${seasons.length} 个`],
        ['兑换码', `${redeemCodes.length} 个`],
      ];
      rows.forEach(([term, value]) => {
        const row = document.createElement('div');
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = term;
        dd.textContent = value;
        row.append(dt, dd);
        systemStatus.append(row);
      });
    }

    function renderShopProducts() {
      shopForms.forEach((form) => {
        const sku = form.dataset.adminShopForm;
        const product = shopProducts.find((item) => item.sku === sku);
        if (!product) return;
        form.elements.price.value = product.price;
        form.elements.isActive.checked = product.active;
        form.elements.perUserLimit.value = product.purchaseLimit ?? '';
        const updated = document.querySelector(`#admin-shop-updated-${sku}`);
        if (updated) updated.textContent = product.updatedAt
          ? `最近更新 ${formatLocalDateTime(product.updatedAt)}`
          : '尚未更新';
      });
    }

    function renderAll() {
      renderActivities();
      renderCheckinRules();
      renderNotifications();
      renderSeasons();
      renderRedeemCodes();
      renderShopProducts();
      renderSystemStatus();
    }

    function clearAdminData() {
      activities = [];
      checkinRules = [];
      notifications = [];
      seasons = [];
      redeemCodes = [];
      shopProducts = [];
      generatedCode.hidden = true;
      generatedCodeValue.textContent = '';
      resetActivityForm();
      [activityMessage, checkinMessage, notificationMessage, seasonMessage, redeemMessage, shopMessage]
        .forEach((element) => setMessage(element));
      [activityForm, checkinForm, notificationForm, seasonForm, redeemForm, ...shopForms]
        .forEach((form) => setFormBusy(form, false));
      workspace.setAttribute('aria-busy', 'false');
      renderAll();
    }

    async function loadAllConfigData(token = generation) {
      if (token !== generation) return;
      workspace.setAttribute('aria-busy', 'true');
      setMessage(accessState, '管理权限已通过，正在并行加载站点配置…');
      try {
        const loaded = await Promise.all([
          activitiesClient.adminList(),
          checkinClient.adminListRules(),
          notificationsClient.adminList(),
          statsClient.listSeasons(),
          economyClient.listRedeemCodes(),
          shopClient.adminListProducts(),
        ]);
        if (token !== generation) return;
        [activities, checkinRules, notifications, seasons, redeemCodes, shopProducts] = loaded;
        renderAll();
        retryButton.hidden = true;
        setMessage(accessState, '管理权限已通过；服务端 RPC 继续执行最终权限校验。', 'success');
      } catch (error) {
        if (token !== generation) return;
        retryButton.hidden = false;
        setMessage(accessState, `配置加载失败：${String(error?.message || error)}。可重试，服务端权限边界未改变。`, 'error');
      } finally {
        if (token === generation) workspace.setAttribute('aria-busy', 'false');
      }
    }

    async function activateAdmin(token = generation) {
      if (token !== generation || access !== 'admin' || activatingGeneration === token) return;
      activatingGeneration = token;
      try {
        activitiesClient ||= globalScope.PlayerActivities.createActivitiesClient({ accountClient });
        checkinClient ||= globalScope.PlayerCheckin.createCheckinClient({ accountClient });
        notificationsClient ||= globalScope.PlayerNotifications.createNotificationsClient({ accountClient });
        shopClient ||= globalScope.PlayerShop.createShopClient({ accountClient });
        await loadAllConfigData(token);
      } finally {
        if (activatingGeneration === token) activatingGeneration = null;
      }
    }

    async function verifyAccess(token = generation) {
      if (token !== generation) return;
      setAccess('loading', '正在等待账号初始化与经济权限快照…');
      retryButton.hidden = true;
      try {
        const result = await initializeAdminAccess({ accountClient, economyClient });
        if (token !== generation || adminAccountKey(result.identity) !== accountKey) return;
        economySnapshot = result.economySnapshot;
        if (result.access === 'login') {
          setAccess('login', '请先登录正式账号，再验证管理权限。');
          return;
        }
        if (result.access === 'forbidden') {
          setAccess('forbidden', '当前账号无管理权限。', 'error');
          return;
        }
        if (result.access !== 'admin') throw new Error('权限快照尚未就绪');
        setAccess('admin', '管理权限已通过，正在加载配置…', 'success');
        await activateAdmin(token);
      } catch (error) {
        if (token !== generation) return;
        setAccess('error', `无法验证管理权限：${String(error?.message || error)}`, 'error');
      }
    }

    loginButton.addEventListener('click', () => accountPanel?.open());
    retryButton.addEventListener('click', () => void verifyAccess());
    activityCancel.addEventListener('click', resetActivityForm);

    shopForms.forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (access !== 'admin' || !shopClient) return;
        const sku = form.dataset.adminShopForm;
        let input;
        try {
          input = validateShopProductInput({
            sku,
            price: form.elements.price.value,
            active: form.elements.isActive.checked,
            purchaseLimit: form.elements.perUserLimit.value,
          });
        } catch (error) {
          setMessage(shopMessage, error.message, 'error');
          return;
        }

        const current = shopProducts.find((product) => product.sku === sku);
        if (!current?.active && input.active) {
          const limit = input.purchaseLimit == null ? '不限购' : `限购 ${input.purchaseLimit}`;
          const confirmed = globalScope.confirm(
            `确认上架${current?.name || sku}？价格 ${input.price} 金币，${limit}。`,
          );
          if (!confirmed) return;
        }

        setFormBusy(form, true);
        setMessage(shopMessage, `正在保存${current?.name || '商品'}…`);
        try {
          await shopClient.adminUpdateProduct(input);
          shopProducts = await shopClient.adminListProducts();
          renderShopProducts();
          setMessage(shopMessage, `${current?.name || '商品'}已保存。`, 'success');
        } catch (error) {
          setMessage(
            shopMessage,
            mapError(globalScope.PlayerShop?.mapShopError, error, '商品保存失败'),
            'error',
          );
        } finally {
          setFormBusy(form, false);
        }
      });
    });

    activityForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (access !== 'admin' || !activitiesClient) return;
      const data = new FormData(activityForm);
      let payload;
      try {
        const links = validateAdminActivityLinks({
          coverUrl: data.get('coverUrl'),
          actionLabel: data.get('actionLabel'),
          actionUrl: data.get('actionUrl'),
        });
        payload = {
          id: data.get('id') || null,
          title: data.get('title'),
          body: data.get('body'),
          ...links,
          publishAt: localDateTimeToIso(data.get('publishAt')),
          startsAt: localDateTimeToIso(data.get('startsAt')),
          endsAt: localDateTimeToIso(data.get('endsAt')),
          rewardAmount: Number(data.get('rewardAmount')),
        };
      } catch (error) {
        setMessage(activityMessage, error.message, 'error');
        return;
      }
      if (payload.id) {
        const existing = activities.find((activity) => String(activity.id) === String(payload.id));
        if (!canEditAdminActivity(existing)) {
          setMessage(activityMessage, '已下架活动不可编辑，请新建活动排期。', 'error');
          return;
        }
      }
      setFormBusy(activityForm, true);
      setMessage(activityMessage, '正在保存活动排期…');
      try {
        const saved = await activitiesClient.adminSave(payload);
        activities = await activitiesClient.adminList();
        renderActivities();
        resetActivityForm();
        setMessage(activityMessage, activityScheduledMessage(saved.publishAt), 'success');
      } catch (error) {
        setMessage(activityMessage, mapError(globalScope.PlayerActivities?.mapActivitiesError, error, '活动保存失败'), 'error');
      } finally {
        setFormBusy(activityForm, false);
      }
    });

    activityList.addEventListener('click', async (event) => {
      const editButton = event.target.closest('[data-edit-activity]');
      if (editButton) {
        editActivity(editButton.dataset.editActivity);
        return;
      }
      const unpublishButton = event.target.closest('[data-unpublish-activity]');
      if (!unpublishButton || !activitiesClient) return;
      const activity = activities.find((item) => String(item.id) === unpublishButton.dataset.unpublishActivity);
      if (!activity || !globalScope.confirm(`确认提前下架“${activity.title}”？`)) return;
      unpublishButton.disabled = true;
      try {
        await activitiesClient.adminUnpublish(activity.id);
        activities = await activitiesClient.adminList();
        renderActivities();
        setMessage(activityMessage, '活动已提前下架。', 'success');
      } catch (error) {
        setMessage(activityMessage, mapError(globalScope.PlayerActivities?.mapActivitiesError, error, '活动下架失败'), 'error');
        unpublishButton.disabled = false;
      }
    });

    checkinForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (access !== 'admin' || !checkinClient) return;
      const data = Object.fromEntries(new FormData(checkinForm));
      let rule;
      try {
        rule = validateCheckinRule(data);
      } catch (error) {
        setMessage(checkinMessage, error.message, 'error');
        return;
      }
      setFormBusy(checkinForm, true);
      setMessage(checkinMessage, '正在创建新的签到规则版本…');
      try {
        await checkinClient.adminCreateRule(rule);
        checkinRules = await checkinClient.adminListRules();
        renderCheckinRules();
        checkinForm.reset();
        prepareFormDefaults();
        setMessage(checkinMessage, `规则版本已创建，将于 ${rule.effectiveFrom}（香港）生效。`, 'success');
      } catch (error) {
        setMessage(checkinMessage, mapError(globalScope.PlayerCheckin?.mapCheckinError, error, '签到规则保存失败'), 'error');
      } finally {
        setFormBusy(checkinForm, false);
      }
    });

    notificationForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (access !== 'admin' || !notificationsClient) return;
      const data = new FormData(notificationForm);
      let title;
      try {
        title = validateAdminNotificationTitle(data.get('title'));
      } catch (error) {
        setMessage(notificationMessage, error.message, 'error');
        return;
      }
      setFormBusy(notificationForm, true);
      setMessage(notificationMessage, '正在发布通知…');
      try {
        await notificationsClient.adminPublish({
          title,
          body: data.get('body'),
          rewardAmount: Number(data.get('rewardAmount')),
          visibleAt: localDateTimeToIso(data.get('visibleAt')),
          expiresAt: localDateTimeToIso(data.get('expiresAt')),
        });
        notifications = await notificationsClient.adminList();
        renderNotifications();
        notificationForm.reset();
        prepareFormDefaults();
        setMessage(notificationMessage, '通知已发布。', 'success');
      } catch (error) {
        setMessage(notificationMessage, mapError(globalScope.PlayerNotifications?.mapNotificationsError, error, '通知发布失败'), 'error');
      } finally {
        setFormBusy(notificationForm, false);
      }
    });

    notificationList.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-disable-notification]');
      if (!button || !notificationsClient) return;
      button.disabled = true;
      try {
        await notificationsClient.adminDisable(button.dataset.disableNotification);
        notifications = await notificationsClient.adminList();
        renderNotifications();
        setMessage(notificationMessage, '通知已停用。', 'success');
      } catch (error) {
        setMessage(notificationMessage, mapError(globalScope.PlayerNotifications?.mapNotificationsError, error, '通知停用失败'), 'error');
        button.disabled = false;
      }
    });

    seasonForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (access !== 'admin' || !statsClient) return;
      const data = new FormData(seasonForm);
      setFormBusy(seasonForm, true);
      setMessage(seasonMessage, '正在开启赛季…');
      try {
        await statsClient.startSeason(data.get('seasonName'));
        seasons = await statsClient.listSeasons();
        seasonForm.reset();
        renderSeasons();
        setMessage(seasonMessage, '新赛季已开启。', 'success');
      } catch (error) {
        setMessage(seasonMessage, mapError(globalScope.PlayerStats?.mapStatsError, error, '赛季开启失败'), 'error');
      } finally {
        setFormBusy(seasonForm, false);
      }
    });

    endSeasonButton.addEventListener('click', async () => {
      const current = seasons.find((season) => season.status === 'active');
      if (!current || !statsClient || !globalScope.confirm(`确认结束“${current.name}”？`)) return;
      endSeasonButton.disabled = true;
      setMessage(seasonMessage, '正在结束赛季…');
      try {
        await statsClient.endSeason(current.id);
        seasons = await statsClient.listSeasons();
        renderSeasons();
        setMessage(seasonMessage, '赛季已结束。', 'success');
      } catch (error) {
        setMessage(seasonMessage, mapError(globalScope.PlayerStats?.mapStatsError, error, '赛季结束失败'), 'error');
      } finally {
        endSeasonButton.disabled = false;
      }
    });

    redeemForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (access !== 'admin' || !economyClient) return;
      const data = new FormData(redeemForm);
      setFormBusy(redeemForm, true);
      setMessage(redeemMessage, '正在生成兑换码…');
      try {
        const code = await economyClient.createRedeemCode({
          amount: Number(data.get('amount')),
          maxClaims: Number(data.get('maxClaims')),
          expiresAt: localDateTimeToIso(data.get('expiresAt')),
        });
        generatedCodeValue.textContent = code.code;
        generatedCode.hidden = false;
        redeemCodes = await economyClient.listRedeemCodes();
        renderRedeemCodes();
        setMessage(redeemMessage, '兑换码已生成，请立即复制保存。', 'success');
      } catch (error) {
        setMessage(redeemMessage, mapError(globalScope.PlayerEconomy?.mapEconomyError, error, '兑换码生成失败'), 'error');
      } finally {
        setFormBusy(redeemForm, false);
      }
    });

    redeemList.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-disable-code]');
      if (!button || !economyClient) return;
      button.disabled = true;
      try {
        await economyClient.disableRedeemCode(button.dataset.disableCode);
        redeemCodes = await economyClient.listRedeemCodes();
        renderRedeemCodes();
        setMessage(redeemMessage, '兑换码已停用。', 'success');
      } catch (error) {
        setMessage(redeemMessage, mapError(globalScope.PlayerEconomy?.mapEconomyError, error, '兑换码停用失败'), 'error');
        button.disabled = false;
      }
    });

    copyCodeButton.addEventListener('click', async () => {
      const code = generatedCodeValue.textContent;
      if (!code) return;
      try {
        await globalScope.navigator.clipboard.writeText(code);
        setMessage(redeemMessage, '兑换码已复制。', 'success');
      } catch {
        setMessage(redeemMessage, `请手动复制：${code}`, 'error');
      }
    });

    function prepareFormDefaults() {
      const today = hongKongToday();
      const effectiveFrom = checkinForm.elements.effectiveFrom;
      effectiveFrom.min = today;
      if (!effectiveFrom.value || effectiveFrom.value < today) effectiveFrom.value = today;
      const visibleAt = notificationForm.elements.visibleAt;
      if (!visibleAt.value) visibleAt.value = localInputValue(new Date().toISOString());
    }

    accountPanel?.subscribe(({ identity, economySnapshot: nextSnapshot }) => {
      economySnapshot = nextSnapshot;
      const nextAccountKey = adminAccountKey(identity);
      if (nextAccountKey !== accountKey) {
        accountKey = nextAccountKey;
        generation += 1;
        activatingGeneration = null;
        setAccess('loading', '账号已切换，正在重新验证管理权限…');
        clearAdminData();
        void verifyAccess(generation);
        return;
      }
      const nextAccess = resolveAdminAccess({ identity, economySnapshot: nextSnapshot });
      if (nextAccess === access) return;
      if (nextAccess === 'admin') {
        setAccess('admin', '管理权限已通过，正在加载配置…', 'success');
        void activateAdmin(generation);
      } else if (nextAccess === 'forbidden') {
        setAccess('forbidden', '当前账号无管理权限。', 'error');
      } else if (nextAccess === 'login') {
        setAccess('login', '请先登录正式账号，再验证管理权限。');
      }
    });

    prepareFormDefaults();
    void verifyAccess(generation);
    return { verifyAccess };
  }

  globalScope.HYLAdminCenter = { ...exported, mount: mountAdminCenter };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountAdminCenter, { once: true });
    } else {
      mountAdminCenter();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
