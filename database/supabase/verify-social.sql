-- SAFETY: read-only, repeatable acceptance checks. This file performs no schema or data writes.
-- Run only after choosing the intended Supabase project and applying the social migration there.
-- Authenticated behavioral checks are listed as comments at the end and never run by default.

do $verify_social$
declare
  v_name text;
  v_role text;
  v_privilege text;
  v_definition text;
  v_tables text[] := array[
    'friend_requests', 'friendships', 'player_presence', 'game_invites'
  ];
  -- The original 12 social RPCs plus the exact six-digit UID search extension.
  v_rpcs text[] := array[
    'search_player_by_username(text)', 'search_player_by_uid(integer)',
    'list_friends()', 'list_friend_requests()', 'send_friend_request(uuid)',
    'accept_friend_request(uuid)', 'reject_friend_request(uuid)', 'remove_friend(uuid)',
    'heartbeat_player_presence()', 'list_game_invites()', 'send_game_invite(uuid,uuid)',
    'cancel_game_invite(uuid)', 'decline_game_invite(uuid)'
  ];
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'player_uid'
      and data_type = 'integer'
      and is_nullable = 'NO'
  ) then
    raise exception 'profiles.player_uid must exist as NOT NULL integer';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.profiles')
      and conname = 'profiles_player_uid_unique'
      and contype = 'u'
  ) then
    raise exception 'profiles.player_uid unique constraint missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.profiles')
      and conname = 'profiles_player_uid_range'
      and contype = 'c'
      and (
        lower(regexp_replace(pg_get_constraintdef(oid), '[()[:space:]]+', '', 'g'))
          like '%player_uidbetween0and999999%'
        or (
          lower(regexp_replace(pg_get_constraintdef(oid), '[()[:space:]]+', '', 'g'))
            like '%player_uid>=0%'
          and lower(regexp_replace(pg_get_constraintdef(oid), '[()[:space:]]+', '', 'g'))
            like '%player_uid<=999999%'
        )
      )
  ) then
    raise exception 'profiles.player_uid range constraint missing';
  end if;

  if not exists (
    select 1
    from pg_sequences
    where schemaname = 'public'
      and sequencename = 'player_uid_seq'
      and min_value = 0
      and max_value = 999999
      and increment_by = 1
      and cycle = false
  ) then
    raise exception 'player_uid_seq must be atomic, 0..999999, increment 1, NO CYCLE';
  end if;

  if has_sequence_privilege('anon', 'public.player_uid_seq', 'USAGE')
     or has_sequence_privilege('authenticated', 'public.player_uid_seq', 'USAGE') then
    raise exception 'client roles must not allocate player_uid directly';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    join pg_proc function_row on function_row.oid = trigger_row.tgfoid
    where trigger_row.tgrelid = to_regclass('public.profiles')
      and trigger_row.tgname = 'profiles_assign_player_uid'
      and function_row.proname = 'assign_player_uid'
      and not trigger_row.tgisinternal
      and pg_get_triggerdef(trigger_row.oid) like '%BEFORE INSERT%'
  ) then
    raise exception 'profiles_assign_player_uid / assign_player_uid trigger missing';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    join pg_proc function_row on function_row.oid = trigger_row.tgfoid
    where trigger_row.tgrelid = to_regclass('public.profiles')
      and trigger_row.tgname = 'profiles_prevent_player_uid_change'
      and function_row.proname = 'prevent_player_uid_change'
      and not trigger_row.tgisinternal
      and pg_get_triggerdef(trigger_row.oid) like '%BEFORE UPDATE%'
  ) then
    raise exception 'profiles_prevent_player_uid_change / prevent_player_uid_change trigger missing';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_privilege in array array['INSERT', 'UPDATE'] loop
      if has_column_privilege(v_role, 'public.profiles', 'player_uid', v_privilege) then
        raise exception '% must not have % on profiles.player_uid', v_role, v_privilege;
      end if;
    end loop;
  end loop;

  if exists (
    select player_uid
    from public.profiles
    group by player_uid
    having count(*) > 1
  ) then
    raise exception 'duplicate player_uid found';
  end if;

  if exists (
    select 1 from public.profiles
    where player_uid not between 0 and 999999 or player_uid is null
  ) then
    raise exception 'out-of-range or NULL player_uid found';
  end if;

  v_definition := lower(pg_get_functiondef(to_regprocedure('public.format_player_uid(integer)')));
  if v_definition not like '%lpad(%p_player_uid%6%''0''%' then
    raise exception 'format_player_uid must return a zero-padded six-digit UID';
  end if;

  foreach v_name in array v_tables loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'missing social table: public.%', v_name;
    end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_name)) then
      raise exception 'RLS disabled: public.%', v_name;
    end if;
    if not has_table_privilege('authenticated', 'public.' || v_name, 'SELECT')
       or has_table_privilege('anon', 'public.' || v_name, 'SELECT') then
      raise exception 'social SELECT ACL mismatch: public.%', v_name;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_privilege in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        if has_table_privilege(v_role, 'public.' || v_name, v_privilege) then
          raise exception '% has direct % on public.%', v_role, v_privilege, v_name;
        end if;
      end loop;
    end loop;
    if (select count(*) from pg_policies
        where schemaname = 'public' and tablename = v_name and cmd in ('SELECT', 'ALL')) <> 1 then
      raise exception 'expected one participant-readable policy on public.%', v_name;
    end if;
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_name
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) then
      raise exception 'write policy found on RPC-only table public.%', v_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'friend_requests'
      and policyname = 'friend request participants can read'
      and cmd = 'SELECT' and roles @> array['authenticated']::name[]
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'friendships'
      and policyname = 'friends can read their relationships'
      and cmd = 'SELECT' and roles @> array['authenticated']::name[]
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'player_presence'
      and policyname = 'friends can read presence'
      and cmd = 'SELECT' and roles @> array['authenticated']::name[]
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'game_invites'
      and policyname = 'game invite participants can read'
      and cmd = 'SELECT' and roles @> array['authenticated']::name[]
  ) then
    raise exception 'participant-only RLS policy baseline missing';
  end if;

  foreach v_name in array v_rpcs loop
    if to_regprocedure('public.' || v_name) is null then
      raise exception 'missing social RPC: public.%', v_name;
    end if;
    if not has_function_privilege('authenticated', to_regprocedure('public.' || v_name), 'EXECUTE')
       or has_function_privilege('anon', to_regprocedure('public.' || v_name), 'EXECUTE') then
      raise exception 'social RPC ACL mismatch: public.%', v_name;
    end if;
  end loop;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'friend_requests'
      and indexname = 'friend_requests_canonical_pair_unique'
      and lower(indexdef) like '%unique%least%requester_id%recipient_id%greatest%'
  ) then
    raise exception 'canonical pending friend-request uniqueness missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'game_invites'
      and indexname = 'game_invites_one_pending_per_game'
      and lower(indexdef) like '%unique%game_id%where%status%pending%'
  ) then
    raise exception 'game_invites_one_pending_per_game partial uniqueness missing';
  end if;

  foreach v_name in array array['friend_requests', 'game_invites'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_name
    ) then
      raise exception 'Realtime publication missing public.%', v_name;
    end if;
  end loop;

  v_definition := lower(pg_get_functiondef(to_regprocedure('public.search_player_by_username(text)')));
  if v_definition like '% ilike %' or v_definition like '% like %'
     or v_definition not like '%profile.username = v_username%' then
    raise exception 'username search must be normalized exact equality only';
  end if;

  v_definition := lower(pg_get_functiondef(to_regprocedure('public.search_player_by_uid(integer)')));
  if v_definition not like '%p_player_uid between 0 and 999999%'
     or v_definition not like '%profile.player_uid = p_player_uid%' then
    raise exception 'UID search must be exact and constrained to 0..999999';
  end if;

  v_definition := lower(pg_get_functiondef(to_regprocedure('public.list_friends()')));
  if v_definition not like '%90 seconds%' then
    raise exception 'friend online threshold must be 90 seconds';
  end if;

  v_definition := lower(pg_get_functiondef(to_regprocedure('public.send_game_invite(uuid,uuid)')));
  if v_definition not like '%15 minutes%'
     or v_definition not like '%least(v_game.expires_at,%' then
    raise exception 'game invite expiry must be the earlier of room expiry and 15 minutes';
  end if;
end;
$verify_social$;

-- Read-only operator reports. These return no email or full user UUID.
select player_uid, lpad(profile.player_uid::text, 6, '0') as formatted_player_uid, count(*)
from public.profiles as profile
where player_uid = 0 -- expect 000000 when at least one migrated profile exists
group by player_uid;

select player_uid, lpad(profile.player_uid::text, 6, '0') as formatted_player_uid, count(*)
from public.profiles as profile
where player_uid = 1 -- expect 000001 when at least two migrated profiles exist
group by player_uid;

-- This report is the migration-time ranking audit. Review it immediately after backfill or against
-- a pre-migration profile snapshot; later admin-role changes are not expected to renumber immutable UIDs.
with expected_order as (
  select
    row_number() over (
      order by (admin.user_id is not null) desc, profile.created_at, profile.id
    ) - 1 as expected_player_uid,
    profile.player_uid as actual_player_uid
  from public.profiles as profile
  left join public.admins as admin on admin.user_id = profile.id
)
select expected_player_uid, actual_player_uid, count(*) as mismatch_count
from expected_order
where expected_player_uid is distinct from actual_player_uid
group by expected_player_uid, actual_player_uid
order by expected_player_uid;

select player_uid, count(*) as duplicate_count
from public.profiles
group by player_uid
having count(*) > 1;

select count(*) as out_of_range_uid_count
from public.profiles
where player_uid not between 0 and 999999 or player_uid is null;

-- Authenticated exact-search acceptance (run from a real registered-player session):
-- SELECT * FROM public.search_player_by_uid(0); -- must return UID 000000 exactly, if present
-- SELECT * FROM public.search_player_by_uid(1); -- must return UID 000001 exactly, if present
-- SELECT * FROM public.search_player_by_username('<complete_username>'); -- full normalized username only

-- OPT-IN WRITE ACCEPTANCE: never execute on an unconfirmed project.
-- Each write scenario must run in an isolated real authenticated session and roll back.
-- UID immutable check:
-- BEGIN;
-- UPDATE public.profiles SET player_uid = player_uid + 1 WHERE id = auth.uid(); -- expect PLAYER_UID_IMMUTABLE
-- ROLLBACK;
--
-- Concurrent registration check: create two real Auth registrations concurrently in separate isolated
-- test sessions, let the profile INSERT triggers allocate UIDs, then ROLLBACK any transaction-scoped
-- fixtures and rerun the duplicate/range/order reports above. Expect zero duplicates and consecutive UIDs.
-- Friend acceptance: A calls search_player_by_uid or search_player_by_username, sends to B, B accepts;
-- repeat both exact-search paths in separate BEGIN/ROLLBACK fixtures and expect one friendship only.
