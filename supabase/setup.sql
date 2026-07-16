create extension if not exists pgcrypto;

create table if not exists public.online_games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  x_player uuid not null,
  o_player uuid,
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'x_win', 'o_win', 'abandoned')),
  board jsonb not null default '[null,null,null,null,null,null,null,null,null]'::jsonb,
  x_order smallint[] not null default '{}'::smallint[],
  o_order smallint[] not null default '{}'::smallint[],
  current_mark text not null default 'X' check (current_mark in ('X', 'O')),
  winning_line smallint[] not null default '{}'::smallint[],
  x_score integer not null default 0 check (x_score >= 0),
  o_score integer not null default 0 check (o_score >= 0),
  round integer not null default 1 check (round >= 1),
  x_rematch boolean not null default false,
  o_rematch boolean not null default false,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check (jsonb_typeof(board) = 'array' and jsonb_array_length(board) = 9),
  check (coalesce(array_length(x_order, 1), 0) <= 3),
  check (coalesce(array_length(o_order, 1), 0) <= 3)
);

create index if not exists online_games_expires_at_idx
  on public.online_games (expires_at);

alter table public.online_games replica identity full;
alter table public.online_games enable row level security;

create or replace function public.generate_online_room_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_index integer;
begin
  for v_index in 1..6 loop
    v_code := v_code || substr(
      v_alphabet,
      floor(random() * length(v_alphabet))::integer + 1,
      1
    );
  end loop;
  return v_code;
end;
$$;

create or replace function public.online_winning_line(
  p_board jsonb,
  p_mark text
)
returns smallint[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_lines constant jsonb := '[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]'::jsonb;
  v_line jsonb;
  v_a smallint;
  v_b smallint;
  v_c smallint;
begin
  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_a := (v_line ->> 0)::smallint;
    v_b := (v_line ->> 1)::smallint;
    v_c := (v_line ->> 2)::smallint;
    if p_board ->> v_a = p_mark
      and p_board ->> v_b = p_mark
      and p_board ->> v_c = p_mark then
      return array[v_a, v_b, v_c]::smallint[];
    end if;
  end loop;
  return '{}'::smallint[];
end;
$$;

create or replace function public.create_online_game()
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
  v_attempt integer;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  delete from public.online_games where expires_at < now();

  select * into v_game
  from public.online_games
  where x_player = v_user
    and o_player is null
    and status = 'waiting'
    and expires_at >= now()
  order by created_at desc
  limit 1;

  if found then
    return next v_game;
    return;
  end if;

  for v_attempt in 1..20 loop
    begin
      insert into public.online_games (room_code, x_player)
      values (public.generate_online_room_code(), v_user)
      returning * into v_game;
      return next v_game;
      return;
    exception when unique_violation then
      null;
    end;
  end loop;

  raise exception 'ROOM_CODE_UNAVAILABLE';
end;
$$;

create or replace function public.join_online_game(p_room_code text)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_code text := upper(trim(p_room_code));
  v_game public.online_games;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  select * into v_game
  from public.online_games
  where room_code = v_code
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_game.expires_at < now() then
    delete from public.online_games where id = v_game.id;
    raise exception 'ROOM_EXPIRED';
  end if;

  if v_game.x_player = v_user or v_game.o_player = v_user then
    update public.online_games
    set expires_at = now() + interval '24 hours',
        updated_at = now()
    where id = v_game.id
    returning * into v_game;
    return next v_game;
    return;
  end if;

  if v_game.o_player is not null or v_game.status <> 'waiting' then
    raise exception 'ROOM_FULL';
  end if;

  update public.online_games
  set o_player = v_user,
      status = 'playing',
      updated_at = now(),
      expires_at = now() + interval '24 hours',
      version = version + 1
  where id = v_game.id
  returning * into v_game;

  delete from public.online_games
  where expires_at < now() and id <> v_game.id;

  return next v_game;
end;
$$;

create or replace function public.play_online_move(
  p_game_id uuid,
  p_cell smallint
)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
  v_mark text;
  v_board jsonb;
  v_x_order smallint[];
  v_o_order smallint[];
  v_removed smallint;
  v_winning_line smallint[];
  v_status text;
  v_x_score integer;
  v_o_score integer;
  v_next_mark text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_cell < 0 or p_cell > 8 then
    raise exception 'CELL_OUT_OF_RANGE';
  end if;

  select * into v_game
  from public.online_games
  where id = p_game_id
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_game.expires_at < now() then
    raise exception 'ROOM_EXPIRED';
  end if;
  if v_game.status <> 'playing' or v_game.o_player is null then
    raise exception 'GAME_NOT_PLAYING';
  end if;

  if v_game.x_player = v_user then
    v_mark := 'X';
  elsif v_game.o_player = v_user then
    v_mark := 'O';
  else
    raise exception 'NOT_A_PLAYER';
  end if;

  if v_game.current_mark <> v_mark then
    raise exception 'NOT_YOUR_TURN';
  end if;
  if v_game.board -> p_cell <> 'null'::jsonb then
    raise exception 'CELL_OCCUPIED';
  end if;

  v_board := jsonb_set(
    v_game.board,
    array[p_cell::text],
    to_jsonb(v_mark),
    false
  );
  v_x_order := v_game.x_order;
  v_o_order := v_game.o_order;

  if v_mark = 'X' then
    v_x_order := array_append(v_x_order, p_cell);
    if array_length(v_x_order, 1) > 3 then
      v_removed := v_x_order[1];
      v_x_order := v_x_order[2:array_length(v_x_order, 1)];
      v_board := jsonb_set(
        v_board,
        array[v_removed::text],
        'null'::jsonb,
        false
      );
    end if;
  else
    v_o_order := array_append(v_o_order, p_cell);
    if array_length(v_o_order, 1) > 3 then
      v_removed := v_o_order[1];
      v_o_order := v_o_order[2:array_length(v_o_order, 1)];
      v_board := jsonb_set(
        v_board,
        array[v_removed::text],
        'null'::jsonb,
        false
      );
    end if;
  end if;

  v_winning_line := public.online_winning_line(v_board, v_mark);
  v_status := v_game.status;
  v_x_score := v_game.x_score;
  v_o_score := v_game.o_score;
  v_next_mark := case when v_mark = 'X' then 'O' else 'X' end;

  if coalesce(array_length(v_winning_line, 1), 0) = 3 then
    v_status := lower(v_mark) || '_win';
    v_next_mark := v_mark;
    if v_mark = 'X' then
      v_x_score := v_x_score + 1;
    else
      v_o_score := v_o_score + 1;
    end if;
  end if;

  update public.online_games
  set board = v_board,
      x_order = v_x_order,
      o_order = v_o_order,
      current_mark = v_next_mark,
      status = v_status,
      winning_line = v_winning_line,
      x_score = v_x_score,
      o_score = v_o_score,
      x_rematch = false,
      o_rematch = false,
      updated_at = now(),
      expires_at = now() + interval '24 hours',
      version = version + 1
  where id = v_game.id
  returning * into v_game;

  return next v_game;
end;
$$;

create or replace function public.request_online_rematch(p_game_id uuid)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
  v_x_ready boolean;
  v_o_ready boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_game
  from public.online_games
  where id = p_game_id
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_game.status not in ('x_win', 'o_win') then
    raise exception 'GAME_NOT_FINISHED';
  end if;

  v_x_ready := v_game.x_rematch;
  v_o_ready := v_game.o_rematch;
  if v_game.x_player = v_user then
    v_x_ready := true;
  elsif v_game.o_player = v_user then
    v_o_ready := true;
  else
    raise exception 'NOT_A_PLAYER';
  end if;

  if v_x_ready and v_o_ready then
    update public.online_games
    set board = '[null,null,null,null,null,null,null,null,null]'::jsonb,
        x_order = '{}'::smallint[],
        o_order = '{}'::smallint[],
        current_mark = 'X',
        status = 'playing',
        winning_line = '{}'::smallint[],
        round = round + 1,
        x_rematch = false,
        o_rematch = false,
        updated_at = now(),
        expires_at = now() + interval '24 hours',
        version = version + 1
    where id = v_game.id
    returning * into v_game;
  else
    update public.online_games
    set x_rematch = v_x_ready,
        o_rematch = v_o_ready,
        updated_at = now(),
        expires_at = now() + interval '24 hours',
        version = version + 1
    where id = v_game.id
    returning * into v_game;
  end if;

  return next v_game;
end;
$$;

create or replace function public.leave_online_game(p_game_id uuid)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_game
  from public.online_games
  where id = p_game_id
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_game.x_player <> v_user and v_game.o_player is distinct from v_user then
    raise exception 'NOT_A_PLAYER';
  end if;

  update public.online_games
  set status = 'abandoned',
      updated_at = now(),
      expires_at = now() + interval '24 hours',
      version = version + 1
  where id = v_game.id
  returning * into v_game;

  return next v_game;
end;
$$;

drop policy if exists "online players can read games" on public.online_games;
create policy "online players can read games"
on public.online_games for select
to authenticated
using (auth.uid() = x_player or auth.uid() = o_player);

grant select on public.online_games to authenticated;
revoke insert, update, delete on public.online_games from anon, authenticated;

revoke all on function public.generate_online_room_code() from public, anon, authenticated;
revoke all on function public.online_winning_line(jsonb, text) from public, anon, authenticated;

revoke all on function public.create_online_game() from public, anon;
revoke all on function public.join_online_game(text) from public, anon;
revoke all on function public.play_online_move(uuid, smallint) from public, anon;
revoke all on function public.request_online_rematch(uuid) from public, anon;
revoke all on function public.leave_online_game(uuid) from public, anon;

grant execute on function public.create_online_game() to authenticated;
grant execute on function public.join_online_game(text) to authenticated;
grant execute on function public.play_online_move(uuid, smallint) to authenticated;
grant execute on function public.request_online_rematch(uuid) to authenticated;
grant execute on function public.leave_online_game(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'online_games'
  ) then
    execute 'alter publication supabase_realtime add table public.online_games';
  end if;
end;
$$;

drop policy if exists "online players can receive room presence" on realtime.messages;
create policy "online players can receive room presence"
on realtime.messages for select
to authenticated
using (
  extension = 'presence'
  and exists (
    select 1
    from public.online_games game
    where realtime.topic() = 'room:' || game.id::text
      and (auth.uid() = game.x_player or auth.uid() = game.o_player)
  )
);

drop policy if exists "online players can send room presence" on realtime.messages;
create policy "online players can send room presence"
on realtime.messages for insert
to authenticated
with check (
  extension = 'presence'
  and exists (
    select 1
    from public.online_games game
    where realtime.topic() = 'room:' || game.id::text
      and (auth.uid() = game.x_player or auth.uid() = game.o_player)
  )
);
