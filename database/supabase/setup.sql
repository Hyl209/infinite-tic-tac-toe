create extension if not exists pgcrypto;

drop policy if exists "online players can receive room presence" on realtime.messages;
drop policy if exists "online players can send room presence" on realtime.messages;
drop function if exists public.is_online_game_player(text);
drop table if exists public.online_games cascade;
drop function if exists public.online_winning_line(jsonb, text);
drop function if exists public.online_winning_line(text, jsonb, text, smallint);
drop function if exists public.replay_online_history(text, smallint[]);
drop function if exists public.online_empty_board(text);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  game_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (username ~ '^[a-z0-9_]+$'),
  check (char_length(username) between 3 and 20),
  check (char_length(game_name) between 1 and 16),
  check (game_name = btrim(game_name)),
  check (game_name !~ '[[:cntrl:]]')
);

alter table public.profiles
  drop constraint if exists profiles_username_check;
alter table public.profiles
  add constraint profiles_username_check
  check (username ~ '^[a-z0-9_]+$' and char_length(username) between 3 and 20);

alter table public.profiles enable row level security;

drop policy if exists "players can read own profile" on public.profiles;
drop policy if exists "players can create own profile" on public.profiles;
drop policy if exists "players can update own profile" on public.profiles;

create policy "players can read own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id);

create policy "players can create own profile"
on public.profiles for insert
to authenticated
with check (
  auth.uid() = id
  and username = split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)
);

create policy "players can update own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and username = split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)
);

create table public.online_games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (
    room_code ~ '^[A-HJ-NP-Z2-9]+$' and char_length(room_code) = 6
  ),
  game_type text not null check (game_type in ('tic_tac_toe', 'gomoku')),
  x_player uuid not null,
  o_player uuid,
  x_player_name text not null check (char_length(x_player_name) between 1 and 16),
  o_player_name text check (o_player_name is null or char_length(o_player_name) between 1 and 16),
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'x_win', 'o_win', 'draw', 'abandoned')),
  board jsonb not null,
  x_order smallint[] not null default '{}'::smallint[],
  o_order smallint[] not null default '{}'::smallint[],
  move_history smallint[] not null default '{}'::smallint[],
  current_mark text not null default 'X' check (current_mark in ('X', 'O')),
  winning_line smallint[] not null default '{}'::smallint[],
  x_score integer not null default 0 check (x_score >= 0),
  o_score integer not null default 0 check (o_score >= 0),
  round integer not null default 1 check (round >= 1),
  x_rematch boolean not null default false,
  o_rematch boolean not null default false,
  x_undos_remaining smallint not null default 3 check (x_undos_remaining between 0 and 3),
  o_undos_remaining smallint not null default 3 check (o_undos_remaining between 0 and 3),
  undo_request_mark text check (undo_request_mark is null or undo_request_mark in ('X', 'O')),
  undo_requested_at timestamptz,
  undo_expires_at timestamptz,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  check (
    jsonb_typeof(board) = 'array'
    and (
      (game_type = 'tic_tac_toe' and jsonb_array_length(board) = 9)
      or (game_type = 'gomoku' and jsonb_array_length(board) = 225)
    )
  ),
  check (coalesce(array_length(x_order, 1), 0) <= 3),
  check (coalesce(array_length(o_order, 1), 0) <= 3),
  check (
    (undo_request_mark is null and undo_requested_at is null and undo_expires_at is null)
    or (undo_request_mark is not null and undo_requested_at is not null and undo_expires_at is not null)
  )
);

create index online_games_expires_at_idx on public.online_games (expires_at);

alter table public.online_games replica identity full;
alter table public.online_games enable row level security;

create or replace function public.online_empty_board(p_game_type text)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select to_jsonb(array_fill(null::text, array[
    case when p_game_type = 'gomoku' then 225 else 9 end
  ]));
$$;

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
  p_game_type text,
  p_board jsonb,
  p_mark text,
  p_last_cell smallint
)
returns smallint[]
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_lines constant jsonb := '[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]'::jsonb;
  v_line_json jsonb;
  v_direction record;
  v_line smallint[];
  v_before smallint[];
  v_after smallint[];
  v_row integer;
  v_column integer;
  v_next_row integer;
  v_next_column integer;
  v_index smallint;
begin
  if p_game_type = 'tic_tac_toe' then
    for v_line_json in select value from jsonb_array_elements(v_lines) loop
      if p_board ->> ((v_line_json ->> 0)::smallint) = p_mark
        and p_board ->> ((v_line_json ->> 1)::smallint) = p_mark
        and p_board ->> ((v_line_json ->> 2)::smallint) = p_mark then
        return array[
          (v_line_json ->> 0)::smallint,
          (v_line_json ->> 1)::smallint,
          (v_line_json ->> 2)::smallint
        ];
      end if;
    end loop;
    return '{}'::smallint[];
  end if;

  v_row := p_last_cell / 15;
  v_column := p_last_cell % 15;
  for v_direction in
    select * from (values (0, 1), (1, 0), (1, 1), (1, -1)) as directions(row_step, column_step)
  loop
    v_before := '{}'::smallint[];
    v_after := '{}'::smallint[];
    v_next_row := v_row - v_direction.row_step;
    v_next_column := v_column - v_direction.column_step;
    while v_next_row between 0 and 14 and v_next_column between 0 and 14 loop
      v_index := (v_next_row * 15 + v_next_column)::smallint;
      exit when p_board ->> v_index is distinct from p_mark;
      v_before := array_prepend(v_index, v_before);
      v_next_row := v_next_row - v_direction.row_step;
      v_next_column := v_next_column - v_direction.column_step;
    end loop;

    v_next_row := v_row + v_direction.row_step;
    v_next_column := v_column + v_direction.column_step;
    while v_next_row between 0 and 14 and v_next_column between 0 and 14 loop
      v_index := (v_next_row * 15 + v_next_column)::smallint;
      exit when p_board ->> v_index is distinct from p_mark;
      v_after := array_append(v_after, v_index);
      v_next_row := v_next_row + v_direction.row_step;
      v_next_column := v_next_column + v_direction.column_step;
    end loop;

    v_line := v_before || array[p_last_cell]::smallint[] || v_after;
    if cardinality(v_line) >= 5 then
      return v_line;
    end if;
  end loop;
  return '{}'::smallint[];
end;
$$;

create or replace function public.replay_online_history(
  p_game_type text,
  p_history smallint[]
)
returns table (
  board jsonb,
  x_order smallint[],
  o_order smallint[],
  current_mark text
)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_turn integer;
  v_cell smallint;
  v_mark text;
  v_removed smallint;
begin
  board := public.online_empty_board(p_game_type);
  x_order := '{}'::smallint[];
  o_order := '{}'::smallint[];

  if cardinality(p_history) > 0 then
    for v_turn in 1..cardinality(p_history) loop
      v_cell := p_history[v_turn];
      v_mark := case when v_turn % 2 = 1 then 'X' else 'O' end;
      if board -> v_cell <> 'null'::jsonb then
        raise exception 'INVALID_MOVE_HISTORY';
      end if;
      board := jsonb_set(board, array[v_cell::text], to_jsonb(v_mark), false);

      if p_game_type = 'tic_tac_toe' and v_mark = 'X' then
        x_order := array_append(x_order, v_cell);
        if array_length(x_order, 1) > 3 then
          v_removed := x_order[1];
          x_order := x_order[2:array_length(x_order, 1)];
          board := jsonb_set(board, array[v_removed::text], 'null'::jsonb, false);
        end if;
      elsif p_game_type = 'tic_tac_toe' then
        o_order := array_append(o_order, v_cell);
        if array_length(o_order, 1) > 3 then
          v_removed := o_order[1];
          o_order := o_order[2:array_length(o_order, 1)];
          board := jsonb_set(board, array[v_removed::text], 'null'::jsonb, false);
        end if;
      end if;
    end loop;
  end if;

  current_mark := case when cardinality(p_history) % 2 = 0 then 'X' else 'O' end;
  return next;
end;
$$;

create or replace function public.is_online_game_player(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.online_games game
    where p_topic = 'room:' || game.id::text
      and (auth.uid() = game.x_player or auth.uid() = game.o_player)
  );
$$;

create or replace function public.resolve_online_player_name(p_guest_name text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  select game_name into v_name
  from public.profiles
  where id = auth.uid();

  if found then return v_name; end if;

  v_name := btrim(coalesce(p_guest_name, ''));
  if v_name !~ '^匿名玩家·[A-HJ-NP-Z2-9][A-HJ-NP-Z2-9][A-HJ-NP-Z2-9][A-HJ-NP-Z2-9]$' then
    raise exception 'INVALID_PLAYER_NAME';
  end if;
  return v_name;
end;
$$;

create or replace function public.create_online_game(p_game_type text, p_guest_name text)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_player_name text := public.resolve_online_player_name(p_guest_name);
  v_game public.online_games;
  v_attempt integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_game_type not in ('tic_tac_toe', 'gomoku') then raise exception 'INVALID_GAME_TYPE'; end if;
  delete from public.online_games where expires_at < now();

  select * into v_game
  from public.online_games
  where x_player = v_user
    and o_player is null
    and status = 'waiting'
    and game_type = p_game_type
    and expires_at >= now()
  order by created_at desc
  limit 1;
  if found then
    update public.online_games
    set x_player_name = v_player_name,
        updated_at = now(),
        expires_at = now() + interval '24 hours'
    where id = v_game.id
    returning * into v_game;
    return next v_game;
    return;
  end if;

  for v_attempt in 1..20 loop
    begin
      insert into public.online_games (room_code, game_type, x_player, x_player_name, board)
      values (
        public.generate_online_room_code(),
        p_game_type,
        v_user,
        v_player_name,
        public.online_empty_board(p_game_type)
      )
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

create or replace function public.join_online_game(p_room_code text, p_game_type text, p_guest_name text)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_player_name text := public.resolve_online_player_name(p_guest_name);
  v_code text := upper(trim(p_room_code));
  v_game public.online_games;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_code) <> 6 or v_code !~ '^[A-HJ-NP-Z2-9]+$' then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if p_game_type not in ('tic_tac_toe', 'gomoku') then raise exception 'INVALID_GAME_TYPE'; end if;

  select * into v_game
  from public.online_games
  where room_code = v_code
  for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.game_type <> p_game_type then raise exception 'ROOM_GAME_MISMATCH'; end if;
  if v_game.expires_at < now() then
    delete from public.online_games where id = v_game.id;
    raise exception 'ROOM_EXPIRED';
  end if;

  if v_game.x_player = v_user or v_game.o_player = v_user then
    update public.online_games
    set expires_at = now() + interval '24 hours', updated_at = now()
    where id = v_game.id
    returning * into v_game;
    return next v_game;
    return;
  end if;
  if v_game.o_player is not null or v_game.status <> 'waiting' then raise exception 'ROOM_FULL'; end if;

  update public.online_games
  set o_player = v_user,
      o_player_name = v_player_name,
      status = 'playing',
      updated_at = now(),
      expires_at = now() + interval '24 hours',
      version = version + 1
  where id = v_game.id
  returning * into v_game;
  return next v_game;
end;
$$;

create or replace function public.play_online_move(p_game_id uuid, p_cell smallint)
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
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_cell < 0 or p_cell > 224 then raise exception 'CELL_OUT_OF_RANGE'; end if;

  select * into v_game
  from public.online_games
  where id = p_game_id
  for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.expires_at < now() then raise exception 'ROOM_EXPIRED'; end if;
  if v_game.status <> 'playing' or v_game.o_player is null then raise exception 'GAME_NOT_PLAYING'; end if;
  if v_game.game_type = 'tic_tac_toe' and p_cell > 8 then raise exception 'CELL_OUT_OF_RANGE'; end if;
  if v_game.undo_request_mark is not null and v_game.undo_expires_at > now() then
    raise exception 'UNDO_PENDING';
  end if;

  if v_game.x_player = v_user then v_mark := 'X';
  elsif v_game.o_player = v_user then v_mark := 'O';
  else raise exception 'NOT_A_PLAYER';
  end if;
  if v_game.current_mark <> v_mark then raise exception 'NOT_YOUR_TURN'; end if;
  if v_game.board -> p_cell <> 'null'::jsonb then raise exception 'CELL_OCCUPIED'; end if;

  v_board := jsonb_set(v_game.board, array[p_cell::text], to_jsonb(v_mark), false);
  v_x_order := v_game.x_order;
  v_o_order := v_game.o_order;
  if v_game.game_type = 'tic_tac_toe' and v_mark = 'X' then
    v_x_order := array_append(v_x_order, p_cell);
    if array_length(v_x_order, 1) > 3 then
      v_removed := v_x_order[1];
      v_x_order := v_x_order[2:array_length(v_x_order, 1)];
      v_board := jsonb_set(v_board, array[v_removed::text], 'null'::jsonb, false);
    end if;
  elsif v_game.game_type = 'tic_tac_toe' then
    v_o_order := array_append(v_o_order, p_cell);
    if array_length(v_o_order, 1) > 3 then
      v_removed := v_o_order[1];
      v_o_order := v_o_order[2:array_length(v_o_order, 1)];
      v_board := jsonb_set(v_board, array[v_removed::text], 'null'::jsonb, false);
    end if;
  end if;

  v_winning_line := public.online_winning_line(v_game.game_type, v_board, v_mark, p_cell);
  v_status := 'playing';
  v_x_score := v_game.x_score;
  v_o_score := v_game.o_score;
  v_next_mark := case when v_mark = 'X' then 'O' else 'X' end;
  if cardinality(v_winning_line) >= (case when v_game.game_type = 'gomoku' then 5 else 3 end) then
    v_status := lower(v_mark) || '_win';
    v_next_mark := v_mark;
    if v_mark = 'X' then v_x_score := v_x_score + 1;
    else v_o_score := v_o_score + 1;
    end if;
  elsif v_game.game_type = 'gomoku' and cardinality(v_game.move_history) + 1 = 225 then
    v_status := 'draw';
  end if;

  update public.online_games
  set board = v_board,
      x_order = v_x_order,
      o_order = v_o_order,
      move_history = array_append(move_history, p_cell),
      current_mark = v_next_mark,
      status = v_status,
      winning_line = v_winning_line,
      x_score = v_x_score,
      o_score = v_o_score,
      x_rematch = false,
      o_rematch = false,
      undo_request_mark = null,
      undo_requested_at = null,
      undo_expires_at = null,
      updated_at = now(),
      expires_at = now() + interval '24 hours',
      version = version + 1
  where id = v_game.id
  returning * into v_game;
  return next v_game;
end;
$$;

create or replace function public.request_online_undo(p_game_id uuid)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
  v_mark text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_game from public.online_games where id = p_game_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.status <> 'playing' or v_game.o_player is null then raise exception 'GAME_NOT_PLAYING'; end if;
  if cardinality(v_game.move_history) = 0 then raise exception 'NOTHING_TO_UNDO'; end if;
  if v_game.undo_request_mark is not null and v_game.undo_expires_at > now() then raise exception 'UNDO_PENDING'; end if;

  if v_game.x_player = v_user then v_mark := 'X';
  elsif v_game.o_player = v_user then v_mark := 'O';
  else raise exception 'NOT_A_PLAYER';
  end if;

  if v_mark = 'X' then
    if v_game.x_undos_remaining <= 0 then raise exception 'UNDO_LIMIT_REACHED'; end if;
    update public.online_games
    set x_undos_remaining = x_undos_remaining - 1,
        undo_request_mark = 'X',
        undo_requested_at = now(),
        undo_expires_at = now() + interval '15 seconds',
        updated_at = now(),
        version = version + 1
    where id = v_game.id
    returning * into v_game;
  else
    if v_game.o_undos_remaining <= 0 then raise exception 'UNDO_LIMIT_REACHED'; end if;
    update public.online_games
    set o_undos_remaining = o_undos_remaining - 1,
        undo_request_mark = 'O',
        undo_requested_at = now(),
        undo_expires_at = now() + interval '15 seconds',
        updated_at = now(),
        version = version + 1
    where id = v_game.id
    returning * into v_game;
  end if;
  return next v_game;
end;
$$;

create or replace function public.respond_online_undo(p_game_id uuid, p_accept boolean)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
  v_user_mark text;
  v_history smallint[];
  v_length integer;
  v_board jsonb;
  v_x_order smallint[];
  v_o_order smallint[];
  v_next_mark text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_game from public.online_games where id = p_game_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.undo_request_mark is null then raise exception 'UNDO_NOT_PENDING'; end if;
  if v_game.undo_expires_at <= now() then raise exception 'UNDO_EXPIRED'; end if;
  if v_game.x_player = v_user then v_user_mark := 'X';
  elsif v_game.o_player = v_user then v_user_mark := 'O';
  else raise exception 'NOT_A_PLAYER';
  end if;
  if v_user_mark = v_game.undo_request_mark then raise exception 'UNDO_REQUESTER_CANNOT_RESPOND'; end if;

  if not p_accept then
    update public.online_games
    set undo_request_mark = null,
        undo_requested_at = null,
        undo_expires_at = null,
        updated_at = now(),
        version = version + 1
    where id = v_game.id
    returning * into v_game;
    return next v_game;
    return;
  end if;

  v_length := array_length(v_game.move_history, 1);
  if v_length is null or v_length = 0 then raise exception 'NOTHING_TO_UNDO'; end if;
  v_history := case
    when v_length = 1 then '{}'::smallint[]
    else v_game.move_history[1:v_length - 1]
  end;
  select replay.board, replay.x_order, replay.o_order, replay.current_mark
  into v_board, v_x_order, v_o_order, v_next_mark
  from public.replay_online_history(v_game.game_type, v_history) replay;

  update public.online_games
  set board = v_board,
      x_order = v_x_order,
      o_order = v_o_order,
      move_history = v_history,
      current_mark = v_next_mark,
      status = 'playing',
      winning_line = '{}'::smallint[],
      undo_request_mark = null,
      undo_requested_at = null,
      undo_expires_at = null,
      updated_at = now(),
      expires_at = now() + interval '24 hours',
      version = version + 1
  where id = v_game.id
  returning * into v_game;
  return next v_game;
end;
$$;

create or replace function public.cancel_online_undo(p_game_id uuid)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
  v_mark text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_game from public.online_games where id = p_game_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.undo_request_mark is null then raise exception 'UNDO_NOT_PENDING'; end if;
  if v_game.x_player = v_user then v_mark := 'X';
  elsif v_game.o_player = v_user then v_mark := 'O';
  else raise exception 'NOT_A_PLAYER';
  end if;
  if v_mark <> v_game.undo_request_mark then raise exception 'UNDO_NOT_REQUESTER'; end if;

  update public.online_games
  set undo_request_mark = null,
      undo_requested_at = null,
      undo_expires_at = null,
      updated_at = now(),
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
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_game from public.online_games where id = p_game_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.status not in ('x_win', 'o_win', 'draw') then raise exception 'GAME_NOT_FINISHED'; end if;

  v_x_ready := v_game.x_rematch;
  v_o_ready := v_game.o_rematch;
  if v_game.x_player = v_user then v_x_ready := true;
  elsif v_game.o_player = v_user then v_o_ready := true;
  else raise exception 'NOT_A_PLAYER';
  end if;

  if v_x_ready and v_o_ready then
    update public.online_games
    set board = case when game_type = 'gomoku'
          then public.online_empty_board('gomoku')
          else public.online_empty_board('tic_tac_toe')
        end,
        x_order = '{}'::smallint[],
        o_order = '{}'::smallint[],
        move_history = '{}'::smallint[],
        current_mark = 'X',
        status = 'playing',
        winning_line = '{}'::smallint[],
        round = round + 1,
        x_rematch = false,
        o_rematch = false,
        x_undos_remaining = 3,
        o_undos_remaining = 3,
        undo_request_mark = null,
        undo_requested_at = null,
        undo_expires_at = null,
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
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_game from public.online_games where id = p_game_id for update;
  if not found then return; end if;
  if v_game.x_player <> v_user and v_game.o_player is distinct from v_user then
    raise exception 'NOT_A_PLAYER';
  end if;
  if v_game.o_player is null then
    delete from public.online_games where id = v_game.id;
    return;
  end if;
  update public.online_games
  set status = 'abandoned',
      undo_request_mark = null,
      undo_requested_at = null,
      undo_expires_at = null,
      updated_at = now(),
      expires_at = now() + interval '1 hour',
      version = version + 1
  where id = v_game.id;
end;
$$;

create policy "online players can read their games"
on public.online_games for select
to authenticated
using (auth.uid() = x_player or auth.uid() = o_player);

do $$
begin
  alter publication supabase_realtime add table public.online_games;
exception when duplicate_object then
  null;
end;
$$;

create policy "online players can receive room presence"
on realtime.messages for select
to authenticated
using (
  realtime.topic() like 'room:%'
  and extension in ('broadcast', 'presence')
  and public.is_online_game_player(realtime.topic())
);

create policy "online players can send room presence"
on realtime.messages for insert
to authenticated
with check (
  realtime.topic() like 'room:%'
  and extension = 'presence'
  and public.is_online_game_player(realtime.topic())
);

revoke all on table public.online_games from public, anon;
grant select on table public.online_games to authenticated;

revoke all on table public.profiles from public, anon;
grant select, insert, update on table public.profiles to authenticated;

revoke all on function public.online_empty_board(text) from public, anon, authenticated;
revoke all on function public.generate_online_room_code() from public, anon, authenticated;
revoke all on function public.online_winning_line(text, jsonb, text, smallint) from public, anon, authenticated;
revoke all on function public.replay_online_history(text, smallint[]) from public, anon, authenticated;
revoke all on function public.is_online_game_player(text) from public, anon;
grant execute on function public.is_online_game_player(text) to authenticated;
revoke all on function public.resolve_online_player_name(text) from public, anon, authenticated;

revoke all on function public.create_online_game(text, text) from public, anon;
revoke all on function public.join_online_game(text, text, text) from public, anon;
revoke all on function public.play_online_move(uuid, smallint) from public, anon;
revoke all on function public.request_online_undo(uuid) from public, anon;
revoke all on function public.respond_online_undo(uuid, boolean) from public, anon;
revoke all on function public.cancel_online_undo(uuid) from public, anon;
revoke all on function public.request_online_rematch(uuid) from public, anon;
revoke all on function public.leave_online_game(uuid) from public, anon;

grant execute on function public.create_online_game(text, text) to authenticated;
grant execute on function public.join_online_game(text, text, text) to authenticated;
grant execute on function public.play_online_move(uuid, smallint) to authenticated;
grant execute on function public.request_online_undo(uuid) to authenticated;
grant execute on function public.respond_online_undo(uuid, boolean) to authenticated;
grant execute on function public.cancel_online_undo(uuid) to authenticated;
grant execute on function public.request_online_rematch(uuid) to authenticated;
grant execute on function public.leave_online_game(uuid) to authenticated;
-- Economy system and wager-safe online RPCs.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  game_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (username ~ '^[a-z0-9_]+$'),
  check (char_length(username) between 3 and 20),
  check (char_length(game_name) between 1 and 16),
  check (game_name = btrim(game_name)),
  check (game_name !~ '[[:cntrl:]]')
);

alter table public.profiles
  drop constraint if exists profiles_username_check;
alter table public.profiles
  add constraint profiles_username_check
  check (username ~ '^[a-z0-9_]+$' and char_length(username) between 3 and 20);

alter table public.profiles enable row level security;

drop policy if exists "players can read own profile" on public.profiles;
drop policy if exists "players can create own profile" on public.profiles;
drop policy if exists "players can update own profile" on public.profiles;

create policy "players can read own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id);

create policy "players can create own profile"
on public.profiles for insert
to authenticated
with check (
  auth.uid() = id
  and username = split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)
);

create policy "players can update own profile"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and username = split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)
);

revoke all on table public.profiles from public, anon;
grant select, insert, update on table public.profiles to authenticated;

alter table public.online_games add column if not exists x_player_name text;
alter table public.online_games add column if not exists o_player_name text;

update public.online_games
set x_player_name = '匿名玩家·' || upper(substr(replace(x_player::text, '-', ''), 1, 4))
where x_player_name is null;

update public.online_games
set o_player_name = '匿名玩家·' || upper(substr(replace(o_player::text, '-', ''), 1, 4))
where o_player is not null and o_player_name is null;

alter table public.online_games alter column x_player_name set not null;

alter table public.online_games
  drop constraint if exists online_games_room_code_check;
alter table public.online_games
  add constraint online_games_room_code_check
  check (room_code ~ '^[A-HJ-NP-Z2-9]+$' and char_length(room_code) = 6);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.online_games'::regclass
      and conname = 'online_games_x_player_name_check'
  ) then
    alter table public.online_games
      add constraint online_games_x_player_name_check
      check (char_length(x_player_name) between 1 and 16);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.online_games'::regclass
      and conname = 'online_games_o_player_name_check'
  ) then
    alter table public.online_games
      add constraint online_games_o_player_name_check
      check (o_player_name is null or char_length(o_player_name) between 1 and 16);
  end if;
end;
$$;

create or replace function public.resolve_online_player_name(p_guest_name text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  select game_name into v_name
  from public.profiles
  where id = auth.uid();

  if found then return v_name; end if;

  v_name := btrim(coalesce(p_guest_name, ''));
  if v_name !~ '^匿名玩家·[A-HJ-NP-Z2-9][A-HJ-NP-Z2-9][A-HJ-NP-Z2-9][A-HJ-NP-Z2-9]$' then
    raise exception 'INVALID_PLAYER_NAME';
  end if;
  return v_name;
end;
$$;

revoke all on function public.resolve_online_player_name(text) from public, anon, authenticated;

create table if not exists public.player_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 100 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coin_ledger (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta bigint not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  event_type text not null,
  reference_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists coin_ledger_user_created_idx
on public.coin_ledger (user_id, created_at desc);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.redeem_codes (
  id uuid primary key default gen_random_uuid(),
  code_digest text not null unique,
  code_hint text not null,
  amount bigint not null check (amount between 1 and 1000000),
  max_claims integer not null check (max_claims between 1 and 100000),
  claim_count integer not null default 0 check (claim_count between 0 and max_claims),
  expires_at timestamptz,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.redeem_claims (
  code_id uuid not null references public.redeem_codes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount > 0),
  claimed_at timestamptz not null default now(),
  primary key (code_id, user_id)
);

alter table public.player_wallets enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.admins enable row level security;
alter table public.redeem_codes enable row level security;
alter table public.redeem_claims enable row level security;

revoke all on table public.player_wallets from public, anon, authenticated;
revoke all on table public.coin_ledger from public, anon, authenticated;
revoke all on table public.admins from public, anon, authenticated;
revoke all on table public.redeem_codes from public, anon, authenticated;
revoke all on table public.redeem_claims from public, anon, authenticated;

alter table public.online_games add column if not exists wager_amount integer not null default 0;
alter table public.online_games add column if not exists x_stake_locked boolean not null default false;
alter table public.online_games add column if not exists o_stake_locked boolean not null default false;
alter table public.online_games add column if not exists wager_settled_at timestamptz;
alter table public.online_games add column if not exists finish_reason text;
alter table public.online_games add column if not exists x_last_seen_at timestamptz;
alter table public.online_games add column if not exists o_last_seen_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.online_games'::regclass
      and conname = 'online_games_wager_amount_check'
  ) then
    alter table public.online_games
      add constraint online_games_wager_amount_check
      check (wager_amount in (0, 10, 50, 100));
  end if;
end;
$$;

create or replace function public.prevent_coin_ledger_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'COIN_LEDGER_IMMUTABLE';
end;
$$;

drop trigger if exists coin_ledger_immutable on public.coin_ledger;
create trigger coin_ledger_immutable
before update or delete on public.coin_ledger
for each row execute function public.prevent_coin_ledger_mutation();

create or replace function public.is_economy_admin(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admins where user_id = p_user);
$$;

create or replace function public.apply_coin_delta(
  p_user uuid,
  p_delta bigint,
  p_event_type text,
  p_reference_id text,
  p_idempotency_key text
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_balance bigint;
  v_existing bigint;
begin
  if p_user is null or p_delta = 0 then raise exception 'INVALID_COIN_DELTA'; end if;

  select balance into v_balance
  from public.player_wallets
  where user_id = p_user
  for update;
  if not found then raise exception 'REGISTERED_ACCOUNT_REQUIRED'; end if;

  select balance_after into v_existing
  from public.coin_ledger
  where idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;

  if v_balance + p_delta < 0 then raise exception 'INSUFFICIENT_COINS'; end if;
  v_balance := v_balance + p_delta;

  update public.player_wallets
  set balance = v_balance, updated_at = now()
  where user_id = p_user;

  insert into public.coin_ledger (
    user_id, delta, balance_after, event_type, reference_id, idempotency_key
  ) values (
    p_user, p_delta, v_balance, p_event_type, p_reference_id, p_idempotency_key
  );
  return v_balance;
end;
$$;

create or replace function public.ensure_profile_wallet()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.player_wallets (user_id, balance)
  values (new.id, 100)
  on conflict (user_id) do nothing;

  if found then
    insert into public.coin_ledger (
      user_id, delta, balance_after, event_type, reference_id, idempotency_key
    ) values (
      new.id, 100, 100, 'initial_grant', new.id::text, 'initial_grant:' || new.id::text
    ) on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_create_wallet on public.profiles;
create trigger profiles_create_wallet
after insert on public.profiles
for each row execute function public.ensure_profile_wallet();

insert into public.player_wallets (user_id, balance)
select id, 100 from public.profiles
on conflict (user_id) do nothing;

insert into public.coin_ledger (
  user_id, delta, balance_after, event_type, reference_id, idempotency_key
)
select id, 100, 100, 'initial_grant', id::text, 'initial_grant:' || id::text
from public.profiles
on conflict (idempotency_key) do nothing;

create or replace function public.generate_redeem_code()
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
  for v_index in 0..11 loop
    v_code := v_code || substr(
      v_alphabet,
      (get_byte(extensions.gen_random_bytes(1), 0) % length(v_alphabet)) + 1,
      1
    );
  end loop;
  return v_code;
end;
$$;

create or replace function public.lock_online_stake(
  p_user uuid,
  p_game_id uuid,
  p_round integer,
  p_amount integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_amount = 0 then return; end if;
  if p_amount not in (10, 50, 100) then raise exception 'INVALID_WAGER'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'REGISTERED_ACCOUNT_REQUIRED';
  end if;
  perform public.apply_coin_delta(
    p_user,
    -p_amount,
    'wager_lock',
    p_game_id::text,
    'wager_lock:' || p_game_id::text || ':' || p_round::text || ':' || p_user::text
  );
end;
$$;

create or replace function public.settle_online_wager(
  p_game_id uuid,
  p_result text,
  p_winner uuid default null,
  p_finish_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.online_games;
  v_pot bigint;
begin
  select * into v_game from public.online_games where id = p_game_id for update;
  if not found or v_game.wager_amount = 0 or v_game.wager_settled_at is not null then return; end if;

  if p_result in ('x_win', 'o_win') then
    if p_winner is null then raise exception 'WAGER_WINNER_REQUIRED'; end if;
    v_pot := v_game.wager_amount
      * ((case when v_game.x_stake_locked then 1 else 0 end)
      + (case when v_game.o_stake_locked then 1 else 0 end));
    if v_pot > 0 then
      perform public.apply_coin_delta(
        p_winner,
        v_pot,
        'wager_payout',
        p_game_id::text,
        'wager_payout:' || p_game_id::text || ':' || v_game.round::text || ':' || p_winner::text
      );
    end if;
  elsif p_result in ('draw', 'cancelled', 'expired') then
    if v_game.x_stake_locked then
      perform public.apply_coin_delta(
        v_game.x_player,
        v_game.wager_amount,
        'wager_refund',
        p_game_id::text,
        'wager_refund:' || p_game_id::text || ':' || v_game.round::text || ':' || v_game.x_player::text
      );
    end if;
    if v_game.o_stake_locked and v_game.o_player is not null then
      perform public.apply_coin_delta(
        v_game.o_player,
        v_game.wager_amount,
        'wager_refund',
        p_game_id::text,
        'wager_refund:' || p_game_id::text || ':' || v_game.round::text || ':' || v_game.o_player::text
      );
    end if;
  else
    raise exception 'INVALID_WAGER_RESULT';
  end if;

  update public.online_games
  set x_stake_locked = false,
      o_stake_locked = false,
      wager_settled_at = now(),
      finish_reason = coalesce(p_finish_reason, finish_reason)
  where id = p_game_id;
end;
$$;

create or replace function public.settle_online_game_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_winner uuid;
begin
  if old.status = 'playing' and new.status in ('x_win', 'o_win', 'draw') then
    v_winner := case
      when new.status = 'x_win' then new.x_player
      when new.status = 'o_win' then new.o_player
      else null
    end;
    perform public.settle_online_wager(
      new.id,
      new.status,
      v_winner,
      coalesce(new.finish_reason, case when new.status = 'draw' then 'draw' else 'normal' end)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists online_game_settle_wager on public.online_games;
create trigger online_game_settle_wager
after update of status on public.online_games
for each row execute function public.settle_online_game_trigger();

create or replace function public.refund_expired_online_wagers(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_game public.online_games;
begin
  for v_game in
    select * from public.online_games
    where expires_at < now()
      and wager_amount > 0
      and wager_settled_at is null
      and (x_player = p_user or o_player = p_user)
    for update
  loop
    perform public.settle_online_wager(v_game.id, 'expired', null, 'expired');
    if v_game.status = 'waiting' then
      delete from public.online_games where id = v_game.id;
    else
      update public.online_games
      set status = 'abandoned', finish_reason = 'expired', version = version + 1
      where id = v_game.id;
    end if;
  end loop;
end;
$$;

create or replace function public.get_economy_snapshot()
returns table (balance bigint, is_admin boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'REGISTERED_ACCOUNT_REQUIRED';
  end if;
  perform public.refund_expired_online_wagers(v_user);
  return query
  select wallet.balance, public.is_economy_admin(v_user)
  from public.player_wallets wallet
  where wallet.user_id = v_user;
end;
$$;

create or replace function public.redeem_coin_code(p_code text)
returns table (granted_amount bigint, balance bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_normalized text := upper(regexp_replace(trim(coalesce(p_code, '')), '[[:space:]-]', '', 'g'));
  v_code public.redeem_codes;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'REGISTERED_ACCOUNT_REQUIRED';
  end if;
  if char_length(v_normalized) <> 12 or v_normalized !~ '^[A-HJ-NP-Z2-9]+$' then
    raise exception 'CODE_NOT_FOUND';
  end if;

  select * into v_code
  from public.redeem_codes
  where code_digest = encode(extensions.digest(v_normalized, 'sha256'), 'hex')
  for update;
  if not found then raise exception 'CODE_NOT_FOUND'; end if;
  if not v_code.is_active then raise exception 'CODE_DISABLED'; end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then raise exception 'CODE_EXPIRED'; end if;
  if v_code.claim_count >= v_code.max_claims then raise exception 'CODE_EXHAUSTED'; end if;
  if exists (
    select 1 from public.redeem_claims where code_id = v_code.id and user_id = v_user
  ) then raise exception 'CODE_ALREADY_REDEEMED'; end if;

  insert into public.redeem_claims (code_id, user_id, amount)
  values (v_code.id, v_user, v_code.amount);
  update public.redeem_codes set claim_count = claim_count + 1 where id = v_code.id;
  granted_amount := v_code.amount;
  balance := public.apply_coin_delta(
    v_user,
    v_code.amount,
    'redeem_code',
    v_code.id::text,
    'redeem:' || v_code.id::text || ':' || v_user::text
  );
  return next;
end;
$$;

create or replace function public.create_redeem_code(
  p_amount integer,
  p_max_claims integer,
  p_expires_at timestamptz default null
)
returns table (id uuid, code text, amount bigint, max_claims integer, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_raw text;
  v_id uuid;
  v_attempt integer;
begin
  if not public.is_economy_admin(v_user) then raise exception 'ADMIN_REQUIRED'; end if;
  if p_amount not between 1 and 1000000 then raise exception 'INVALID_CODE_AMOUNT'; end if;
  if p_max_claims not between 1 and 100000 then raise exception 'INVALID_CODE_LIMIT'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'INVALID_CODE_EXPIRY'; end if;

  for v_attempt in 1..20 loop
    begin
      v_raw := public.generate_redeem_code();
      insert into public.redeem_codes (
        code_digest, code_hint, amount, max_claims, expires_at, created_by
      ) values (
        encode(extensions.digest(v_raw, 'sha256'), 'hex'),
        substr(v_raw, 1, 4) || '-****-' || substr(v_raw, 9, 4),
        p_amount,
        p_max_claims,
        p_expires_at,
        v_user
      ) returning redeem_codes.id into v_id;
      id := v_id;
      code := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4);
      amount := p_amount;
      max_claims := p_max_claims;
      expires_at := p_expires_at;
      return next;
      return;
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception 'CODE_GENERATION_FAILED';
end;
$$;

create or replace function public.list_redeem_codes()
returns table (
  id uuid,
  code_hint text,
  amount bigint,
  max_claims integer,
  claim_count integer,
  expires_at timestamptz,
  is_active boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_economy_admin(auth.uid()) then raise exception 'ADMIN_REQUIRED'; end if;
  return query
  select code.id, code.code_hint, code.amount, code.max_claims, code.claim_count,
    code.expires_at, code.is_active, code.created_at
  from public.redeem_codes code
  order by code.created_at desc
  limit 100;
end;
$$;

create or replace function public.disable_redeem_code(p_code_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_economy_admin(auth.uid()) then raise exception 'ADMIN_REQUIRED'; end if;
  update public.redeem_codes set is_active = false where id = p_code_id;
end;
$$;

drop function if exists public.create_online_game(text);
drop function if exists public.create_online_game(text, text);
drop function if exists public.join_online_game(text, text);
create or replace function public.create_online_game(
  p_game_type text,
  p_guest_name text,
  p_wager_amount integer default 0
)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_player_name text := public.resolve_online_player_name(p_guest_name);
  v_game public.online_games;
  v_attempt integer;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_game_type not in ('tic_tac_toe', 'gomoku') then raise exception 'INVALID_GAME_TYPE'; end if;
  if p_wager_amount not in (0, 10, 50, 100) then raise exception 'INVALID_WAGER'; end if;
  if p_wager_amount > 0 and not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'REGISTERED_ACCOUNT_REQUIRED';
  end if;
  perform public.refund_expired_online_wagers(v_user);

  select * into v_game
  from public.online_games
  where x_player = v_user and o_player is null and status = 'waiting' and game_type = p_game_type
  order by created_at desc limit 1 for update;
  if found and v_game.expires_at >= now() and v_game.wager_amount = p_wager_amount then
    update public.online_games
    set x_player_name = v_player_name, x_last_seen_at = now(), updated_at = now(),
      expires_at = now() + interval '24 hours'
    where id = v_game.id returning * into v_game;
    return next v_game;
    return;
  elsif found then
    perform public.settle_online_wager(v_game.id, 'cancelled', null, 'cancelled');
    delete from public.online_games where id = v_game.id;
  end if;

  for v_attempt in 1..20 loop
    begin
      insert into public.online_games (
        room_code, game_type, x_player, x_player_name, board, wager_amount, x_last_seen_at
      ) values (
        public.generate_online_room_code(), p_game_type, v_user, v_player_name,
        public.online_empty_board(p_game_type), p_wager_amount, now()
      ) returning * into v_game;
      perform public.lock_online_stake(v_user, v_game.id, v_game.round, p_wager_amount);
      if p_wager_amount > 0 then
        update public.online_games set x_stake_locked = true where id = v_game.id returning * into v_game;
      end if;
      return next v_game;
      return;
    exception when unique_violation then
      null;
    end;
  end loop;
  raise exception 'ROOM_CODE_UNAVAILABLE';
end;
$$;

create or replace function public.preview_online_game(p_room_code text, p_game_type text)
returns table (game_type text, host_name text, wager_amount integer, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := upper(trim(p_room_code));
  v_game public.online_games;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_code) <> 6 or v_code !~ '^[A-HJ-NP-Z2-9]+$' then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  select * into v_game from public.online_games where room_code = v_code for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.game_type <> p_game_type then raise exception 'ROOM_GAME_MISMATCH'; end if;
  if v_game.expires_at < now() then
    perform public.settle_online_wager(v_game.id, 'expired', null, 'expired');
    delete from public.online_games where id = v_game.id;
    raise exception 'ROOM_EXPIRED';
  end if;
  if v_game.status <> 'waiting' or v_game.o_player is not null then raise exception 'ROOM_FULL'; end if;
  game_type := v_game.game_type;
  host_name := v_game.x_player_name;
  wager_amount := v_game.wager_amount;
  status := v_game.status;
  return next;
end;
$$;

create or replace function public.join_online_game(p_room_code text, p_game_type text, p_guest_name text)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_player_name text := public.resolve_online_player_name(p_guest_name);
  v_code text := upper(trim(p_room_code));
  v_game public.online_games;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(v_code) <> 6 or v_code !~ '^[A-HJ-NP-Z2-9]+$' then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if p_game_type not in ('tic_tac_toe', 'gomoku') then raise exception 'INVALID_GAME_TYPE'; end if;

  select * into v_game from public.online_games where room_code = v_code for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.game_type <> p_game_type then raise exception 'ROOM_GAME_MISMATCH'; end if;
  if v_game.expires_at < now() then
    perform public.settle_online_wager(v_game.id, 'expired', null, 'expired');
    delete from public.online_games where id = v_game.id;
    raise exception 'ROOM_EXPIRED';
  end if;

  if v_game.x_player = v_user or v_game.o_player = v_user then
    update public.online_games
    set x_last_seen_at = case when x_player = v_user then now() else x_last_seen_at end,
        o_last_seen_at = case when o_player = v_user then now() else o_last_seen_at end,
        expires_at = now() + interval '24 hours', updated_at = now()
    where id = v_game.id returning * into v_game;
    return next v_game;
    return;
  end if;
  if v_game.o_player is not null or v_game.status <> 'waiting' then raise exception 'ROOM_FULL'; end if;
  if v_game.wager_amount > 0 and not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'REGISTERED_ACCOUNT_REQUIRED';
  end if;

  perform public.lock_online_stake(v_user, v_game.id, v_game.round, v_game.wager_amount);
  update public.online_games
  set o_player = v_user,
      o_player_name = v_player_name,
      o_stake_locked = wager_amount > 0,
      o_last_seen_at = now(),
      status = 'playing',
      updated_at = now(),
      expires_at = now() + interval '24 hours',
      version = version + 1
  where id = v_game.id returning * into v_game;
  return next v_game;
end;
$$;

create or replace function public.heartbeat_online_game(p_game_id uuid)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
begin
  update public.online_games
  set x_last_seen_at = case when x_player = v_user then now() else x_last_seen_at end,
      o_last_seen_at = case when o_player = v_user then now() else o_last_seen_at end,
      updated_at = now()
  where id = p_game_id and (x_player = v_user or o_player = v_user)
  returning * into v_game;
  if not found then raise exception 'NOT_A_PLAYER'; end if;
  return next v_game;
end;
$$;

create or replace function public.claim_online_disconnect(p_game_id uuid)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
  v_winner_mark text;
  v_opponent_seen timestamptz;
begin
  select * into v_game from public.online_games where id = p_game_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.status <> 'playing' then raise exception 'GAME_NOT_PLAYING'; end if;
  if v_game.x_player = v_user then
    v_winner_mark := 'X';
    v_opponent_seen := coalesce(v_game.o_last_seen_at, v_game.created_at);
  elsif v_game.o_player = v_user then
    v_winner_mark := 'O';
    v_opponent_seen := coalesce(v_game.x_last_seen_at, v_game.created_at);
  else
    raise exception 'NOT_A_PLAYER';
  end if;
  if v_opponent_seen > now() - interval '30 seconds' then raise exception 'OPPONENT_STILL_ONLINE'; end if;

  update public.online_games
  set status = lower(v_winner_mark) || '_win',
      current_mark = v_winner_mark,
      x_score = x_score + case when v_winner_mark = 'X' then 1 else 0 end,
      o_score = o_score + case when v_winner_mark = 'O' then 1 else 0 end,
      finish_reason = 'disconnect',
      updated_at = now(),
      expires_at = now() + interval '1 hour',
      version = version + 1
  where id = v_game.id returning * into v_game;
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
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_game from public.online_games where id = p_game_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.status not in ('x_win', 'o_win', 'draw') then raise exception 'GAME_NOT_FINISHED'; end if;

  v_x_ready := v_game.x_rematch;
  v_o_ready := v_game.o_rematch;
  if v_game.x_player = v_user then v_x_ready := true;
  elsif v_game.o_player = v_user then v_o_ready := true;
  else raise exception 'NOT_A_PLAYER';
  end if;

  if v_x_ready and v_o_ready then
    perform public.lock_online_stake(v_game.x_player, v_game.id, v_game.round + 1, v_game.wager_amount);
    perform public.lock_online_stake(v_game.o_player, v_game.id, v_game.round + 1, v_game.wager_amount);
    update public.online_games
    set board = public.online_empty_board(game_type),
        x_order = '{}'::smallint[], o_order = '{}'::smallint[], move_history = '{}'::smallint[],
        current_mark = 'X', status = 'playing', winning_line = '{}'::smallint[],
        round = round + 1, x_rematch = false, o_rematch = false,
        x_undos_remaining = 3, o_undos_remaining = 3,
        undo_request_mark = null, undo_requested_at = null, undo_expires_at = null,
        x_stake_locked = wager_amount > 0, o_stake_locked = wager_amount > 0,
        wager_settled_at = null, finish_reason = null,
        x_last_seen_at = now(), o_last_seen_at = now(),
        updated_at = now(), expires_at = now() + interval '24 hours', version = version + 1
    where id = v_game.id returning * into v_game;
  else
    update public.online_games
    set x_rematch = v_x_ready, o_rematch = v_o_ready,
        updated_at = now(), expires_at = now() + interval '24 hours', version = version + 1
    where id = v_game.id returning * into v_game;
  end if;
  return next v_game;
end;
$$;

create or replace function public.decline_online_rematch(p_game_id uuid)
returns setof public.online_games
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_game
  from public.online_games
  where id = p_game_id
  for update;

  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_game.x_player <> v_user and v_game.o_player is distinct from v_user then
    raise exception 'NOT_A_PLAYER';
  end if;
  if v_game.status not in ('x_win', 'o_win', 'draw') then
    raise exception 'GAME_NOT_FINISHED';
  end if;

  if v_game.x_player = v_user then
    if not v_game.o_rematch or v_game.x_rematch then
      raise exception 'REMATCH_NOT_PENDING';
    end if;
    update public.online_games
    set o_rematch = false,
        updated_at = now(),
        version = version + 1
    where id = v_game.id
    returning * into v_game;
  elsif v_game.o_player = v_user then
    if not v_game.x_rematch or v_game.o_rematch then
      raise exception 'REMATCH_NOT_PENDING';
    end if;
    update public.online_games
    set x_rematch = false,
        updated_at = now(),
        version = version + 1
    where id = v_game.id
    returning * into v_game;
  end if;

  return next v_game;
end;
$$;

revoke execute on function public.decline_online_rematch(uuid) from public, anon;
grant execute on function public.decline_online_rematch(uuid) to authenticated;

create or replace function public.leave_online_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
  v_winner_mark text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_game from public.online_games where id = p_game_id for update;
  if not found then return; end if;
  if v_game.x_player <> v_user and v_game.o_player is distinct from v_user then raise exception 'NOT_A_PLAYER'; end if;
  if v_game.o_player is null then
    perform public.settle_online_wager(v_game.id, 'cancelled', null, 'cancelled');
    delete from public.online_games where id = v_game.id;
    return;
  end if;
  if v_game.status = 'playing' and v_game.wager_amount > 0 then
    v_winner_mark := case when v_game.x_player = v_user then 'O' else 'X' end;
    update public.online_games
    set status = lower(v_winner_mark) || '_win',
        current_mark = v_winner_mark,
        x_score = x_score + case when v_winner_mark = 'X' then 1 else 0 end,
        o_score = o_score + case when v_winner_mark = 'O' then 1 else 0 end,
        finish_reason = 'active_exit',
        undo_request_mark = null, undo_requested_at = null, undo_expires_at = null,
        updated_at = now(), expires_at = now() + interval '1 hour', version = version + 1
    where id = v_game.id;
    return;
  end if;
  if v_game.status = 'playing' then
    update public.online_games
    set status = 'abandoned', undo_request_mark = null, undo_requested_at = null,
        undo_expires_at = null, updated_at = now(), expires_at = now() + interval '1 hour',
        version = version + 1
    where id = v_game.id;
  end if;
end;
$$;

revoke all on function public.is_economy_admin(uuid) from public;
revoke all on function public.apply_coin_delta(uuid, bigint, text, text, text) from public;
revoke all on function public.lock_online_stake(uuid, uuid, integer, integer) from public;
revoke all on function public.settle_online_wager(uuid, text, uuid, text) from public;
revoke all on function public.refund_expired_online_wagers(uuid) from public;

revoke execute on function public.get_economy_snapshot() from public, anon;
revoke execute on function public.redeem_coin_code(text) from public, anon;
revoke execute on function public.create_redeem_code(integer, integer, timestamptz) from public, anon;
revoke execute on function public.list_redeem_codes() from public, anon;
revoke execute on function public.disable_redeem_code(uuid) from public, anon;
revoke execute on function public.create_online_game(text, text, integer) from public, anon;
revoke execute on function public.preview_online_game(text, text) from public, anon;
revoke execute on function public.join_online_game(text, text, text) from public, anon;
revoke execute on function public.heartbeat_online_game(uuid) from public, anon;
revoke execute on function public.claim_online_disconnect(uuid) from public, anon;
revoke execute on function public.request_online_rematch(uuid) from public, anon;
revoke execute on function public.leave_online_game(uuid) from public, anon;

grant execute on function public.get_economy_snapshot() to authenticated;
grant execute on function public.redeem_coin_code(text) to authenticated;
grant execute on function public.create_redeem_code(integer, integer, timestamptz) to authenticated;
grant execute on function public.list_redeem_codes() to authenticated;
grant execute on function public.disable_redeem_code(uuid) to authenticated;
grant execute on function public.create_online_game(text, text, integer) to authenticated;
grant execute on function public.preview_online_game(text, text) to authenticated;
grant execute on function public.join_online_game(text, text, text) to authenticated;
grant execute on function public.heartbeat_online_game(uuid) to authenticated;
grant execute on function public.claim_online_disconnect(uuid) to authenticated;
grant execute on function public.request_online_rematch(uuid) to authenticated;
grant execute on function public.leave_online_game(uuid) to authenticated;

create table if not exists public.competitive_seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (
    char_length(btrim(name)) between 1 and 40
    and name !~ '[[:cntrl:]]'
  ),
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (
    (status = 'active' and ended_at is null)
    or (status = 'ended' and ended_at is not null)
  )
);

create unique index if not exists competitive_seasons_name_lower_idx
on public.competitive_seasons (lower(name));

create unique index if not exists competitive_seasons_one_active_idx
on public.competitive_seasons ((status))
where status = 'active';

alter table public.online_games
  add column if not exists round_season_id uuid references public.competitive_seasons(id) on delete set null;
alter table public.online_games
  add column if not exists x_registered_for_round boolean not null default false;
alter table public.online_games
  add column if not exists o_registered_for_round boolean not null default false;

create table if not exists public.online_match_results (
  id uuid primary key default gen_random_uuid(),
  online_game_id uuid not null,
  round integer not null check (round >= 1),
  game_type text not null check (game_type in ('tic_tac_toe', 'gomoku')),
  x_player uuid not null,
  o_player uuid not null,
  x_player_name text not null,
  o_player_name text not null,
  x_registered boolean not null,
  o_registered boolean not null,
  result text not null check (result in ('x_win', 'o_win', 'draw')),
  winner_player uuid,
  finish_reason text not null,
  wager_amount integer not null default 0 check (wager_amount >= 0),
  season_id uuid references public.competitive_seasons(id) on delete set null,
  x_points_awarded smallint check (x_points_awarded in (0, 1, 3)),
  o_points_awarded smallint check (o_points_awarded in (0, 1, 3)),
  finished_at timestamptz not null default now(),
  unique (online_game_id, round),
  check (
    (season_id is null and x_points_awarded is null and o_points_awarded is null)
    or (season_id is not null and x_points_awarded is not null and o_points_awarded is not null)
  )
);

create index if not exists online_match_results_x_player_finished_idx
on public.online_match_results (x_player, finished_at desc, id desc);

create index if not exists online_match_results_o_player_finished_idx
on public.online_match_results (o_player, finished_at desc, id desc);

create table if not exists public.season_standings (
  season_id uuid not null references public.competitive_seasons(id) on delete cascade,
  game_type text not null check (game_type in ('tic_tac_toe', 'gomoku')),
  player_id uuid not null references public.profiles(id) on delete cascade,
  points integer not null default 0 check (points >= 0),
  wins integer not null default 0 check (wins >= 0),
  draws integer not null default 0 check (draws >= 0),
  losses integer not null default 0 check (losses >= 0),
  last_scored_at timestamptz not null default now(),
  primary key (season_id, game_type, player_id)
);

alter table public.competitive_seasons enable row level security;
alter table public.online_match_results enable row level security;
alter table public.season_standings enable row level security;

revoke all on table public.competitive_seasons from public, anon, authenticated;
revoke all on table public.online_match_results from public, anon, authenticated;
revoke all on table public.season_standings from public, anon, authenticated;

create or replace function public.assign_online_round_context()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'playing'
    and (old.status is distinct from 'playing' or new.round is distinct from old.round)
  then
    select exists (
      select 1 from public.profiles where id = new.x_player
    ) into new.x_registered_for_round;

    select new.o_player is not null and exists (
      select 1 from public.profiles where id = new.o_player
    ) into new.o_registered_for_round;

    new.round_season_id := null;
    if new.x_registered_for_round and new.o_registered_for_round then
      select season.id into new.round_season_id
      from public.competitive_seasons season
      where season.status = 'active'
      order by season.started_at desc
      limit 1;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists online_game_assign_round_context on public.online_games;
create trigger online_game_assign_round_context
before update of status, round on public.online_games
for each row execute function public.assign_online_round_context();

create or replace function public.record_online_round_result()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result_id uuid;
  v_x_points smallint;
  v_o_points smallint;
  v_finished_at timestamptz := now();
begin
  if old.status = 'playing'
    and new.status in ('x_win', 'o_win', 'draw')
    and (new.x_registered_for_round or new.o_registered_for_round)
  then
    if new.round_season_id is not null then
      v_x_points := case
        when new.status = 'draw' then 1
        when new.status = 'x_win' then 3
        else 0
      end;
      v_o_points := case
        when new.status = 'draw' then 1
        when new.status = 'o_win' then 3
        else 0
      end;
    end if;

    insert into public.online_match_results (
      online_game_id, round, game_type,
      x_player, o_player, x_player_name, o_player_name,
      x_registered, o_registered, result, winner_player,
      finish_reason, wager_amount, season_id,
      x_points_awarded, o_points_awarded, finished_at
    ) values (
      new.id, new.round, new.game_type,
      new.x_player, new.o_player, new.x_player_name, new.o_player_name,
      new.x_registered_for_round, new.o_registered_for_round, new.status,
      case
        when new.status = 'x_win' then new.x_player
        when new.status = 'o_win' then new.o_player
        else null
      end,
      coalesce(new.finish_reason, case when new.status = 'draw' then 'draw' else 'normal' end),
      new.wager_amount, new.round_season_id,
      v_x_points, v_o_points, v_finished_at
    )
    on conflict (online_game_id, round) do nothing
    returning id into v_result_id;

    if v_result_id is null or new.round_season_id is null then
      return new;
    end if;

    insert into public.season_standings (
      season_id, game_type, player_id, points, wins, draws, losses, last_scored_at
    ) values (
      new.round_season_id,
      new.game_type,
      new.x_player,
      v_x_points,
      case when new.status = 'x_win' then 1 else 0 end,
      case when new.status = 'draw' then 1 else 0 end,
      case when new.status = 'o_win' then 1 else 0 end,
      v_finished_at
    )
    on conflict (season_id, game_type, player_id) do update
    set points = public.season_standings.points + excluded.points,
        wins = public.season_standings.wins + excluded.wins,
        draws = public.season_standings.draws + excluded.draws,
        losses = public.season_standings.losses + excluded.losses,
        last_scored_at = excluded.last_scored_at;

    insert into public.season_standings (
      season_id, game_type, player_id, points, wins, draws, losses, last_scored_at
    ) values (
      new.round_season_id,
      new.game_type,
      new.o_player,
      v_o_points,
      case when new.status = 'o_win' then 1 else 0 end,
      case when new.status = 'draw' then 1 else 0 end,
      case when new.status = 'x_win' then 1 else 0 end,
      v_finished_at
    )
    on conflict (season_id, game_type, player_id) do update
    set points = public.season_standings.points + excluded.points,
        wins = public.season_standings.wins + excluded.wins,
        draws = public.season_standings.draws + excluded.draws,
        losses = public.season_standings.losses + excluded.losses,
        last_scored_at = excluded.last_scored_at;
  end if;
  return new;
end;
$$;

drop trigger if exists online_game_record_round_result on public.online_games;
create trigger online_game_record_round_result
after update of status on public.online_games
for each row execute function public.record_online_round_result();

create or replace function public.list_competitive_seasons()
returns table (
  id uuid,
  name text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  is_current boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    season.id,
    season.name,
    season.status,
    season.started_at,
    season.ended_at,
    season.status = 'active' as is_current
  from public.competitive_seasons season
  order by (season.status = 'active') desc, season.started_at desc;
$$;

create or replace function public.get_my_match_history(
  p_game_type text default null,
  p_before_finished_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  game_type text,
  opponent_name text,
  result text,
  finish_reason text,
  wager_amount integer,
  coin_delta integer,
  points_awarded smallint,
  season_id uuid,
  season_name text,
  finished_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'REGISTERED_ACCOUNT_REQUIRED';
  end if;
  if p_game_type is not null and p_game_type not in ('tic_tac_toe', 'gomoku') then
    raise exception 'INVALID_GAME_TYPE';
  end if;
  if (p_before_finished_at is null) <> (p_before_id is null) then
    raise exception 'INVALID_CURSOR';
  end if;

  return query
  select
    match.id,
    match.game_type,
    case when match.x_player = v_user then match.o_player_name else match.x_player_name end,
    case
      when match.result = 'draw' then 'draw'
      when match.winner_player = v_user then 'win'
      else 'loss'
    end,
    match.finish_reason,
    match.wager_amount,
    case
      when match.result = 'draw' or match.wager_amount = 0 then 0
      when match.winner_player = v_user then match.wager_amount
      else -match.wager_amount
    end,
    case when match.x_player = v_user then match.x_points_awarded else match.o_points_awarded end,
    match.season_id,
    season.name,
    match.finished_at
  from public.online_match_results match
  left join public.competitive_seasons season on season.id = match.season_id
  where (
      (match.x_player = v_user and match.x_registered)
      or (match.o_player = v_user and match.o_registered)
    )
    and (p_game_type is null or match.game_type = p_game_type)
    and (
      p_before_finished_at is null
      or (match.finished_at, match.id) < (p_before_finished_at, p_before_id)
    )
  order by match.finished_at desc, match.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

create or replace function public.get_my_standings(p_season_id uuid default null)
returns table (
  season_id uuid,
  game_type text,
  rank bigint,
  points integer,
  wins integer,
  draws integer,
  losses integer,
  games integer,
  win_rate numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_season uuid := p_season_id;
begin
  if v_user is null or not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'REGISTERED_ACCOUNT_REQUIRED';
  end if;
  if v_season is null then
    select season.id into v_season
    from public.competitive_seasons season
    order by (season.status = 'active') desc, season.started_at desc
    limit 1;
  end if;
  if v_season is null then return; end if;

  return query
  with ranked as (
    select
      standing.*,
      dense_rank() over (
        partition by standing.game_type
        order by standing.points desc, standing.wins desc, standing.losses asc
      ) as standing_rank
    from public.season_standings standing
    where standing.season_id = v_season
  )
  select
    ranked.season_id,
    ranked.game_type,
    ranked.standing_rank,
    ranked.points,
    ranked.wins,
    ranked.draws,
    ranked.losses,
    ranked.wins + ranked.draws + ranked.losses,
    coalesce(round(
      ranked.wins::numeric * 100
      / nullif(ranked.wins + ranked.draws + ranked.losses, 0),
      1
    ), 0)
  from ranked
  where ranked.player_id = v_user
  order by ranked.game_type;
end;
$$;

create or replace function public.get_competitive_leaderboard(
  p_season_id uuid,
  p_game_type text,
  p_limit integer default 100
)
returns table (
  rank bigint,
  player_id uuid,
  display_name text,
  points integer,
  wins integer,
  draws integer,
  losses integer,
  games integer,
  win_rate numeric,
  is_current_player boolean,
  is_top_entry boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
begin
  if p_game_type not in ('tic_tac_toe', 'gomoku') then
    raise exception 'INVALID_GAME_TYPE';
  end if;
  if not exists (select 1 from public.competitive_seasons where id = p_season_id) then
    raise exception 'SEASON_NOT_FOUND';
  end if;

  return query
  with ranked as (
    select
      standing.*,
      dense_rank() over (
        order by standing.points desc, standing.wins desc, standing.losses asc
      ) as standing_rank,
      row_number() over (
        order by standing.points desc, standing.wins desc, standing.losses asc,
          standing.last_scored_at asc, standing.player_id
      ) as position
    from public.season_standings standing
    where standing.season_id = p_season_id
      and standing.game_type = p_game_type
  )
  select
    ranked.standing_rank,
    ranked.player_id,
    profile.game_name,
    ranked.points,
    ranked.wins,
    ranked.draws,
    ranked.losses,
    ranked.wins + ranked.draws + ranked.losses,
    coalesce(round(
      ranked.wins::numeric * 100
      / nullif(ranked.wins + ranked.draws + ranked.losses, 0),
      1
    ), 0),
    ranked.player_id = v_user as is_current_player,
    ranked.position <= v_limit as is_top_entry
  from ranked
  join public.profiles profile on profile.id = ranked.player_id
  where ranked.position <= v_limit or ranked.player_id = v_user
  order by (ranked.position <= v_limit) desc, ranked.position;
end;
$$;

create or replace function public.start_competitive_season(p_name text)
returns table (
  id uuid,
  name text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  is_current boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_season public.competitive_seasons;
begin
  if v_user is null or not public.is_economy_admin(auth.uid()) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if char_length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    raise exception 'INVALID_SEASON_NAME';
  end if;
  if exists (select 1 from public.competitive_seasons where status = 'active') then
    raise exception 'ACTIVE_SEASON_EXISTS';
  end if;

  begin
    insert into public.competitive_seasons (name, status, created_by)
    values (v_name, 'active', v_user)
    returning * into v_season;
  exception when unique_violation then
    if exists (select 1 from public.competitive_seasons where status = 'active') then
      raise exception 'ACTIVE_SEASON_EXISTS';
    end if;
    raise exception 'SEASON_NAME_EXISTS';
  end;

  id := v_season.id;
  name := v_season.name;
  status := v_season.status;
  started_at := v_season.started_at;
  ended_at := v_season.ended_at;
  is_current := true;
  return next;
end;
$$;

create or replace function public.end_competitive_season(p_season_id uuid)
returns table (
  id uuid,
  name text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  is_current boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_season public.competitive_seasons;
begin
  if v_user is null or not public.is_economy_admin(auth.uid()) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  update public.competitive_seasons
  set status = 'ended', ended_at = now()
  where competitive_seasons.id = p_season_id and competitive_seasons.status = 'active'
  returning * into v_season;
  if not found then raise exception 'SEASON_NOT_ACTIVE'; end if;

  id := v_season.id;
  name := v_season.name;
  status := v_season.status;
  started_at := v_season.started_at;
  ended_at := v_season.ended_at;
  is_current := false;
  return next;
end;
$$;

create or replace function public.leave_online_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_game public.online_games;
  v_winner_mark text;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_game from public.online_games where id = p_game_id for update;
  if not found then return; end if;
  if v_game.x_player <> v_user and v_game.o_player is distinct from v_user then
    raise exception 'NOT_A_PLAYER';
  end if;
  if v_game.o_player is null then
    perform public.settle_online_wager(v_game.id, 'cancelled', null, 'cancelled');
    delete from public.online_games where id = v_game.id;
    return;
  end if;
  if v_game.status = 'playing' then
    v_winner_mark := case when v_game.x_player = v_user then 'O' else 'X' end;
    update public.online_games
    set status = lower(v_winner_mark) || '_win',
        current_mark = v_winner_mark,
        x_score = x_score + case when v_winner_mark = 'X' then 1 else 0 end,
        o_score = o_score + case when v_winner_mark = 'O' then 1 else 0 end,
        finish_reason = 'active_exit',
        undo_request_mark = null,
        undo_requested_at = null,
        undo_expires_at = null,
        updated_at = now(),
        expires_at = now() + interval '1 hour',
        version = version + 1
    where id = v_game.id;
  end if;
end;
$$;

revoke all on function public.assign_online_round_context() from public, anon, authenticated;
revoke all on function public.record_online_round_result() from public, anon, authenticated;

revoke execute on function public.list_competitive_seasons() from public, anon, authenticated;
revoke execute on function public.get_my_match_history(text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke execute on function public.get_my_standings(uuid) from public, anon, authenticated;
revoke execute on function public.get_competitive_leaderboard(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.start_competitive_season(text) from public, anon, authenticated;
revoke execute on function public.end_competitive_season(uuid) from public, anon, authenticated;
revoke execute on function public.leave_online_game(uuid) from public, anon;

grant execute on function public.list_competitive_seasons() to anon, authenticated;
grant execute on function public.get_my_match_history(text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_my_standings(uuid) to authenticated;
grant execute on function public.get_competitive_leaderboard(uuid, text, integer) to anon, authenticated;
grant execute on function public.start_competitive_season(text) to authenticated;
grant execute on function public.end_competitive_season(uuid) to authenticated;
grant execute on function public.leave_online_game(uuid) to authenticated;

create or replace function public.record_online_round_result()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result_id uuid;
  v_x_points smallint;
  v_o_points smallint;
  v_finished_at timestamptz := now();
begin
  if old.status = 'playing'
    and new.status in ('x_win', 'o_win', 'draw')
    and (new.x_registered_for_round or new.o_registered_for_round)
  then
    if new.round_season_id is not null then
      v_x_points := case
        when new.status = 'draw' then 1
        when new.status = 'x_win' then 3
        else 0
      end;
      v_o_points := case
        when new.status = 'draw' then 1
        when new.status = 'o_win' then 3
        else 0
      end;
    end if;

    insert into public.online_match_results (
      online_game_id, round, game_type,
      x_player, o_player, x_player_name, o_player_name,
      x_registered, o_registered, result, winner_player,
      finish_reason, wager_amount, season_id,
      x_points_awarded, o_points_awarded, finished_at
    ) values (
      new.id, new.round, new.game_type,
      new.x_player, new.o_player, new.x_player_name, new.o_player_name,
      new.x_registered_for_round, new.o_registered_for_round, new.status,
      case
        when new.status = 'x_win' then new.x_player
        when new.status = 'o_win' then new.o_player
        else null
      end,
      coalesce(new.finish_reason, case when new.status = 'draw' then 'draw' else 'normal' end),
      new.wager_amount, new.round_season_id,
      v_x_points, v_o_points, v_finished_at
    )
    on conflict (online_game_id, round) do nothing
    returning id into v_result_id;

    if v_result_id is null or new.round_season_id is null then
      return new;
    end if;

    insert into public.season_standings (
      season_id, game_type, player_id, points, wins, draws, losses, last_scored_at
    ) values (
      new.round_season_id,
      new.game_type,
      new.x_player,
      v_x_points,
      case when new.status = 'x_win' then 1 else 0 end,
      case when new.status = 'draw' then 1 else 0 end,
      case when new.status = 'o_win' then 1 else 0 end,
      v_finished_at
    )
    on conflict (season_id, game_type, player_id) do update
    set points = public.season_standings.points + excluded.points,
        wins = public.season_standings.wins + excluded.wins,
        draws = public.season_standings.draws + excluded.draws,
        losses = public.season_standings.losses + excluded.losses,
        last_scored_at = excluded.last_scored_at;

    insert into public.season_standings (
      season_id, game_type, player_id, points, wins, draws, losses, last_scored_at
    ) values (
      new.round_season_id,
      new.game_type,
      new.o_player,
      v_o_points,
      case when new.status = 'o_win' then 1 else 0 end,
      case when new.status = 'draw' then 1 else 0 end,
      case when new.status = 'x_win' then 1 else 0 end,
      v_finished_at
    )
    on conflict (season_id, game_type, player_id) do update
    set points = public.season_standings.points + excluded.points,
        wins = public.season_standings.wins + excluded.wins,
        draws = public.season_standings.draws + excluded.draws,
        losses = public.season_standings.losses + excluded.losses,
        last_scored_at = excluded.last_scored_at;
  end if;
  return new;
end;
$$;

create or replace function public.start_competitive_season(p_name text)
returns table (
  id uuid,
  name text,
  status text,
  started_at timestamptz,
  ended_at timestamptz,
  is_current boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_season public.competitive_seasons;
begin
  if v_user is null or not public.is_economy_admin(auth.uid()) then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if char_length(v_name) not between 1 and 40 or v_name ~ '[[:cntrl:]]' then
    raise exception 'INVALID_SEASON_NAME';
  end if;
  if exists (
    select 1
    from public.competitive_seasons season
    where season.status = 'active'
  ) then
    raise exception 'ACTIVE_SEASON_EXISTS';
  end if;

  begin
    insert into public.competitive_seasons (name, status, created_by)
    values (v_name, 'active', v_user)
    returning * into v_season;
  exception when unique_violation then
    if exists (
      select 1
      from public.competitive_seasons season
      where season.status = 'active'
    ) then
      raise exception 'ACTIVE_SEASON_EXISTS';
    end if;
    raise exception 'SEASON_NAME_EXISTS';
  end;

  id := v_season.id;
  name := v_season.name;
  status := v_season.status;
  started_at := v_season.started_at;
  ended_at := v_season.ended_at;
  is_current := true;
  return next;
end;
$$;
