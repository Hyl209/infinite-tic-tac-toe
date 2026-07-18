(function initPlayerActivities(globalScope) {
  'use strict';

  const ERROR_MESSAGES = {
    REGISTERED_ACCOUNT_REQUIRED: '请先登录正式账号',
    ADMIN_REQUIRED: '需要管理员权限',
    ACTIVITY_NOT_FOUND: '活动不存在',
    ACTIVITY_DISABLED: '活动已下架',
    ACTIVITY_NOT_PUBLISHED: '活动尚未发布',
    ACTIVITY_NOT_STARTED: '活动尚未开始',
    ACTIVITY_ENDED: '活动已结束',
    ACTIVITY_ALREADY_CLAIMED: '活动奖励已经领取',
    INVALID_ACTIVITY_RESPONSE: '活动服务返回了无效数据，请稍后重试',
  };

  function firstRpcRow(data) {
    return Array.isArray(data) ? data[0] : data;
  }

  function requiredRpcRow(data) {
    const row = firstRpcRow(data);
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('INVALID_ACTIVITY_RESPONSE');
    }
    return row;
  }

  function mapActivity(row = {}) {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      coverUrl: row.cover_url ?? null,
      actionLabel: row.action_label ?? null,
      actionUrl: row.action_url ?? null,
      publishAt: row.publish_at ?? null,
      startsAt: row.starts_at ?? null,
      endsAt: row.ends_at ?? null,
      rewardAmount: Number(row.reward_amount ?? 0),
      claimed: Boolean(row.claimed),
      claimedAt: row.claimed_at ?? null,
    };
  }

  function mapAdminActivity(row = {}) {
    return {
      ...mapActivity(row),
      active: Boolean(row.is_active),
      createdBy: row.created_by ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
      claimCount: Number(row.claim_count ?? 0),
    };
  }

  function mapActivitiesError(error) {
    const message = String(error?.message || error || '');
    const code = Object.keys(ERROR_MESSAGES).find((item) => message.includes(item));
    return code ? ERROR_MESSAGES[code] : '活动服务暂时不可用，请稍后重试';
  }

  function createActivitiesClient({ accountClient } = {}) {
    if (!accountClient) throw new Error('ACCOUNT_CLIENT_REQUIRED');

    function requireRegistered() {
      if (accountClient.getIdentity().kind !== 'registered') {
        throw new Error('REGISTERED_ACCOUNT_REQUIRED');
      }
    }

    async function callRpc(name, params) {
      const supabase = await accountClient.getSupabaseClient();
      const result = await supabase.rpc(name, params);
      if (result.error) throw result.error;
      return result.data;
    }

    async function listActive() {
      const rows = await callRpc('list_active_activities');
      return (rows || []).map(mapActivity);
    }

    async function claimReward(activityId, requestId) {
      requireRegistered();
      const row = requiredRpcRow(await callRpc('claim_activity_reward', {
        p_activity_id: activityId,
        p_request_id: requestId,
      }));
      return {
        rewardAmount: Number(row.reward_amount ?? 0),
        balance: Number(row.balance ?? 0),
        claimedAt: row.claimed_at ?? null,
      };
    }

    async function adminList() {
      requireRegistered();
      const rows = await callRpc('admin_list_activities');
      return (rows || []).map(mapAdminActivity);
    }

    async function adminSave(input = {}) {
      requireRegistered();
      const row = requiredRpcRow(await callRpc('admin_save_activity', {
        p_id: input.id ?? null,
        p_title: input.title ?? null,
        p_body: input.body ?? null,
        p_cover_url: input.coverUrl ?? null,
        p_action_label: input.actionLabel ?? null,
        p_action_url: input.actionUrl ?? null,
        p_publish_at: input.publishAt ?? null,
        p_starts_at: input.startsAt ?? null,
        p_ends_at: input.endsAt ?? null,
        p_reward_amount: Number(input.rewardAmount ?? 0),
      }));
      return mapAdminActivity(row);
    }

    async function adminUnpublish(activityId) {
      requireRegistered();
      const row = requiredRpcRow(await callRpc('admin_unpublish_activity', {
        p_activity_id: activityId,
      }));
      return mapAdminActivity(row);
    }

    return {
      adminList,
      adminSave,
      adminUnpublish,
      claimReward,
      listActive,
    };
  }

  const playerActivities = {
    createActivitiesClient,
    mapActivitiesError,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = playerActivities;
  globalScope.PlayerActivities = playerActivities;
})(typeof window !== 'undefined' ? window : globalThis);
