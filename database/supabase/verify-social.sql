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
    where pg_get_constraintdef(oid) is not null
      and conrelid = to_regclass('public.profiles')
      and conname = 'profiles_username_not_player_uid'
      and contype = 'c'
      and lower(regexp_replace(pg_get_constraintdef(oid), '[[:space:]]+', '', 'g'))
            like '%not%username~''^[0-9]+$''::text%and%char_length(username)=6%'
  ) then
    raise exception 'profiles.username must reserve six ASCII digits for player_uid';
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
      and qual is not null
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%auth.uid()%'
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%requester_id%'
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%recipient_id%'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'friendships'
      and policyname = 'friends can read their relationships'
      and cmd = 'SELECT' and roles @> array['authenticated']::name[]
      and qual is not null
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%auth.uid()%'
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%user_low%'
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%user_high%'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'player_presence'
      and policyname = 'friends can read presence'
      and cmd = 'SELECT' and roles @> array['authenticated']::name[]
      and qual is not null
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%auth.uid()%'
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%user_id%'
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%friendships%'
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%user_low%'
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%user_high%'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'game_invites'
      and policyname = 'game invite participants can read'
      and cmd = 'SELECT' and roles @> array['authenticated']::name[]
      and qual is not null
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%auth.uid()%'
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%sender_id%'
      and lower(regexp_replace(qual, '[[:space:]]+', '', 'g')) like '%recipient_id%'
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
select exists (
  select 1
  from pg_constraint
  where conrelid = to_regclass('public.profiles')
    and conname = 'profiles_username_not_player_uid'
    and contype = 'c'
) as profiles_username_not_player_uid_present;

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

with uid_slots as (
  select
    count(*) as profile_count,
    count(*) filter (where player_uid = 0 and public.format_player_uid(player_uid) = '000000') as uid_000000_count,
    count(*) filter (where player_uid = 1 and public.format_player_uid(player_uid) = '000001') as uid_000001_count
  from public.profiles
)
select
  profile_count,
  case when profile_count < 1 then null else uid_000000_count = 1 end as uid_000000_present,
  case when profile_count < 2 then null else uid_000001_count = 1 end as uid_000001_present
from uid_slots;

select
  not has_column_privilege('authenticated', 'public.profiles', 'player_uid', 'INSERT')
    as authenticated_insert_player_uid_revoked,
  not has_column_privilege('authenticated', 'public.profiles', 'player_uid', 'UPDATE')
    as authenticated_update_player_uid_revoked;

-- Authenticated exact-search spot checks after choosing real test fixtures:
-- SELECT * FROM public.search_player_by_uid(0);
-- SELECT * FROM public.search_player_by_uid(1);
-- SELECT * FROM public.search_player_by_username('<complete_username>');

-- OPT-IN WRITE ACCEPTANCE: never execute these templates on an unconfirmed or production project.
-- Copy one complete template at a time into an isolated SQL session after removing the leading `-- `.
-- The default execution path of this file ends above and remains read-only.

-- TEMPLATE: UID IMMUTABILITY
-- BEGIN;
-- SET LOCAL ROLE postgres;
-- DO $verify_uid_immutable$
-- DECLARE
--   v_profile_id uuid;
--   v_original_uid integer;
--   v_caught_expected_error boolean := false;
-- BEGIN
--   SELECT profile.id, profile.player_uid
--   INTO v_profile_id, v_original_uid
--   FROM public.profiles AS profile
--   ORDER BY profile.created_at, profile.id
--   LIMIT 1;
--   IF v_profile_id IS NULL THEN
--     RAISE EXCEPTION 'VERIFY_REQUIRES_ONE_PROFILE';
--   END IF;
--   BEGIN
--     UPDATE public.profiles
--     SET player_uid = CASE WHEN v_original_uid = 999999 THEN 999998 ELSE v_original_uid + 1 END
--     WHERE id = v_profile_id;
--   EXCEPTION WHEN OTHERS THEN
--     IF SQLERRM = 'PLAYER_UID_IMMUTABLE' THEN
--       v_caught_expected_error := true;
--     ELSE
--       RAISE EXCEPTION 'EXPECTED_PLAYER_UID_IMMUTABLE_GOT_%', SQLERRM;
--     END IF;
--   END;
--   IF NOT v_caught_expected_error THEN
--     RAISE EXCEPTION 'PLAYER_UID_UPDATE_UNEXPECTEDLY_SUCCEEDED';
--   END IF;
-- END;
-- $verify_uid_immutable$;
-- ROLLBACK;

-- Concurrent-registration warning: PostgreSQL sequences are non-transactional. Profile/Auth rows roll
-- back, but each attempted registration permanently consumes one test UID. Use an isolated disposable project.
-- Run Session A and Session B at the same time, then compare their formatted_player_uid values: they must differ.

-- TEMPLATE: CONCURRENT REGISTRATION SESSION A
-- BEGIN;
-- SET LOCAL ROLE postgres;
-- CREATE TEMP TABLE verify_registration_actor_a (id uuid PRIMARY KEY) ON COMMIT DROP;
-- WITH inserted_user AS (
--   INSERT INTO auth.users (id, aud, role, created_at, updated_at)
--   VALUES (gen_random_uuid(), 'authenticated', 'authenticated', now(), now())
--   RETURNING id
-- )
-- INSERT INTO verify_registration_actor_a (id)
-- SELECT id FROM inserted_user;
-- INSERT INTO public.profiles (id, username, game_name)
-- SELECT actor.id, 'va_' || left(replace(actor.id::text, '-', ''), 12), 'Verify A'
-- FROM verify_registration_actor_a AS actor;
-- SELECT
--   'session_a' AS session_name,
--   profile.player_uid,
--   lpad(profile.player_uid::text, 6, '0') AS formatted_player_uid
-- FROM public.profiles AS profile
-- JOIN verify_registration_actor_a AS actor ON actor.id = profile.id;
-- ROLLBACK;

-- TEMPLATE: CONCURRENT REGISTRATION SESSION B
-- BEGIN;
-- SET LOCAL ROLE postgres;
-- CREATE TEMP TABLE verify_registration_actor_b (id uuid PRIMARY KEY) ON COMMIT DROP;
-- WITH inserted_user AS (
--   INSERT INTO auth.users (id, aud, role, created_at, updated_at)
--   VALUES (gen_random_uuid(), 'authenticated', 'authenticated', now(), now())
--   RETURNING id
-- )
-- INSERT INTO verify_registration_actor_b (id)
-- SELECT id FROM inserted_user;
-- INSERT INTO public.profiles (id, username, game_name)
-- SELECT actor.id, 'vb_' || left(replace(actor.id::text, '-', ''), 12), 'Verify B'
-- FROM verify_registration_actor_b AS actor;
-- SELECT
--   'session_b' AS session_name,
--   profile.player_uid,
--   lpad(profile.player_uid::text, 6, '0') AS formatted_player_uid
-- FROM public.profiles AS profile
-- JOIN verify_registration_actor_b AS actor ON actor.id = profile.id;
-- ROLLBACK;

-- TEMPLATE: FRIEND REQUEST BY UID
-- BEGIN;
-- SET LOCAL ROLE postgres;
-- DO $verify_friend_uid_context$
-- DECLARE
--   v_actor_id uuid;
--   v_target_uid integer;
-- BEGIN
--   SELECT actor.id, target.player_uid
--   INTO v_actor_id, v_target_uid
--   FROM public.profiles AS actor
--   CROSS JOIN public.profiles AS target
--   WHERE actor.id <> target.id
--     AND NOT EXISTS (
--       SELECT 1 FROM public.friendships AS friendship
--       WHERE (friendship.user_low = actor.id AND friendship.user_high = target.id)
--          OR (friendship.user_low = target.id AND friendship.user_high = actor.id)
--     )
--     AND NOT EXISTS (
--       SELECT 1 FROM public.friend_requests AS request
--       WHERE (request.requester_id = actor.id AND request.recipient_id = target.id)
--          OR (request.requester_id = target.id AND request.recipient_id = actor.id)
--     )
--   ORDER BY actor.created_at, actor.id, target.created_at, target.id
--   LIMIT 1;
--   IF v_actor_id IS NULL THEN
--     RAISE EXCEPTION 'VERIFY_REQUIRES_TWO_UNRELATED_PROFILES';
--   END IF;
--   PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
--   PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
--   PERFORM set_config('verify_social.target_uid', v_target_uid::text, true);
-- END;
-- $verify_friend_uid_context$;
-- SET LOCAL ROLE authenticated;
-- DO $verify_friend_uid_request$
-- DECLARE
--   v_match_count integer;
--   v_target_id uuid;
--   v_request_id uuid;
-- BEGIN
--   SELECT count(*), (array_agg(player.user_id))[1]
--   INTO v_match_count, v_target_id
--   FROM public.search_player_by_uid(current_setting('verify_social.target_uid')::integer) AS player;
--   IF v_match_count <> 1 OR v_target_id IS NULL THEN
--     RAISE EXCEPTION 'UID_SEARCH_EXPECTED_ONE_TARGET_GOT_%', v_match_count;
--   END IF;
--   v_request_id := public.send_friend_request(v_target_id);
--   IF v_request_id IS NULL THEN
--     RAISE EXCEPTION 'UID_FRIEND_REQUEST_RETURNED_NULL';
--   END IF;
--   RAISE NOTICE 'uid friend request id=%', v_request_id;
-- END;
-- $verify_friend_uid_request$;
-- ROLLBACK;

-- TEMPLATE: FRIEND REQUEST BY USERNAME
-- BEGIN;
-- SET LOCAL ROLE postgres;
-- DO $verify_friend_username_context$
-- DECLARE
--   v_actor_id uuid;
--   v_target_username text;
-- BEGIN
--   SELECT actor.id, target.username
--   INTO v_actor_id, v_target_username
--   FROM public.profiles AS actor
--   CROSS JOIN public.profiles AS target
--   WHERE actor.id <> target.id
--     AND NOT EXISTS (
--       SELECT 1 FROM public.friendships AS friendship
--       WHERE (friendship.user_low = actor.id AND friendship.user_high = target.id)
--          OR (friendship.user_low = target.id AND friendship.user_high = actor.id)
--     )
--     AND NOT EXISTS (
--       SELECT 1 FROM public.friend_requests AS request
--       WHERE (request.requester_id = actor.id AND request.recipient_id = target.id)
--          OR (request.requester_id = target.id AND request.recipient_id = actor.id)
--     )
--   ORDER BY actor.created_at, actor.id, target.created_at, target.id
--   LIMIT 1;
--   IF v_actor_id IS NULL THEN
--     RAISE EXCEPTION 'VERIFY_REQUIRES_TWO_UNRELATED_PROFILES';
--   END IF;
--   PERFORM set_config('request.jwt.claim.sub', v_actor_id::text, true);
--   PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
--   PERFORM set_config('verify_social.target_username', v_target_username, true);
-- END;
-- $verify_friend_username_context$;
-- SET LOCAL ROLE authenticated;
-- DO $verify_friend_username_request$
-- DECLARE
--   v_match_count integer;
--   v_target_id uuid;
--   v_request_id uuid;
-- BEGIN
--   SELECT count(*), (array_agg(player.user_id))[1]
--   INTO v_match_count, v_target_id
--   FROM public.search_player_by_username(current_setting('verify_social.target_username')) AS player;
--   IF v_match_count <> 1 OR v_target_id IS NULL THEN
--     RAISE EXCEPTION 'USERNAME_SEARCH_EXPECTED_ONE_TARGET_GOT_%', v_match_count;
--   END IF;
--   v_request_id := public.send_friend_request(v_target_id);
--   IF v_request_id IS NULL THEN
--     RAISE EXCEPTION 'USERNAME_FRIEND_REQUEST_RETURNED_NULL';
--   END IF;
--   RAISE NOTICE 'username friend request id=%', v_request_id;
-- END;
-- $verify_friend_username_request$;
-- ROLLBACK;

-- END OPT-IN WRITE ACCEPTANCE
