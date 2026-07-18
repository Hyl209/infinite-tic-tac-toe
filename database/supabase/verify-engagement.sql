-- SAFETY: run only against an explicitly isolated Supabase test project.
-- Order: apply migrations -> run this structural block -> run the external session checks below.
-- This file never creates/deletes Auth users. Admin, registered-player, and visitor sessions are external.
-- The operator must explicitly confirm the current target is an isolated test project.

do $$
declare
  v_name text;
  v_role text;
  v_privilege text;
  v_tables text[] := array[
    'activities','activity_claims','site_notifications','notification_reads',
    'notification_claims','checkin_rule_versions','player_checkins'
  ];
  v_rpcs text[] := array[
    'list_active_activities()','claim_activity_reward(uuid,uuid)','admin_list_activities()',
    'admin_save_activity(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,bigint)',
    'admin_unpublish_activity(uuid)','list_site_notifications(timestamptz,uuid,integer)',
    'count_unread_site_notifications()','mark_site_notification_read(uuid)',
    'claim_site_notification_reward(uuid,uuid)','admin_list_site_notifications()',
    'admin_publish_site_notification(text,text,bigint,timestamptz,timestamptz)',
    'admin_disable_site_notification(uuid)','get_checkin_month(date)',
    'perform_daily_checkin(uuid)','perform_makeup_checkin(date,text,uuid)',
    'admin_list_checkin_rules()',
    'admin_create_checkin_rule(date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint)'
  ];
  v_timestamp_columns text[] := array[
    'activities.publish_at','activities.starts_at','activities.ends_at','activities.created_at','activities.updated_at',
    'activity_claims.claimed_at','site_notifications.visible_at','site_notifications.expires_at',
    'site_notifications.created_at','site_notifications.updated_at','notification_reads.read_at',
    'notification_claims.claimed_at','checkin_rule_versions.created_at','player_checkins.created_at'
  ];
begin
  foreach v_name in array v_tables loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'missing engagement table: public.%', v_name;
    end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_name)) then
      raise exception 'RLS disabled: public.%', v_name;
    end if;
    foreach v_role in array array['anon','authenticated'] loop
      foreach v_privilege in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
        if has_table_privilege(v_role, 'public.' || v_name, v_privilege) then
          raise exception '% has % on public.%', v_role, v_privilege, v_name;
        end if;
      end loop;
    end loop;
  end loop;

  if not has_table_privilege('anon', 'public.site_notifications', 'SELECT')
     or not has_table_privilege('authenticated', 'public.site_notifications', 'SELECT')
     or not has_table_privilege('authenticated', 'public.notification_reads', 'SELECT') then
    raise exception 'engagement SELECT table ACL baseline missing';
  end if;

  foreach v_name in array v_rpcs loop
    if to_regprocedure('public.' || v_name) is null then
      raise exception 'missing engagement RPC: public.%', v_name;
    end if;
    if not has_function_privilege('authenticated', to_regprocedure('public.' || v_name), 'EXECUTE') then
      raise exception 'authenticated EXECUTE missing: public.%', v_name;
    end if;
    if v_name not in ('list_active_activities()','list_site_notifications(timestamptz,uuid,integer)')
       and has_function_privilege('anon', to_regprocedure('public.' || v_name), 'EXECUTE') then
      raise exception 'anon EXECUTE must be revoked: public.%', v_name;
    end if;
  end loop;

  if not has_function_privilege('anon', 'public.list_active_activities()', 'EXECUTE')
     or not has_function_privilege('anon', 'public.list_site_notifications(timestamptz,uuid,integer)', 'EXECUTE') then
    raise exception 'visitor RPC ACL baseline missing';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_notifications'
        and policyname = 'visitors can read active site notifications' and cmd = 'SELECT'
        and 'anon' = any(roles) and 'authenticated' = any(roles)
        and qual like '%is_active%' and qual like '%visible_at%' and qual like '%expires_at%') then
    raise exception 'site notification SELECT policy baseline missing';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notification_reads'
        and policyname = 'players can read own notification reads' and cmd = 'SELECT'
        and 'authenticated' = any(roles) and qual like '%auth.uid()%' and qual like '%user_id%') then
    raise exception 'notification read SELECT policy baseline missing';
  end if;

  foreach v_name in array array['activity_claims','notification_claims','player_checkins'] loop
    if not exists (select 1 from pg_trigger where not tgisinternal and tgenabled <> 'D'
          and tgname = 'engagement_record_immutable' and tgrelid = to_regclass('public.' || v_name)
          and tgfoid = to_regprocedure('public.prevent_engagement_record_mutation()')
          and pg_get_triggerdef(oid) like '%BEFORE UPDATE OR DELETE%'
          and pg_get_triggerdef(oid) like '%FOR EACH ROW%') then
      raise exception 'immutable trigger baseline missing: public.%', v_name;
    end if;
  end loop;
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.validate_public_url(text,boolean)')
                 and provolatile = 'i') then raise exception 'immutable URL helper baseline missing'; end if;
  foreach v_name in array v_timestamp_columns loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = split_part(v_name, '.', 1) and column_name = split_part(v_name, '.', 2)
          and data_type = 'timestamp with time zone') then
      raise exception 'timestamptz baseline missing: public.%', v_name;
    end if;
  end loop;
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.site_local_date()')
                 and provolatile = 's' and pg_get_functiondef(oid) like '%Asia/Hong_Kong%')
     or public.site_local_date() <> (now() at time zone 'Asia/Hong_Kong')::date then
    raise exception 'Hong Kong date helper baseline missing';
  end if;
end;
$$;

-- ROLLBACK SMOKE TEMPLATE: only in an isolated SQL session already bound to a real test user;
-- never fake auth.uid()/JWT claims: BEGIN; SELECT auth.uid(); SELECT * FROM
-- public.perform_daily_checkin(gen_random_uuid()); inspect wallet/check-in/ledger rows; ROLLBACK.
-- External three-account flow: admin publishes an activity/notification; registered player sees and claims it;
-- visitor sees only public content. Expect admin-only writes rejected for player/visitor and one immutable claim.
-- Concurrent daily check-in: in two authenticated browser tabs for the same real player, call
-- supabase.rpc('perform_daily_checkin',{p_request_id:crypto.randomUUID()}) simultaneously.
-- Expect exactly one success, one CHECKIN_ALREADY_DONE, one check-in row, and one reward ledger effect.
-- Insufficient-coins makeup: externally provision a real player below makeup_cost, call perform_makeup_checkin
-- for an eligible missed date, and expect INSUFFICIENT_BALANCE with no check-in or ledger mutation.
-- Hong Kong rollover: in the isolated project, compare SELECT now(), now() AT TIME ZONE 'Asia/Hong_Kong';
-- call daily check-in from a real browser session on both sides of HK midnight and expect distinct checkin_date values.
