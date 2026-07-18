(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PlayerNotifications = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ERROR_MESSAGES = {
    ACCOUNT_CLIENT_REQUIRED: '缺少账号客户端',
    REGISTERED_ACCOUNT_REQUIRED: '请先登录正式账号',
    ADMIN_REQUIRED: '需要管理员权限',
    INVALID_NOTIFICATION_CURSOR: '通知游标无效',
    INVALID_NOTIFICATION_LIMIT: '通知数量参数无效',
    NOTIFICATION_NOT_FOUND: '通知不存在',
    NOTIFICATION_DISABLED: '通知已停用',
    NOTIFICATION_NOT_VISIBLE: '通知尚未生效',
    NOTIFICATION_EXPIRED: '通知已过期',
    NOTIFICATION_NO_REWARD: '该通知没有奖励',
    NOTIFICATION_ALREADY_CLAIMED: '奖励已领取',
    REQUEST_ID_REQUIRED: '缺少请求 ID',
    INVALID_NOTIFICATION_RESPONSE: '通知服务返回了无效数据，请稍后重试',
  };

  function errorCode(error) {
    var text = [error && error.code, error && error.message, error && error.details, error && error.hint]
      .filter(Boolean).join(' ');
    return Object.keys(ERROR_MESSAGES).find(function (code) {
      return text.indexOf(code) !== -1;
    });
  }

  function mapNotificationsError(error) {
    var code = errorCode(error);
    return ERROR_MESSAGES[code] || '通知服务暂时不可用，请稍后重试';
  }

  function fail(code) {
    throw new Error(code);
  }

  function nullableNumber(value) {
    return value == null ? null : Number(value);
  }

  function publicNotification(row) {
    row = row || {};
    return {
      id: row.id,
      activityId: row.activity_id ?? null,
      title: row.title,
      body: row.body ?? null,
      rewardAmount: nullableNumber(row.reward_amount),
      visibleAt: row.visible_at,
      expiresAt: row.expires_at ?? null,
      actionUrl: row.action_url ?? null,
      isRead: Boolean(row.is_read),
      rewardClaimed: Boolean(row.reward_claimed),
      readAt: row.read_at ?? null,
      rewardClaimedAt: row.reward_claimed_at ?? null,
    };
  }

  function adminNotification(row) {
    var model = publicNotification(row);
    model.active = Boolean(row && row.is_active);
    model.createdBy = row && row.created_by != null ? row.created_by : null;
    model.createdAt = row && row.created_at != null ? row.created_at : null;
    model.updatedAt = row && row.updated_at != null ? row.updated_at : null;
    model.readCount = Number(row && row.read_count != null ? row.read_count : 0);
    model.claimCount = Number(row && row.claim_count != null ? row.claim_count : 0);
    return model;
  }

  function firstRpcRow(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function requiredRpcRow(data) {
    var row = firstRpcRow(data);
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail('INVALID_NOTIFICATION_RESPONSE');
    return row;
  }

  function requiredNumber(value) {
    var type = typeof value;
    if ((type !== 'number' && type !== 'bigint' && type !== 'string') ||
        (type === 'string' && value.trim() === '')) fail('INVALID_NOTIFICATION_RESPONSE');
    var number = Number(value);
    if (!Number.isFinite(number)) fail('INVALID_NOTIFICATION_RESPONSE');
    return number;
  }

  function normalizeLimit(value) {
    if (value == null) return 20;
    var number = Number(value);
    if (!Number.isFinite(number)) fail('INVALID_NOTIFICATION_LIMIT');
    return Math.max(1, Math.min(50, Math.trunc(number)));
  }

  function cursorParams(cursor) {
    if (cursor == null) return { visibleAt: null, id: null };
    var hasVisibleAt = cursor.visibleAt != null;
    var hasId = cursor.id != null;
    if (hasVisibleAt !== hasId) fail('INVALID_NOTIFICATION_CURSOR');
    return {
      visibleAt: hasVisibleAt ? cursor.visibleAt : null,
      id: hasId ? cursor.id : null,
    };
  }

  function createNotificationsClient({ accountClient } = {}) {
    if (!accountClient) fail('ACCOUNT_CLIENT_REQUIRED');
    if (typeof accountClient.getSupabaseClient !== 'function' ||
        typeof accountClient.getIdentity !== 'function') fail('ACCOUNT_CLIENT_REQUIRED');

    var listeners = new Set();
    var channel = null;
    var channelSupabase = null;
    var channelVersion = 0;
    var channelQueue = Promise.resolve();
    var latestChannelPromise = null;
    var unsubscribeIdentity = null;

    async function getSupabaseClient() {
      var supabase = await accountClient.getSupabaseClient();
      if (!supabase) fail('ACCOUNT_CLIENT_REQUIRED');
      return supabase;
    }

    async function callRpc(name, params) {
      var supabase = await getSupabaseClient();
      if (typeof supabase.rpc !== 'function') fail('ACCOUNT_CLIENT_REQUIRED');
      var result = await supabase.rpc(name, params);
      if (result && result.error) throw result.error;
      return result && result.data;
    }

    function requireRegistered() {
      var identity = accountClient.getIdentity();
      if (!identity || identity.kind !== 'registered') fail('REGISTERED_ACCOUNT_REQUIRED');
    }

    async function list(options) {
      options = options || {};
      var cursor = cursorParams(options.cursor);
      var data = await callRpc('list_site_notifications', {
        p_before_visible_at: cursor.visibleAt,
        p_before_id: cursor.id,
        p_limit: normalizeLimit(options.limit),
      });
      return (data || []).map(publicNotification);
    }

    async function countUnread() {
      requireRegistered();
      return requiredNumber(await callRpc('count_unread_site_notifications'));
    }

    async function markRead(notificationId) {
      requireRegistered();
      var row = requiredRpcRow(await callRpc('mark_site_notification_read', {
        p_notification_id: notificationId,
      }));
      return {
        notificationId: row && row.notification_id != null ? row.notification_id : null,
        readAt: row && row.read_at != null ? row.read_at : null,
      };
    }

    async function claimReward(notificationId, requestId) {
      requireRegistered();
      if (requestId == null || requestId === '') fail('REQUEST_ID_REQUIRED');
      var row = requiredRpcRow(await callRpc('claim_site_notification_reward', {
        p_notification_id: notificationId,
        p_request_id: requestId,
      }));
      return {
        rewardAmount: nullableNumber(row && row.reward_amount),
        balance: nullableNumber(row && row.balance),
        claimedAt: row && row.claimed_at != null ? row.claimed_at : null,
      };
    }

    async function adminList() {
      requireRegistered();
      var data = await callRpc('admin_list_site_notifications', undefined);
      return (data || []).map(adminNotification);
    }

    async function adminPublish(notification) {
      requireRegistered();
      notification = notification || {};
      return adminNotification(requiredRpcRow(await callRpc('admin_publish_site_notification', {
        p_title: notification.title,
        p_body: notification.body,
        p_reward_amount: nullableNumber(notification.rewardAmount),
        p_visible_at: notification.visibleAt,
        p_expires_at: notification.expiresAt ?? null,
      })));
    }

    async function adminDisable(notificationId) {
      requireRegistered();
      return adminNotification(requiredRpcRow(await callRpc('admin_disable_site_notification', {
        p_notification_id: notificationId,
      })));
    }

    function notifyListeners() {
      Array.from(listeners).forEach(function (listener) {
        try { listener(); } catch (_) { /* Keep notifying remaining listeners. */ }
      });
    }

    async function remove(current, supabase) {
      if (current && supabase && typeof supabase.removeChannel === 'function') {
        await supabase.removeChannel(current);
      }
    }

    async function clearChannel() {
      var current = channel;
      var supabase = channelSupabase;
      channel = null;
      channelSupabase = null;
      await remove(current, supabase);
    }

    async function buildChannel() {
      var supabase = await getSupabaseClient();
      if (typeof supabase.channel !== 'function') fail('ACCOUNT_CLIENT_REQUIRED');
      var user = null;
      var identity = accountClient.getIdentity();
      if (identity && identity.kind === 'registered') {
        if (!supabase.auth || typeof supabase.auth.getSession !== 'function') {
          fail('REGISTERED_ACCOUNT_REQUIRED');
        }
        var result = await supabase.auth.getSession();
        if (result && result.error) throw result.error;
        user = result && result.data && result.data.session && result.data.session.user;
        if (!user) fail('REGISTERED_ACCOUNT_REQUIRED');
      }
      var current = supabase.channel('player-notifications');
      current.on('postgres_changes', {
        event: '*', schema: 'public', table: 'site_notifications',
      }, notifyListeners);
      if (user && user.id != null) {
        current.on('postgres_changes', {
          event: '*', schema: 'public', table: 'notification_reads', filter: 'user_id=eq.' + user.id,
        }, notifyListeners);
      }
      try {
        await new Promise(function (resolve, reject) {
          current.subscribe(function (status) {
            if (status === 'SUBSCRIBED') resolve();
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              reject(new Error(status));
            }
          });
        });
      } catch (error) {
        await remove(current, supabase);
        throw error;
      }
      return { channel: current, supabase: supabase };
    }

    function requestChannelRefresh() {
      var requestedVersion = ++channelVersion;
      var pending = channelQueue.then(async function () {
        if (requestedVersion !== channelVersion || listeners.size === 0) return;
        await clearChannel();
        if (requestedVersion !== channelVersion || listeners.size === 0) return;
        var built = await buildChannel();
        if (requestedVersion !== channelVersion || listeners.size === 0) {
          await remove(built.channel, built.supabase);
          return;
        }
        channel = built.channel;
        channelSupabase = built.supabase;
      });
      channelQueue = pending.catch(function () {});
      latestChannelPromise = pending;
      pending.then(function () {
        if (latestChannelPromise === pending) latestChannelPromise = null;
      }, function () {
        if (latestChannelPromise === pending) latestChannelPromise = null;
      });
      return pending;
    }

    async function ensureChannel() {
      while (listeners.size > 0 && !channel) {
        await (latestChannelPromise || requestChannelRefresh());
      }
    }

    function startIdentitySubscription() {
      if (unsubscribeIdentity || typeof accountClient.subscribe !== 'function') return;
      var cleanup = accountClient.subscribe(function () {
        if (listeners.size === 0) return;
        return requestChannelRefresh().catch(function () {});
      });
      unsubscribeIdentity = typeof cleanup === 'function' ? cleanup : function () {};
    }

    function stopIdentitySubscription() {
      if (!unsubscribeIdentity) return;
      var cleanup = unsubscribeIdentity;
      unsubscribeIdentity = null;
      cleanup();
    }

    async function stopChannel() {
      var stoppedVersion = ++channelVersion;
      stopIdentitySubscription();
      await channelQueue;
      if (listeners.size === 0 && stoppedVersion === channelVersion) await clearChannel();
    }

    async function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      var wasEmpty = listeners.size === 0;
      listeners.add(listener);
      if (wasEmpty) {
        startIdentitySubscription();
        requestChannelRefresh();
      }
      try {
        await ensureChannel();
      } catch (error) {
        listeners.delete(listener);
        if (listeners.size === 0) await stopChannel();
        throw error;
      }

      var cleaned = false;
      return async function cleanup() {
        if (cleaned) return;
        cleaned = true;
        listeners.delete(listener);
        if (listeners.size === 0) await stopChannel();
      };
    }

    return {
      list: list,
      countUnread: countUnread,
      markRead: markRead,
      claimReward: claimReward,
      adminList: adminList,
      adminPublish: adminPublish,
      adminDisable: adminDisable,
      subscribe: subscribe,
    };
  }

  return {
    createNotificationsClient: createNotificationsClient,
    mapNotificationsError: mapNotificationsError,
  };
}));
