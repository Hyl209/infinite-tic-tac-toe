-- Player UID, friendships, presence, and waiting-room invitations.

create sequence if not exists public.player_uid_seq
  as bigint
  minvalue 0
  maxvalue 999999
  start with 0
  increment by 1
  no cycle;

alter table public.profiles
  add column if not exists player_uid integer;

with ranked_profiles as (
  select
    profile.id,
    row_number() over (
      order by
        (admin.user_id is not null) desc,
        profile.created_at,
        profile.id
    ) - 1 as assigned_player_uid
  from public.profiles as profile
  left join public.admins as admin on admin.user_id = profile.id
)
update public.profiles as profile
set player_uid = ranked.assigned_player_uid
from ranked_profiles as ranked
where profile.id = ranked.id
  and profile.player_uid is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_player_uid_range'
  ) then
    alter table public.profiles
      add constraint profiles_player_uid_range
      check (player_uid between 0 and 999999);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_player_uid_unique'
  ) then
    alter table public.profiles
      add constraint profiles_player_uid_unique unique (player_uid);
  end if;
end;
$$;

alter table public.profiles alter column player_uid set not null;

select setval(
  'public.player_uid_seq',
  least(coalesce((select max(player_uid) + 1 from public.profiles), 0), 999999),
  coalesce((select max(player_uid) from public.profiles), -1) >= 999999
);

create or replace function public.format_player_uid(p_player_uid integer)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select lpad(p_player_uid::text, 6, '0');
$$;

create or replace function public.assign_player_uid()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.player_uid is not null then
    raise exception 'PLAYER_UID_IMMUTABLE';
  end if;

  begin
    new.player_uid := nextval('public.player_uid_seq');
  exception
    when sequence_generator_limit_exceeded then
      raise exception 'PLAYER_UID_EXHAUSTED';
  end;
  return new;
end;
$$;

create or replace function public.prevent_player_uid_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.player_uid is distinct from old.player_uid then
    raise exception 'PLAYER_UID_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_assign_player_uid on public.profiles;
create trigger profiles_assign_player_uid
before insert on public.profiles
for each row execute function public.assign_player_uid();

drop trigger if exists profiles_prevent_player_uid_change on public.profiles;
create trigger profiles_prevent_player_uid_change
before update on public.profiles
for each row execute function public.prevent_player_uid_change();

revoke all on sequence public.player_uid_seq from public, anon, authenticated;
revoke execute on function public.format_player_uid(integer) from public, anon, authenticated;
revoke execute on function public.assign_player_uid() from public, anon, authenticated;
revoke execute on function public.prevent_player_uid_change() from public, anon, authenticated;
revoke insert, update on table public.profiles from authenticated;
grant insert (id, username, game_name) on public.profiles to authenticated;
grant update (game_name) on public.profiles to authenticated;

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (requester_id <> recipient_id)
);

create unique index if not exists friend_requests_canonical_pair_unique
on public.friend_requests (
  least(requester_id::text, recipient_id::text),
  greatest(requester_id::text, recipient_id::text)
);

create index if not exists friend_requests_recipient_created_idx
on public.friend_requests (recipient_id, created_at desc);

create table if not exists public.friendships (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  check (user_low::text < user_high::text)
);

create index if not exists friendships_user_high_idx
on public.friendships (user_high, created_at desc);

create table if not exists public.player_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create table if not exists public.game_invites (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.online_games(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

create unique index if not exists game_invites_one_pending_per_game
on public.game_invites (game_id)
where status = 'pending';

create index if not exists game_invites_recipient_status_created_idx
on public.game_invites (recipient_id, status, created_at desc);

create index if not exists game_invites_sender_status_created_idx
on public.game_invites (sender_id, status, created_at desc);

alter table public.friend_requests replica identity full;
alter table public.game_invites replica identity full;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.player_presence enable row level security;
alter table public.game_invites enable row level security;

drop policy if exists "friend request participants can read" on public.friend_requests;
create policy "friend request participants can read"
on public.friend_requests for select
to authenticated
using (auth.uid() in (requester_id, recipient_id));

drop policy if exists "friends can read their relationships" on public.friendships;
create policy "friends can read their relationships"
on public.friendships for select
to authenticated
using (auth.uid() in (user_low, user_high));

drop policy if exists "friends can read presence" on public.player_presence;
create policy "friends can read presence"
on public.player_presence for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.friendships as friendship
    where friendship.user_low = case
      when auth.uid()::text < user_id::text then auth.uid() else user_id
    end
      and friendship.user_high = case
        when auth.uid()::text < user_id::text then user_id else auth.uid()
      end
  )
);

drop policy if exists "game invite participants can read" on public.game_invites;
create policy "game invite participants can read"
on public.game_invites for select
to authenticated
using (auth.uid() in (sender_id, recipient_id));

revoke all on table public.friend_requests from public, anon, authenticated;
revoke all on table public.friendships from public, anon, authenticated;
revoke all on table public.player_presence from public, anon, authenticated;
revoke all on table public.game_invites from public, anon, authenticated;
grant select on table public.friend_requests to authenticated;
grant select on table public.friendships to authenticated;
grant select on table public.player_presence to authenticated;
grant select on table public.game_invites to authenticated;

create or replace function public.friend_relationship_state(
  p_viewer uuid,
  p_target uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_viewer = p_target then 'self'
    when exists (
      select 1 from public.friendships as friendship
      where friendship.user_low = case
        when p_viewer::text < p_target::text then p_viewer else p_target
      end
        and friendship.user_high = case
          when p_viewer::text < p_target::text then p_target else p_viewer
        end
    ) then 'friends'
    when exists (
      select 1 from public.friend_requests as request
      where request.requester_id = p_viewer and request.recipient_id = p_target
    ) then 'outgoing'
    when exists (
      select 1 from public.friend_requests as request
      where request.requester_id = p_target and request.recipient_id = p_viewer
    ) then 'incoming'
    else 'none'
  end;
$$;

create or replace function public.search_player_by_username(p_username text)
returns table (
  user_id uuid,
  player_uid text,
  username text,
  game_name text,
  relationship_state text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
  v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if v_username !~ '^[a-z0-9_]+$'
     or char_length(v_username) not between 3 and 20 then
    return;
  end if;

  return query
  select
    profile.id,
    public.format_player_uid(profile.player_uid),
    profile.username,
    profile.game_name,
    public.friend_relationship_state(v_user, profile.id)
  from public.profiles as profile
  where profile.username = v_username
  limit 1;
end;
$$;

create or replace function public.search_player_by_uid(p_player_uid integer)
returns table (
  user_id uuid,
  player_uid text,
  username text,
  game_name text,
  relationship_state text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
begin
  if p_player_uid is null or not (p_player_uid between 0 and 999999) then
    raise exception 'INVALID_PLAYER_UID';
  end if;

  return query
  select
    profile.id,
    public.format_player_uid(profile.player_uid),
    profile.username,
    profile.game_name,
    public.friend_relationship_state(v_user, profile.id)
  from public.profiles as profile
  where profile.player_uid = p_player_uid
  limit 1;
end;
$$;

create or replace function public.list_friends()
returns table (
  user_id uuid,
  player_uid text,
  username text,
  game_name text,
  online boolean,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
begin
  return query
  select
    profile.id,
    public.format_player_uid(profile.player_uid),
    profile.username,
    profile.game_name,
    coalesce(presence.last_seen_at >= now() - interval '90 seconds', false),
    presence.last_seen_at
  from public.friendships as friendship
  join public.profiles as profile on profile.id = case
    when friendship.user_low = v_user then friendship.user_high
    else friendship.user_low
  end
  left join public.player_presence as presence on presence.user_id = profile.id
  where v_user in (friendship.user_low, friendship.user_high)
  order by lower(profile.game_name), profile.id;
end;
$$;

create or replace function public.list_friend_requests()
returns table (
  id uuid,
  direction text,
  other_user_id uuid,
  other_player_uid text,
  other_username text,
  other_game_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
begin
  return query
  select
    request.id,
    case when request.recipient_id = v_user then 'incoming' else 'outgoing' end,
    profile.id,
    public.format_player_uid(profile.player_uid),
    profile.username,
    profile.game_name,
    request.created_at
  from public.friend_requests as request
  join public.profiles as profile on profile.id = case
    when request.recipient_id = v_user then request.requester_id
    else request.recipient_id
  end
  where v_user in (request.requester_id, request.recipient_id)
  order by request.created_at desc, request.id;
end;
$$;

create or replace function public.send_friend_request(p_recipient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
  v_request_id uuid;
  v_low uuid;
  v_high uuid;
begin
  if p_recipient_id is null
     or not exists (select 1 from public.profiles where id = p_recipient_id) then
    raise exception 'PLAYER_NOT_FOUND';
  end if;
  if p_recipient_id = v_user then raise exception 'CANNOT_FRIEND_SELF'; end if;

  v_low := case when v_user::text < p_recipient_id::text then v_user else p_recipient_id end;
  v_high := case when v_user::text < p_recipient_id::text then p_recipient_id else v_user end;
  if exists (
    select 1 from public.friendships
    where user_low = v_low and user_high = v_high
  ) then
    raise exception 'ALREADY_FRIENDS';
  end if;
  if exists (
    select 1 from public.friend_requests
    where least(requester_id::text, recipient_id::text) = least(v_user::text, p_recipient_id::text)
      and greatest(requester_id::text, recipient_id::text) = greatest(v_user::text, p_recipient_id::text)
  ) then
    raise exception 'FRIEND_REQUEST_EXISTS';
  end if;

  begin
    insert into public.friend_requests (requester_id, recipient_id)
    values (v_user, p_recipient_id)
    returning id into v_request_id;
  exception when unique_violation then
    raise exception 'FRIEND_REQUEST_EXISTS';
  end;
  return v_request_id;
end;
$$;

create or replace function public.accept_friend_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
  v_request public.friend_requests;
  v_low uuid;
  v_high uuid;
begin
  select * into v_request
  from public.friend_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'FRIEND_REQUEST_NOT_FOUND'; end if;
  if v_request.recipient_id <> v_user then
    raise exception 'FRIEND_REQUEST_NOT_RECIPIENT';
  end if;

  v_low := case when v_request.requester_id::text < v_user::text
    then v_request.requester_id else v_user end;
  v_high := case when v_request.requester_id::text < v_user::text
    then v_user else v_request.requester_id end;
  insert into public.friendships (user_low, user_high)
  values (v_low, v_high)
  on conflict (user_low, user_high) do nothing;
  delete from public.friend_requests where id = v_request.id;
end;
$$;

create or replace function public.reject_friend_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
  v_request public.friend_requests;
begin
  select * into v_request
  from public.friend_requests
  where id = p_request_id
  for update;
  if not found then raise exception 'FRIEND_REQUEST_NOT_FOUND'; end if;
  if v_request.recipient_id <> v_user then
    raise exception 'FRIEND_REQUEST_NOT_RECIPIENT';
  end if;
  delete from public.friend_requests where id = v_request.id;
end;
$$;

create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
  v_low uuid := case when v_user::text < p_friend_id::text then v_user else p_friend_id end;
  v_high uuid := case when v_user::text < p_friend_id::text then p_friend_id else v_user end;
begin
  delete from public.friendships where user_low = v_low and user_high = v_high;
  if not found then raise exception 'FRIENDSHIP_NOT_FOUND'; end if;
end;
$$;

create or replace function public.heartbeat_player_presence()
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
  v_seen_at timestamptz := now();
begin
  insert into public.player_presence (user_id, last_seen_at)
  values (v_user, v_seen_at)
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;
  return v_seen_at;
end;
$$;

create or replace function public.list_game_invites()
returns table (
  id uuid,
  game_id uuid,
  game_type text,
  room_code text,
  wager_amount integer,
  sender_id uuid,
  sender_player_uid text,
  sender_username text,
  sender_game_name text,
  recipient_id uuid,
  recipient_player_uid text,
  recipient_username text,
  recipient_game_name text,
  direction text,
  status text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
begin
  update public.game_invites as invite
  set status = 'expired', updated_at = now()
  where invite.status = 'pending' and invite.expires_at <= now();

  return query
  select
    invite.id,
    game.id,
    game.game_type,
    game.room_code,
    game.wager_amount,
    sender.id,
    public.format_player_uid(sender.player_uid),
    sender.username,
    sender.game_name,
    recipient.id,
    public.format_player_uid(recipient.player_uid),
    recipient.username,
    recipient.game_name,
    case when invite.recipient_id = v_user then 'incoming' else 'outgoing' end,
    invite.status,
    invite.expires_at,
    invite.created_at
  from public.game_invites as invite
  join public.online_games as game on game.id = invite.game_id
  join public.profiles as sender on sender.id = invite.sender_id
  join public.profiles as recipient on recipient.id = invite.recipient_id
  where v_user in (invite.sender_id, invite.recipient_id)
    and invite.status = 'pending'
  order by invite.created_at desc, invite.id;
end;
$$;

create or replace function public.send_game_invite(
  p_game_id uuid,
  p_recipient_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
  v_game public.online_games;
  v_low uuid;
  v_high uuid;
  v_invite_id uuid;
begin
  select * into v_game
  from public.online_games
  where id = p_game_id
  for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.x_player <> v_user then raise exception 'NOT_ROOM_OWNER'; end if;
  if v_game.expires_at <= now() then raise exception 'ROOM_EXPIRED'; end if;
  if v_game.status <> 'waiting' then raise exception 'ROOM_NOT_WAITING'; end if;
  if v_game.o_player is not null then raise exception 'ROOM_FULL'; end if;
  if p_recipient_id is null
     or not exists (select 1 from public.profiles where id = p_recipient_id) then
    raise exception 'PLAYER_NOT_FOUND';
  end if;

  v_low := case when v_user::text < p_recipient_id::text then v_user else p_recipient_id end;
  v_high := case when v_user::text < p_recipient_id::text then p_recipient_id else v_user end;
  if not exists (
    select 1 from public.friendships
    where user_low = v_low and user_high = v_high
  ) then
    raise exception 'NOT_FRIENDS';
  end if;

  update public.game_invites
  set status = 'expired', updated_at = now()
  where game_id = p_game_id and status = 'pending' and expires_at <= now();
  if exists (
    select 1 from public.game_invites
    where game_id = p_game_id and status = 'pending'
  ) then
    raise exception 'GAME_INVITE_EXISTS';
  end if;

  begin
    insert into public.game_invites (
      game_id, sender_id, recipient_id, expires_at
    ) values (
      p_game_id,
      v_user,
      p_recipient_id,
      least(v_game.expires_at, now() + interval '15 minutes')
    ) returning id into v_invite_id;
  exception when unique_violation then
    raise exception 'GAME_INVITE_EXISTS';
  end;
  return v_invite_id;
end;
$$;

create or replace function public.cancel_game_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
  v_invite public.game_invites;
begin
  select * into v_invite
  from public.game_invites
  where id = p_invite_id
  for update;
  if not found then raise exception 'GAME_INVITE_NOT_FOUND'; end if;
  if v_invite.sender_id <> v_user then raise exception 'GAME_INVITE_NOT_SENDER'; end if;
  if v_invite.expires_at <= now() and v_invite.status = 'pending' then
    update public.game_invites set status = 'expired', updated_at = now()
    where id = v_invite.id;
    raise exception 'GAME_INVITE_EXPIRED';
  end if;
  if v_invite.status <> 'pending' then raise exception 'GAME_INVITE_NOT_FOUND'; end if;
  update public.game_invites set status = 'cancelled', updated_at = now()
  where id = v_invite.id;
end;
$$;

create or replace function public.decline_game_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := public.require_registered_user();
  v_invite public.game_invites;
begin
  select * into v_invite
  from public.game_invites
  where id = p_invite_id
  for update;
  if not found then raise exception 'GAME_INVITE_NOT_FOUND'; end if;
  if v_invite.recipient_id <> v_user then raise exception 'GAME_INVITE_NOT_RECIPIENT'; end if;
  if v_invite.expires_at <= now() and v_invite.status = 'pending' then
    update public.game_invites set status = 'expired', updated_at = now()
    where id = v_invite.id;
    raise exception 'GAME_INVITE_EXPIRED';
  end if;
  if v_invite.status <> 'pending' then raise exception 'GAME_INVITE_NOT_FOUND'; end if;
  update public.game_invites set status = 'declined', updated_at = now()
  where id = v_invite.id;
end;
$$;

create or replace function public.sync_game_invite_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.o_player is not null and new.o_player is distinct from old.o_player then
    update public.game_invites
    set status = 'accepted', updated_at = now()
    where game_id = new.id
      and recipient_id = new.o_player
      and status = 'pending';
  end if;

  if new.status <> 'waiting' or new.o_player is not null then
    update public.game_invites
    set status = 'cancelled', updated_at = now()
    where game_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists online_game_sync_invites on public.online_games;
create trigger online_game_sync_invites
after update of o_player, status on public.online_games
for each row execute function public.sync_game_invite_status();

revoke execute on function public.friend_relationship_state(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.search_player_by_username(text) from public, anon;
revoke execute on function public.search_player_by_uid(integer) from public, anon;
revoke execute on function public.list_friends() from public, anon;
revoke execute on function public.list_friend_requests() from public, anon;
revoke execute on function public.send_friend_request(uuid) from public, anon;
revoke execute on function public.accept_friend_request(uuid) from public, anon;
revoke execute on function public.reject_friend_request(uuid) from public, anon;
revoke execute on function public.remove_friend(uuid) from public, anon;
revoke execute on function public.heartbeat_player_presence() from public, anon;
revoke execute on function public.list_game_invites() from public, anon;
revoke execute on function public.send_game_invite(uuid, uuid) from public, anon;
revoke execute on function public.cancel_game_invite(uuid) from public, anon;
revoke execute on function public.decline_game_invite(uuid) from public, anon;
revoke execute on function public.sync_game_invite_status() from public, anon, authenticated;

grant execute on function public.search_player_by_username(text) to authenticated;
grant execute on function public.search_player_by_uid(integer) to authenticated;
grant execute on function public.list_friends() to authenticated;
grant execute on function public.list_friend_requests() to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.accept_friend_request(uuid) to authenticated;
grant execute on function public.reject_friend_request(uuid) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.heartbeat_player_presence() to authenticated;
grant execute on function public.list_game_invites() to authenticated;
grant execute on function public.send_game_invite(uuid, uuid) to authenticated;
grant execute on function public.cancel_game_invite(uuid) to authenticated;
grant execute on function public.decline_game_invite(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friend_requests'
  ) then
    alter publication supabase_realtime add table public.friend_requests;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_invites'
  ) then
    alter publication supabase_realtime add table public.game_invites;
  end if;
end;
$$;
