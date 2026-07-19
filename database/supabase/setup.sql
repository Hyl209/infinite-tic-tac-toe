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

create or replace function public.reject_player_uid_username()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.username ~ '^[0-9]+$' and char_length(new.username) = 6 then
    raise exception 'PLAYER_UID_USERNAME_RESERVED';
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

drop trigger if exists profiles_reject_player_uid_username on public.profiles;
create trigger profiles_reject_player_uid_username
before insert or update of username on public.profiles
for each row execute function public.reject_player_uid_username();

revoke all on sequence public.player_uid_seq from public, anon, authenticated;
revoke execute on function public.format_player_uid(integer) from public, anon, authenticated;
revoke execute on function public.assign_player_uid() from public, anon, authenticated;
revoke execute on function public.prevent_player_uid_change() from public, anon, authenticated;
revoke execute on function public.reject_player_uid_username() from public, anon, authenticated;
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

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  title varchar(80) not null,
  body text not null,
  cover_url text,
  action_label varchar(30),
  action_url text,
  publish_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reward_amount bigint not null default 0,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_title_check check (
    title = btrim(title) and char_length(title) > 0
  ),
  constraint activities_body_check check (
    body = btrim(body) and char_length(body) > 0
  ),
  constraint activities_cover_url_check check (
    cover_url is null
    or (cover_url = btrim(cover_url) and char_length(cover_url) > 0)
  ),
  constraint activities_action_check check (
    (action_label is null and action_url is null)
    or (
      action_label is not null
      and action_label = btrim(action_label)
      and char_length(action_label) > 0
      and action_url is not null
      and action_url = btrim(action_url)
      and char_length(action_url) > 0
    )
  ),
  constraint activities_schedule_check check (
    publish_at <= starts_at and starts_at < ends_at
  ),
  constraint activities_reward_amount_check check (
    reward_amount between 0 and 1000000
  )
);

create table if not exists public.activity_claims (
  activity_id uuid not null
    references public.activities(id) on delete restrict,
  user_id uuid not null
    references public.profiles(id) on delete cascade,
  reward_amount bigint not null,
  claimed_at timestamptz not null default now(),
  primary key (activity_id, user_id),
  constraint activity_claims_reward_amount_check check (
    reward_amount between 0 and 1000000
  )
);

create table if not exists public.site_notifications (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid references public.activities(id) on delete restrict,
  title varchar(80) not null,
  body text not null,
  reward_amount bigint not null default 0,
  visible_at timestamptz not null,
  expires_at timestamptz,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_notifications_title_check check (
    title = btrim(title) and char_length(title) > 0
  ),
  constraint site_notifications_body_check check (
    body = btrim(body) and char_length(body) > 0
  ),
  constraint site_notifications_reward_amount_check check (
    reward_amount between 0 and 1000000
  ),
  constraint site_notifications_expiry_check check (
    expires_at is null or expires_at > visible_at
  ),
  constraint site_notifications_activity_reward_check check (
    activity_id is null or reward_amount = 0
  )
);

create table if not exists public.notification_reads (
  notification_id uuid not null
    references public.site_notifications(id) on delete cascade,
  user_id uuid not null
    references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create table if not exists public.notification_claims (
  notification_id uuid not null
    references public.site_notifications(id) on delete restrict,
  user_id uuid not null
    references public.profiles(id) on delete cascade,
  reward_amount bigint not null,
  claimed_at timestamptz not null default now(),
  primary key (notification_id, user_id),
  constraint notification_claims_reward_amount_check check (
    reward_amount between 0 and 1000000
  )
);

create table if not exists public.checkin_rule_versions (
  id bigint generated by default as identity primary key,
  effective_from date not null unique,
  monday_reward bigint not null,
  tuesday_reward bigint not null,
  wednesday_reward bigint not null,
  thursday_reward bigint not null,
  friday_reward bigint not null,
  saturday_reward bigint not null,
  sunday_reward bigint not null,
  makeup_cost bigint not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint checkin_rule_versions_monday_reward_check check (
    monday_reward between 0 and 1000000
  ),
  constraint checkin_rule_versions_tuesday_reward_check check (
    tuesday_reward between 0 and 1000000
  ),
  constraint checkin_rule_versions_wednesday_reward_check check (
    wednesday_reward between 0 and 1000000
  ),
  constraint checkin_rule_versions_thursday_reward_check check (
    thursday_reward between 0 and 1000000
  ),
  constraint checkin_rule_versions_friday_reward_check check (
    friday_reward between 0 and 1000000
  ),
  constraint checkin_rule_versions_saturday_reward_check check (
    saturday_reward between 0 and 1000000
  ),
  constraint checkin_rule_versions_sunday_reward_check check (
    sunday_reward between 0 and 1000000
  ),
  constraint checkin_rule_versions_makeup_cost_check check (
    makeup_cost between 0 and 1000000
  )
);

create table if not exists public.player_checkins (
  user_id uuid not null
    references public.profiles(id) on delete cascade,
  checkin_date date not null,
  checkin_type text not null,
  reward_amount bigint not null,
  payment_method text not null,
  payment_amount bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, checkin_date),
  constraint player_checkins_type_check check (
    checkin_type in ('daily', 'makeup')
  ),
  constraint player_checkins_reward_amount_check check (
    reward_amount between 0 and 1000000
  ),
  constraint player_checkins_payment_method_check check (
    payment_method in ('none', 'coins', 'item')
  ),
  constraint player_checkins_payment_amount_check check (
    payment_amount between 0 and 1000000
  ),
  constraint player_checkins_payment_consistency_check check (
    (
      checkin_type = 'daily'
      and payment_method = 'none'
      and payment_amount = 0
    )
    or (
      checkin_type = 'makeup'
      and payment_method = 'coins'
    )
    or (
      checkin_type = 'makeup'
      and payment_method = 'item'
      and payment_amount = 1
    )
  )
);

create index if not exists activities_visible_window_idx
on public.activities (is_active, publish_at desc, ends_at, starts_at);

create unique index if not exists site_notifications_activity_unique_idx
on public.site_notifications (activity_id)
where activity_id is not null;

create index if not exists site_notifications_visible_cursor_idx
on public.site_notifications (is_active, visible_at desc, id desc);

create index if not exists notification_reads_user_idx
on public.notification_reads (user_id, read_at desc, notification_id);

create index if not exists checkin_rule_versions_effective_idx
on public.checkin_rule_versions (effective_from desc);

create index if not exists player_checkins_user_month_idx
on public.player_checkins (user_id, checkin_date desc);

insert into public.checkin_rule_versions (
  effective_from,
  monday_reward,
  tuesday_reward,
  wednesday_reward,
  thursday_reward,
  friday_reward,
  saturday_reward,
  sunday_reward,
  makeup_cost
) values (
  date '1970-01-01',
  10,
  10,
  10,
  10,
  10,
  10,
  10,
  20
)
on conflict (effective_from) do nothing;

create or replace function public.site_local_date()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (now() at time zone 'Asia/Hong_Kong')::date;
$$;

create or replace function public.require_registered_user()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
     or not exists (
       select 1 from public.profiles where id = v_user_id
     )
     or not exists (
       select 1 from public.player_wallets where user_id = v_user_id
     ) then
    raise exception 'REGISTERED_ACCOUNT_REQUIRED';
  end if;

  return v_user_id;
end;
$$;

create or replace function public.require_site_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not public.is_economy_admin(v_user_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  return v_user_id;
end;
$$;

create or replace function public.checkin_rule_for_date(p_date date)
returns public.checkin_rule_versions
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rule
  from public.checkin_rule_versions as rule
  where rule.effective_from <= p_date
  order by rule.effective_from desc
  limit 1;
$$;

create or replace function public.validate_public_url(
  p_value text,
  p_allow_relative boolean default false
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_value text := btrim(p_value);
  v_authority text;
begin
  if p_value is null or v_value = '' then
    return null;
  end if;

  if v_value ~ '[[:cntrl:]]'
     or v_value ~ '[[:space:]]'
     or strpos(v_value, chr(92)) > 0 then
    raise exception 'INVALID_PUBLIC_URL';
  end if;

  if lower(left(v_value, 8)) = 'https://' then
    v_authority := split_part(
      split_part(
        split_part(substring(v_value from 9), '/', 1),
        '?',
        1
      ),
      '#',
      1
    );

    if v_authority = '' then
      raise exception 'INVALID_PUBLIC_URL';
    end if;

    return v_value;
  end if;

  if coalesce(p_allow_relative, false)
     and left(v_value, 1) = '/'
     and left(v_value, 2) <> '//' then
    return v_value;
  end if;

  raise exception 'INVALID_PUBLIC_URL';
end;
$$;

create or replace function public.list_active_activities()
returns table (
  id uuid,
  title text,
  body text,
  cover_url text,
  action_label text,
  action_url text,
  publish_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  reward_amount bigint,
  claimed boolean,
  claimed_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    activity.id,
    activity.title::text,
    activity.body,
    activity.cover_url,
    activity.action_label::text,
    activity.action_url,
    activity.publish_at,
    activity.starts_at,
    activity.ends_at,
    activity.reward_amount,
    claim.claimed_at is not null as claimed,
    claim.claimed_at
  from public.activities as activity
  left join public.activity_claims as claim
    on claim.activity_id = activity.id
   and claim.user_id = auth.uid()
   and exists (
     select 1
     from public.profiles as profile
     join public.player_wallets as wallet on wallet.user_id = profile.id
     where profile.id = auth.uid()
   )
  where activity.is_active
    and activity.publish_at <= now()
    and activity.ends_at > now()
  order by activity.publish_at desc, activity.id desc;
$$;

create or replace function public.claim_activity_reward(
  p_activity_id uuid,
  p_request_id uuid
)
returns table (
  reward_amount bigint,
  balance bigint,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
  v_activity public.activities%rowtype;
  v_balance bigint;
  v_claimed_at timestamptz;
begin
  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;

  select wallet.balance
  into v_balance
  from public.player_wallets as wallet
  where wallet.user_id = v_user_id
  for update;

  select activity.*
  into v_activity
  from public.activities as activity
  where activity.id = p_activity_id
  for update;

  if not found then
    raise exception 'ACTIVITY_NOT_FOUND';
  end if;
  if not v_activity.is_active then
    raise exception 'ACTIVITY_DISABLED';
  end if;
  if v_activity.publish_at > now() then
    raise exception 'ACTIVITY_NOT_PUBLISHED';
  end if;
  if v_activity.starts_at > now() then
    raise exception 'ACTIVITY_NOT_STARTED';
  end if;
  if v_activity.ends_at <= now() then
    raise exception 'ACTIVITY_ENDED';
  end if;

  begin
    insert into public.activity_claims (
      activity_id,
      user_id,
      reward_amount
    ) values (
      v_activity.id,
      v_user_id,
      v_activity.reward_amount
    )
    returning activity_claims.claimed_at into v_claimed_at;
  exception
    when unique_violation then
      raise exception 'ACTIVITY_ALREADY_CLAIMED';
  end;

  if v_activity.reward_amount <> 0 then
    v_balance := public.apply_coin_delta(
      v_user_id,
      v_activity.reward_amount,
      'activity_reward',
      v_activity.id::text,
      'activity_reward:' || v_activity.id::text || ':' || v_user_id::text
    );
  end if;

  return query
  select v_activity.reward_amount, v_balance, v_claimed_at;
end;
$$;

create or replace function public.admin_list_activities()
returns table (
  id uuid,
  title text,
  body text,
  cover_url text,
  action_label text,
  action_url text,
  publish_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  reward_amount bigint,
  is_active boolean,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  claim_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_site_admin();

  return query
  select
    activity.id,
    activity.title::text,
    activity.body,
    activity.cover_url,
    activity.action_label::text,
    activity.action_url,
    activity.publish_at,
    activity.starts_at,
    activity.ends_at,
    activity.reward_amount,
    activity.is_active,
    activity.created_by,
    activity.created_at,
    activity.updated_at,
    (
      select count(*)
      from public.activity_claims as claim
      where claim.activity_id = activity.id
    ) as claim_count
  from public.activities as activity
  order by activity.created_at desc, activity.id desc;
end;
$$;

create or replace function public.admin_save_activity(
  p_id uuid,
  p_title text,
  p_body text,
  p_cover_url text,
  p_action_label text,
  p_action_url text,
  p_publish_at timestamptz,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reward_amount bigint
)
returns public.activities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := public.require_site_admin();
  v_title text := btrim(p_title);
  v_body text := btrim(p_body);
  v_cover_url text := public.validate_public_url(p_cover_url, false);
  v_action_label text := nullif(btrim(p_action_label), '');
  v_action_url text := public.validate_public_url(p_action_url, true);
  v_activity public.activities%rowtype;
begin
  if v_title is null or v_title = '' or char_length(v_title) > 80 then
    raise exception 'INVALID_ACTIVITY_TITLE';
  end if;
  if v_body is null or v_body = '' then
    raise exception 'INVALID_ACTIVITY_BODY';
  end if;
  if (v_action_label is null) <> (v_action_url is null)
     or char_length(v_action_label) > 30 then
    raise exception 'INVALID_ACTIVITY_ACTION';
  end if;
  if p_publish_at is null
     or p_starts_at is null
     or p_ends_at is null
     or p_publish_at > p_starts_at
     or p_starts_at >= p_ends_at then
    raise exception 'INVALID_ACTIVITY_WINDOW';
  end if;
  if p_reward_amount is null or p_reward_amount not between 0 and 1000000 then
    raise exception 'INVALID_ACTIVITY_REWARD';
  end if;

  if p_id is null then
    insert into public.activities (
      title,
      body,
      cover_url,
      action_label,
      action_url,
      publish_at,
      starts_at,
      ends_at,
      reward_amount,
      created_by
    ) values (
      v_title,
      v_body,
      v_cover_url,
      v_action_label,
      v_action_url,
      p_publish_at,
      p_starts_at,
      p_ends_at,
      p_reward_amount,
      v_admin_id
    )
    returning * into v_activity;
  else
    select activity.*
    into v_activity
    from public.activities as activity
    where activity.id = p_id
    for update;

    if not found then
      raise exception 'ACTIVITY_NOT_FOUND';
    end if;

    update public.activities as activity
    set title = v_title,
        body = v_body,
        cover_url = v_cover_url,
        action_label = v_action_label,
        action_url = v_action_url,
        publish_at = p_publish_at,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        reward_amount = p_reward_amount,
        is_active = true,
        updated_at = now()
    where activity.id = p_id
    returning activity.* into v_activity;
  end if;

  insert into public.site_notifications (
    activity_id,
    title,
    body,
    reward_amount,
    visible_at,
    expires_at,
    is_active,
    created_by
  ) values (
    v_activity.id,
    v_activity.title,
    v_activity.body,
    0,
    v_activity.publish_at,
    v_activity.ends_at,
    true,
    v_admin_id
  )
  on conflict (activity_id) where activity_id is not null
  do update set
    title = excluded.title,
    body = excluded.body,
    reward_amount = 0,
    visible_at = excluded.visible_at,
    expires_at = excluded.expires_at,
    is_active = true,
    updated_at = now();

  return v_activity;
end;
$$;

create or replace function public.admin_unpublish_activity(p_activity_id uuid)
returns public.activities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activity public.activities%rowtype;
begin
  perform public.require_site_admin();

  select activity.*
  into v_activity
  from public.activities as activity
  where activity.id = p_activity_id
  for update;

  if not found then
    raise exception 'ACTIVITY_NOT_FOUND';
  end if;

  update public.activities as activity
  set is_active = false,
      updated_at = now()
  where activity.id = p_activity_id
  returning activity.* into v_activity;

  update public.site_notifications as notification
  set is_active = false,
      updated_at = now()
  where notification.activity_id = p_activity_id;

  return v_activity;
end;
$$;

create or replace function public.list_site_notifications(
  p_before_visible_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  activity_id uuid,
  title text,
  body text,
  reward_amount bigint,
  visible_at timestamptz,
  expires_at timestamptz,
  action_url text,
  is_read boolean,
  reward_claimed boolean,
  read_at timestamptz,
  reward_claimed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_registered boolean;
begin
  if (p_before_visible_at is null) <> (p_before_id is null) then
    raise exception 'INVALID_NOTIFICATION_CURSOR';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'INVALID_NOTIFICATION_LIMIT';
  end if;

  v_registered := v_user_id is not null
    and exists (select 1 from public.profiles where profiles.id = v_user_id)
    and exists (select 1 from public.player_wallets where player_wallets.user_id = v_user_id);

  return query
  select
    notification.id,
    notification.activity_id,
    notification.title::text,
    notification.body,
    notification.reward_amount,
    notification.visible_at,
    notification.expires_at,
    case
      when notification.activity_id is not null then
        '/player/?tab=activities&activity=' || notification.activity_id::text
      else null
    end as action_url,
    case when v_registered then read.read_at is not null else false end as is_read,
    case when v_registered then claim.claimed_at is not null else false end as reward_claimed,
    case when v_registered then read.read_at else null end as read_at,
    case when v_registered then claim.claimed_at else null end as reward_claimed_at
  from public.site_notifications as notification
  left join public.notification_reads as read
    on read.notification_id = notification.id
   and read.user_id = v_user_id
  left join public.notification_claims as claim
    on claim.notification_id = notification.id
   and claim.user_id = v_user_id
  where notification.is_active
    and notification.visible_at <= now()
    and (notification.expires_at is null or notification.expires_at > now())
    and (
      p_before_visible_at is null
      or (notification.visible_at, notification.id) < (p_before_visible_at, p_before_id)
    )
  order by notification.visible_at desc, notification.id desc
  limit p_limit;
end;
$$;

create or replace function public.count_unread_site_notifications()
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
  v_count bigint;
begin
  select count(*)
  into v_count
  from public.site_notifications as notification
  where notification.is_active
    and notification.visible_at <= now()
    and (notification.expires_at is null or notification.expires_at > now())
    and not exists (
      select 1
      from public.notification_reads as read
      where read.notification_id = notification.id
        and read.user_id = v_user_id
    );

  return v_count;
end;
$$;

create or replace function public.mark_site_notification_read(p_notification_id uuid)
returns table (
  notification_id uuid,
  read_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
  v_notification public.site_notifications%rowtype;
begin
  select notification.*
  into v_notification
  from public.site_notifications as notification
  where notification.id = p_notification_id
  for update;

  if not found then
    raise exception 'NOTIFICATION_NOT_FOUND';
  end if;
  if not v_notification.is_active then
    raise exception 'NOTIFICATION_DISABLED';
  end if;
  if v_notification.visible_at > now() then
    raise exception 'NOTIFICATION_NOT_VISIBLE';
  end if;
  if v_notification.expires_at is not null and v_notification.expires_at <= now() then
    raise exception 'NOTIFICATION_EXPIRED';
  end if;

  insert into public.notification_reads (notification_id, user_id)
  values (v_notification.id, v_user_id)
  on conflict on constraint notification_reads_pkey do nothing;

  return query
  select read.notification_id, read.read_at
  from public.notification_reads as read
  where read.notification_id = v_notification.id
    and read.user_id = v_user_id;
end;
$$;

create or replace function public.claim_site_notification_reward(
  p_notification_id uuid,
  p_request_id uuid
)
returns table (
  reward_amount bigint,
  balance bigint,
  claimed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
  v_notification public.site_notifications%rowtype;
  v_balance bigint;
  v_claimed_at timestamptz;
begin
  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;

  select wallet.balance
  into v_balance
  from public.player_wallets as wallet
  where wallet.user_id = v_user_id
  for update;

  select notification.*
  into v_notification
  from public.site_notifications as notification
  where notification.id = p_notification_id
  for update;

  if not found then
    raise exception 'NOTIFICATION_NOT_FOUND';
  end if;
  if not v_notification.is_active then
    raise exception 'NOTIFICATION_DISABLED';
  end if;
  if v_notification.visible_at > now() then
    raise exception 'NOTIFICATION_NOT_VISIBLE';
  end if;
  if v_notification.expires_at is not null and v_notification.expires_at <= now() then
    raise exception 'NOTIFICATION_EXPIRED';
  end if;
  if v_notification.reward_amount <= 0 then
    raise exception 'NOTIFICATION_NO_REWARD';
  end if;

  begin
    insert into public.notification_claims (
      notification_id,
      user_id,
      reward_amount
    ) values (
      v_notification.id,
      v_user_id,
      v_notification.reward_amount
    )
    returning notification_claims.claimed_at into v_claimed_at;
  exception
    when unique_violation then
      raise exception 'NOTIFICATION_ALREADY_CLAIMED';
  end;

  v_balance := public.apply_coin_delta(
    v_user_id,
    v_notification.reward_amount,
    'notification_reward',
    v_notification.id::text,
    'notification_reward:' || v_notification.id::text || ':' || v_user_id::text
  );

  return query
  select v_notification.reward_amount, v_balance, v_claimed_at;
end;
$$;

create or replace function public.admin_list_site_notifications()
returns table (
  id uuid,
  activity_id uuid,
  title text,
  body text,
  reward_amount bigint,
  visible_at timestamptz,
  expires_at timestamptz,
  is_active boolean,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  read_count bigint,
  claim_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_site_admin();

  return query
  select
    notification.id,
    notification.activity_id,
    notification.title::text,
    notification.body,
    notification.reward_amount,
    notification.visible_at,
    notification.expires_at,
    notification.is_active,
    notification.created_by,
    notification.created_at,
    notification.updated_at,
    (
      select count(*)
      from public.notification_reads as read
      where read.notification_id = notification.id
    ) as read_count,
    (
      select count(*)
      from public.notification_claims as claim
      where claim.notification_id = notification.id
    ) as claim_count
  from public.site_notifications as notification
  order by notification.created_at desc, notification.id desc;
end;
$$;

create or replace function public.admin_publish_site_notification(
  p_title text,
  p_body text,
  p_reward_amount bigint,
  p_visible_at timestamptz,
  p_expires_at timestamptz default null
)
returns public.site_notifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := public.require_site_admin();
  v_title text := btrim(p_title);
  v_body text := btrim(p_body);
  v_notification public.site_notifications%rowtype;
begin
  if v_title is null or v_title = '' or char_length(v_title) > 80 then
    raise exception 'INVALID_NOTIFICATION_TITLE';
  end if;
  if v_body is null or v_body = '' then
    raise exception 'INVALID_NOTIFICATION_BODY';
  end if;
  if p_reward_amount is null or p_reward_amount not between 0 and 1000000 then
    raise exception 'INVALID_NOTIFICATION_REWARD';
  end if;
  if p_visible_at is null
     or (p_expires_at is not null and p_expires_at <= p_visible_at) then
    raise exception 'INVALID_NOTIFICATION_WINDOW';
  end if;

  insert into public.site_notifications (
    activity_id,
    title,
    body,
    reward_amount,
    visible_at,
    expires_at,
    is_active,
    created_by
  ) values (
    null,
    v_title,
    v_body,
    p_reward_amount,
    p_visible_at,
    p_expires_at,
    true,
    v_admin_id
  )
  returning * into v_notification;

  return v_notification;
end;
$$;

create or replace function public.admin_disable_site_notification(p_notification_id uuid)
returns public.site_notifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notification public.site_notifications%rowtype;
begin
  perform public.require_site_admin();

  select notification.*
  into v_notification
  from public.site_notifications as notification
  where notification.id = p_notification_id
  for update;

  if not found then
    raise exception 'NOTIFICATION_NOT_FOUND';
  end if;

  update public.site_notifications as notification
  set is_active = false,
      updated_at = now()
  where notification.id = p_notification_id
  returning notification.* into v_notification;

  return v_notification;
end;
$$;

create or replace function public.get_checkin_month(p_month date)
returns table (
  checkin_date date,
  reward_amount bigint,
  checked_in boolean,
  checkin_type text,
  payment_method text,
  payment_amount bigint,
  is_today boolean,
  can_makeup boolean,
  makeup_cost bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
  v_today date := public.site_local_date();
  v_month_start date;
  v_current_month date;
begin
  if p_month is null then
    raise exception 'INVALID_CHECKIN_MONTH';
  end if;

  v_month_start := date_trunc('month', p_month)::date;
  v_current_month := date_trunc('month', v_today)::date;

  if v_month_start > v_current_month then
    raise exception 'INVALID_CHECKIN_MONTH';
  end if;

  return query
  select
    calendar.checkin_date,
    coalesce(
      checkin.reward_amount,
      case extract(isodow from calendar.checkin_date)::integer
        when 1 then rule.monday_reward
        when 2 then rule.tuesday_reward
        when 3 then rule.wednesday_reward
        when 4 then rule.thursday_reward
        when 5 then rule.friday_reward
        when 6 then rule.saturday_reward
        when 7 then rule.sunday_reward
      end
    ) as reward_amount,
    checkin.user_id is not null as checked_in,
    checkin.checkin_type,
    checkin.payment_method,
    checkin.payment_amount,
    calendar.checkin_date = v_today as is_today,
    v_month_start = v_current_month
      and calendar.checkin_date < v_today
      and checkin.user_id is null as can_makeup,
    rule.makeup_cost
  from generate_series(
    v_month_start,
    (v_month_start + interval '1 month - 1 day')::date,
    interval '1 day'
  ) as days(day_value)
  cross join lateral (
    select days.day_value::date as checkin_date
  ) as calendar
  cross join lateral public.checkin_rule_for_date(calendar.checkin_date) as rule
  left join public.player_checkins as checkin
    on checkin.user_id = v_user_id
   and checkin.checkin_date = calendar.checkin_date
  order by calendar.checkin_date;
end;
$$;

create or replace function public.perform_daily_checkin(p_request_id uuid)
returns table (
  checkin_date date,
  reward_amount bigint,
  balance bigint,
  checkin_type text,
  payment_method text,
  payment_amount bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
  v_date date := public.site_local_date();
  v_rule public.checkin_rule_versions%rowtype;
  v_checkin public.player_checkins%rowtype;
  v_reward bigint;
  v_balance bigint;
begin
  if p_request_id is null then
    raise exception 'INVALID_REQUEST_ID';
  end if;

  select wallet.balance
  into v_balance
  from public.player_wallets as wallet
  where wallet.user_id = v_user_id
  for update;

  select rule.*
  into v_rule
  from public.checkin_rule_for_date(v_date) as rule;

  if not found then
    raise exception 'INVALID_CHECKIN_RULE';
  end if;

  if exists (
    select 1
    from public.player_checkins as checkin
    where checkin.user_id = v_user_id
      and checkin.checkin_date = v_date
  ) then
    raise exception 'CHECKIN_ALREADY_DONE';
  end if;

  v_reward := case extract(isodow from v_date)::integer
    when 1 then v_rule.monday_reward
    when 2 then v_rule.tuesday_reward
    when 3 then v_rule.wednesday_reward
    when 4 then v_rule.thursday_reward
    when 5 then v_rule.friday_reward
    when 6 then v_rule.saturday_reward
    when 7 then v_rule.sunday_reward
  end;

  begin
    insert into public.player_checkins as checkin (
      user_id,
      checkin_date,
      checkin_type,
      reward_amount,
      payment_method,
      payment_amount
    ) values (
      v_user_id,
      v_date,
      'daily',
      v_reward,
      'none',
      0
    )
    returning checkin.* into v_checkin;
  exception
    when unique_violation then
      raise exception 'CHECKIN_ALREADY_DONE';
  end;

  if v_reward <> 0 then
    v_balance := public.apply_coin_delta(
      v_user_id,
      v_reward,
      'checkin_daily',
      v_date::text,
      'checkin:daily:' || v_user_id::text || ':' || v_date::text
    );
  end if;

  return query
  select
    v_checkin.checkin_date,
    v_checkin.reward_amount,
    v_balance,
    v_checkin.checkin_type,
    v_checkin.payment_method,
    v_checkin.payment_amount;
end;
$$;

create or replace function public.perform_makeup_checkin(
  p_date date,
  p_payment_method text,
  p_request_id uuid
)
returns table (
  checkin_date date,
  reward_amount bigint,
  balance bigint,
  checkin_type text,
  payment_method text,
  payment_amount bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
  v_today date := public.site_local_date();
  v_current_month date := date_trunc('month', v_today)::date;
  v_rule public.checkin_rule_versions%rowtype;
  v_checkin public.player_checkins%rowtype;
  v_reward bigint;
  v_balance bigint;
begin
  if p_request_id is null then
    raise exception 'INVALID_REQUEST_ID';
  end if;

  select wallet.balance
  into v_balance
  from public.player_wallets as wallet
  where wallet.user_id = v_user_id
  for update;

  if p_date is null or p_date >= v_today then
    raise exception 'MAKEUP_DATE_INVALID';
  end if;

  if date_trunc('month', p_date)::date <> v_current_month then
    raise exception 'MAKEUP_OUTSIDE_CURRENT_MONTH';
  end if;

  if exists (
    select 1
    from public.player_checkins as checkin
    where checkin.user_id = v_user_id
      and checkin.checkin_date = p_date
  ) then
    raise exception 'CHECKIN_ALREADY_DONE';
  end if;

  if p_payment_method = 'item' then
    raise exception 'ITEM_PAYMENT_UNAVAILABLE';
  end if;
  if p_payment_method is distinct from 'coins' then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  select rule.*
  into v_rule
  from public.checkin_rule_for_date(p_date) as rule;

  if not found then
    raise exception 'INVALID_CHECKIN_RULE';
  end if;

  v_reward := case extract(isodow from p_date)::integer
    when 1 then v_rule.monday_reward
    when 2 then v_rule.tuesday_reward
    when 3 then v_rule.wednesday_reward
    when 4 then v_rule.thursday_reward
    when 5 then v_rule.friday_reward
    when 6 then v_rule.saturday_reward
    when 7 then v_rule.sunday_reward
  end;

  begin
    insert into public.player_checkins as checkin (
      user_id,
      checkin_date,
      checkin_type,
      reward_amount,
      payment_method,
      payment_amount
    ) values (
      v_user_id,
      p_date,
      'makeup',
      v_reward,
      'coins',
      v_rule.makeup_cost
    )
    returning checkin.* into v_checkin;
  exception
    when unique_violation then
      raise exception 'CHECKIN_ALREADY_DONE';
  end;

  if v_rule.makeup_cost <> 0 then
    v_balance := public.apply_coin_delta(
      v_user_id,
      -v_rule.makeup_cost,
      'checkin_makeup_cost',
      p_date::text,
      'checkin:makeup:cost:' || v_user_id::text || ':' || p_date::text
    );
  end if;

  if v_reward <> 0 then
    v_balance := public.apply_coin_delta(
      v_user_id,
      v_reward,
      'checkin_makeup_reward',
      p_date::text,
      'checkin:makeup:reward:' || v_user_id::text || ':' || p_date::text
    );
  end if;

  return query
  select
    v_checkin.checkin_date,
    v_checkin.reward_amount,
    v_balance,
    v_checkin.checkin_type,
    v_checkin.payment_method,
    v_checkin.payment_amount;
end;
$$;

create or replace function public.admin_list_checkin_rules()
returns table (
  id bigint,
  effective_from date,
  monday_reward bigint,
  tuesday_reward bigint,
  wednesday_reward bigint,
  thursday_reward bigint,
  friday_reward bigint,
  saturday_reward bigint,
  sunday_reward bigint,
  makeup_cost bigint,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_site_admin();

  return query
  select
    rule.id,
    rule.effective_from,
    rule.monday_reward,
    rule.tuesday_reward,
    rule.wednesday_reward,
    rule.thursday_reward,
    rule.friday_reward,
    rule.saturday_reward,
    rule.sunday_reward,
    rule.makeup_cost,
    rule.created_by,
    rule.created_at
  from public.checkin_rule_versions as rule
  order by rule.effective_from desc, rule.id desc;
end;
$$;

create or replace function public.admin_create_checkin_rule(
  p_effective_from date,
  p_monday_reward bigint,
  p_tuesday_reward bigint,
  p_wednesday_reward bigint,
  p_thursday_reward bigint,
  p_friday_reward bigint,
  p_saturday_reward bigint,
  p_sunday_reward bigint,
  p_makeup_cost bigint
)
returns public.checkin_rule_versions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := public.require_site_admin();
  v_today date := public.site_local_date();
  v_rule public.checkin_rule_versions%rowtype;
begin
  if p_effective_from is null or p_effective_from < v_today then
    raise exception 'CHECKIN_RULE_DATE_INVALID';
  end if;

  if exists (
    select 1
    from unnest(array[
      p_monday_reward,
      p_tuesday_reward,
      p_wednesday_reward,
      p_thursday_reward,
      p_friday_reward,
      p_saturday_reward,
      p_sunday_reward,
      p_makeup_cost
    ]) as value(amount)
    where value.amount is null
       or value.amount not between 0 and 1000000
  ) then
    raise exception 'INVALID_CHECKIN_RULE';
  end if;

  begin
    insert into public.checkin_rule_versions as rule (
      effective_from,
      monday_reward,
      tuesday_reward,
      wednesday_reward,
      thursday_reward,
      friday_reward,
      saturday_reward,
      sunday_reward,
      makeup_cost,
      created_by
    ) values (
      p_effective_from,
      p_monday_reward,
      p_tuesday_reward,
      p_wednesday_reward,
      p_thursday_reward,
      p_friday_reward,
      p_saturday_reward,
      p_sunday_reward,
      p_makeup_cost,
      v_admin_id
    )
    returning rule.* into v_rule;
  exception
    when unique_violation then
      raise exception 'CHECKIN_RULE_DATE_EXISTS';
  end;

  return v_rule;
end;
$$;

alter table public.activities enable row level security;
alter table public.activity_claims enable row level security;
alter table public.site_notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.notification_claims enable row level security;
alter table public.checkin_rule_versions enable row level security;
alter table public.player_checkins enable row level security;

revoke all on table public.activities from public, anon, authenticated;
revoke all on table public.activity_claims from public, anon, authenticated;
revoke all on table public.site_notifications from public, anon, authenticated;
revoke all on table public.notification_reads from public, anon, authenticated;
revoke all on table public.notification_claims from public, anon, authenticated;
revoke all on table public.checkin_rule_versions from public, anon, authenticated;
revoke all on table public.player_checkins from public, anon, authenticated;

grant select on table public.site_notifications to anon, authenticated;
grant select on table public.notification_reads to authenticated;

drop policy if exists "visitors can read active site notifications" on public.site_notifications;
create policy "visitors can read active site notifications"
on public.site_notifications for select
to anon, authenticated
using (
  is_active = true
  and visible_at <= now()
  and (expires_at is null or expires_at > now())
);

drop policy if exists "players can read own notification reads" on public.notification_reads;
create policy "players can read own notification reads"
on public.notification_reads for select
to authenticated
using (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.site_notifications;
exception when duplicate_object then
  null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.notification_reads;
exception when duplicate_object then
  null;
end;
$$;

revoke execute on function public.site_local_date() from public, anon, authenticated;
revoke execute on function public.require_registered_user() from public, anon, authenticated;
revoke execute on function public.require_site_admin() from public, anon, authenticated;
revoke execute on function public.checkin_rule_for_date(date) from public, anon, authenticated;
revoke execute on function public.validate_public_url(text, boolean) from public, anon, authenticated;

revoke execute on function public.list_active_activities() from public, anon, authenticated;
revoke execute on function public.claim_activity_reward(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_list_activities() from public, anon, authenticated;
revoke execute on function public.admin_save_activity(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, bigint) from public, anon, authenticated;
revoke execute on function public.admin_unpublish_activity(uuid) from public, anon, authenticated;
revoke execute on function public.list_site_notifications(timestamptz, uuid, integer) from public, anon, authenticated;
revoke execute on function public.count_unread_site_notifications() from public, anon, authenticated;
revoke execute on function public.mark_site_notification_read(uuid) from public, anon, authenticated;
revoke execute on function public.claim_site_notification_reward(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.admin_list_site_notifications() from public, anon, authenticated;
revoke execute on function public.admin_publish_site_notification(text, text, bigint, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.admin_disable_site_notification(uuid) from public, anon, authenticated;
revoke execute on function public.get_checkin_month(date) from public, anon, authenticated;
revoke execute on function public.perform_daily_checkin(uuid) from public, anon, authenticated;
revoke execute on function public.perform_makeup_checkin(date, text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_list_checkin_rules() from public, anon, authenticated;
revoke execute on function public.admin_create_checkin_rule(date, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint) from public, anon, authenticated;

grant execute on function public.list_active_activities() to anon, authenticated;
grant execute on function public.list_site_notifications(timestamptz, uuid, integer) to anon, authenticated;

grant execute on function public.claim_activity_reward(uuid, uuid) to authenticated;
grant execute on function public.admin_list_activities() to authenticated;
grant execute on function public.admin_save_activity(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, bigint) to authenticated;
grant execute on function public.admin_unpublish_activity(uuid) to authenticated;
grant execute on function public.count_unread_site_notifications() to authenticated;
grant execute on function public.mark_site_notification_read(uuid) to authenticated;
grant execute on function public.claim_site_notification_reward(uuid, uuid) to authenticated;
grant execute on function public.admin_list_site_notifications() to authenticated;
grant execute on function public.admin_publish_site_notification(text, text, bigint, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_disable_site_notification(uuid) to authenticated;
grant execute on function public.get_checkin_month(date) to authenticated;
grant execute on function public.perform_daily_checkin(uuid) to authenticated;
grant execute on function public.perform_makeup_checkin(date, text, uuid) to authenticated;
grant execute on function public.admin_list_checkin_rules() to authenticated;
grant execute on function public.admin_create_checkin_rule(date, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint) to authenticated;

create or replace function public.prevent_engagement_record_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE'
     and not exists (
       select 1
       from public.profiles as profile
       where profile.id = old.user_id
     ) then
    return old;
  end if;

  raise exception 'ENGAGEMENT_RECORD_IMMUTABLE';
end;
$$;

revoke execute on function public.prevent_engagement_record_mutation()
from public, anon, authenticated;

drop trigger if exists engagement_record_immutable on public.activity_claims;
create trigger engagement_record_immutable
before update or delete on public.activity_claims
for each row
execute function public.prevent_engagement_record_mutation();

drop trigger if exists engagement_record_immutable on public.notification_claims;
create trigger engagement_record_immutable
before update or delete on public.notification_claims
for each row
execute function public.prevent_engagement_record_mutation();

drop trigger if exists engagement_record_immutable on public.player_checkins;
create trigger engagement_record_immutable
before update or delete on public.player_checkins
for each row
execute function public.prevent_engagement_record_mutation();

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
  if v_user is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user
  ) then
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

create table if not exists public.shop_products (
  sku text primary key check (sku in ('makeup_card', 'rename_card')),
  name varchar(40) not null,
  description text not null,
  price bigint not null default 0 check (price >= 0),
  is_active boolean not null default false,
  per_user_limit integer check (per_user_limit is null or per_user_limit > 0),
  sort_order integer not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_purchases (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id),
  sku text not null references public.shop_products(sku),
  unit_price bigint not null check (unit_price >= 0),
  quantity integer not null default 1 check (quantity = 1),
  total_price bigint not null check (total_price >= 0),
  created_at timestamptz not null default now(),
  check (total_price = unit_price * quantity)
);

create table if not exists public.player_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  sku text not null references public.shop_products(sku),
  quantity bigint not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, sku)
);

create table if not exists public.item_ledger (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id),
  sku text not null references public.shop_products(sku),
  delta bigint not null check (delta <> 0),
  quantity_after bigint not null check (quantity_after >= 0),
  event_type text not null,
  reference_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists shop_purchases_user_sku_idx
on public.shop_purchases (user_id, sku, created_at);

create index if not exists item_ledger_user_created_idx
on public.item_ledger (user_id, created_at desc);

insert into public.shop_products (
  sku, name, description, price, is_active, per_user_limit, sort_order
) values
  ('makeup_card', '补签卡', '抵扣一次补签金币费用', 0, false, null, 10),
  ('rename_card', '改名卡', '修改一次注册账号游戏名', 0, false, null, 20)
on conflict (sku) do update
set name = excluded.name,
    description = excluded.description,
    sort_order = excluded.sort_order;

create or replace function public.prevent_item_ledger_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'ITEM_LEDGER_IMMUTABLE';
end;
$$;

drop trigger if exists item_ledger_immutable on public.item_ledger;
create trigger item_ledger_immutable
before update or delete on public.item_ledger
for each row execute function public.prevent_item_ledger_mutation();

create or replace function public.apply_item_delta(
  p_user uuid,
  p_sku text,
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
  v_quantity bigint;
  v_existing public.item_ledger%rowtype;
begin
  if p_user is null or p_delta = 0 then
    raise exception 'INVALID_ITEM_DELTA';
  end if;
  if p_sku not in ('makeup_card', 'rename_card')
     or not exists (select 1 from public.shop_products where sku = p_sku) then
    raise exception 'ITEM_NOT_FOUND';
  end if;
  if nullif(btrim(coalesce(p_event_type, '')), '') is null
     or nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'INVALID_ITEM_DELTA';
  end if;

  select ledger.*
  into v_existing
  from public.item_ledger as ledger
  where ledger.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.user_id <> p_user or v_existing.sku <> p_sku then
      raise exception 'INVALID_ITEM_IDEMPOTENCY';
    end if;
    return v_existing.quantity_after;
  end if;

  insert into public.player_items (user_id, sku, quantity)
  values (p_user, p_sku, 0)
  on conflict (user_id, sku) do nothing;

  select item.quantity
  into v_quantity
  from public.player_items as item
  where item.user_id = p_user and item.sku = p_sku
  for update;

  select ledger.*
  into v_existing
  from public.item_ledger as ledger
  where ledger.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.user_id <> p_user or v_existing.sku <> p_sku then
      raise exception 'INVALID_ITEM_IDEMPOTENCY';
    end if;
    return v_existing.quantity_after;
  end if;

  if v_quantity + p_delta < 0 then
    raise exception 'INSUFFICIENT_ITEMS';
  end if;

  v_quantity := v_quantity + p_delta;
  update public.player_items as item
  set quantity = v_quantity,
      updated_at = now()
  where item.user_id = p_user and item.sku = p_sku;

  insert into public.item_ledger (
    user_id, sku, delta, quantity_after, event_type, reference_id, idempotency_key
  ) values (
    p_user, p_sku, p_delta, v_quantity, p_event_type, p_reference_id, p_idempotency_key
  );

  return v_quantity;
end;
$$;

create or replace function public.list_shop_products()
returns table (
  sku text,
  name text,
  description text,
  price bigint,
  is_active boolean,
  per_user_limit integer,
  purchased_count bigint,
  remaining_limit bigint,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    product.sku,
    product.name::text,
    product.description,
    product.price,
    product.is_active,
    product.per_user_limit,
    case
      when exists (select 1 from public.profiles where id = auth.uid())
      then count(purchase.id)
      else 0
    end as purchased_count,
    case
      when product.per_user_limit is null then null
      else greatest(
        product.per_user_limit::bigint - case
          when exists (select 1 from public.profiles where id = auth.uid())
          then count(purchase.id)
          else 0
        end,
        0
      )
    end as remaining_limit,
    product.updated_at
  from public.shop_products as product
  left join public.shop_purchases as purchase
    on purchase.sku = product.sku
   and purchase.user_id = auth.uid()
  where product.is_active and product.price >= 1
  group by product.sku
  order by product.sort_order, product.sku;
$$;

create or replace function public.get_player_inventory()
returns table (sku text, quantity bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
begin
  return query
  select product.sku, coalesce(item.quantity, 0)::bigint
  from public.shop_products as product
  left join public.player_items as item
    on item.user_id = v_user_id and item.sku = product.sku
  where product.sku in ('makeup_card', 'rename_card')
  order by product.sort_order, product.sku;
end;
$$;

create or replace function public.admin_list_shop_products()
returns table (
  sku text,
  name text,
  description text,
  price bigint,
  is_active boolean,
  per_user_limit integer,
  sort_order integer,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_site_admin();
  return query
  select
    product.sku,
    product.name::text,
    product.description,
    product.price,
    product.is_active,
    product.per_user_limit,
    product.sort_order,
    product.updated_at
  from public.shop_products as product
  order by product.sort_order, product.sku;
end;
$$;

create or replace function public.admin_update_shop_product(
  p_sku text,
  p_price bigint,
  p_is_active boolean,
  p_per_user_limit integer
)
returns table (
  sku text,
  name text,
  description text,
  price bigint,
  is_active boolean,
  per_user_limit integer,
  sort_order integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid := public.require_site_admin();
begin
  if p_sku not in ('makeup_card', 'rename_card') then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  if p_price is null or p_price not between 0 and 1000000
     or p_is_active is null
     or (p_is_active and p_price < 1)
     or (p_per_user_limit is not null and p_per_user_limit not between 1 and 100000) then
    raise exception 'INVALID_PRODUCT_CONFIG';
  end if;

  return query
  update public.shop_products as product
  set price = p_price,
      is_active = p_is_active,
      per_user_limit = p_per_user_limit,
      updated_by = v_admin_id,
      updated_at = now()
  where product.sku = p_sku
  returning
    product.sku,
    product.name::text,
    product.description,
    product.price,
    product.is_active,
    product.per_user_limit,
    product.sort_order,
    product.updated_at;
end;
$$;

create or replace function public.buy_shop_product(p_sku text, p_request_id uuid)
returns table (
  sku text,
  price_paid bigint,
  balance bigint,
  quantity bigint,
  remaining_limit bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
  v_product public.shop_products%rowtype;
  v_purchase public.shop_purchases%rowtype;
  v_purchase_id uuid := gen_random_uuid();
  v_purchased_count bigint;
  v_balance bigint;
  v_quantity bigint;
begin
  if p_request_id is null then
    raise exception 'INVALID_REQUEST_ID';
  end if;

  select product.*
  into v_product
  from public.shop_products as product
  where product.sku = p_sku
  for update;

  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;

  select purchase.*
  into v_purchase
  from public.shop_purchases as purchase
  where purchase.request_id = p_request_id;

  if found then
    if v_purchase.user_id <> v_user_id or v_purchase.sku <> p_sku then
      raise exception 'INVALID_REQUEST_ID';
    end if;
    select wallet.balance into v_balance
    from public.player_wallets as wallet where wallet.user_id = v_user_id;
    select coalesce(item.quantity, 0) into v_quantity
    from public.player_items as item
    where item.user_id = v_user_id and item.sku = p_sku;
    select count(*) into v_purchased_count
    from public.shop_purchases as purchase
    where purchase.user_id = v_user_id and purchase.sku = p_sku;
    return query select
      v_purchase.sku,
      v_purchase.unit_price,
      v_balance,
      coalesce(v_quantity, 0),
      case when v_product.per_user_limit is null then null
        else greatest(v_product.per_user_limit::bigint - v_purchased_count, 0) end;
    return;
  end if;

  if not v_product.is_active then raise exception 'PRODUCT_INACTIVE'; end if;
  if v_product.price < 1 then raise exception 'PRODUCT_PRICE_INVALID'; end if;

  select count(*) into v_purchased_count
  from public.shop_purchases as purchase
  where purchase.user_id = v_user_id and purchase.sku = p_sku;

  if v_product.per_user_limit is not null
     and v_purchased_count >= v_product.per_user_limit then
    raise exception 'PURCHASE_LIMIT_REACHED';
  end if;

  v_balance := public.apply_coin_delta(
    v_user_id,
    -v_product.price,
    'shop_purchase',
    v_purchase_id::text,
    'shop_purchase:' || p_request_id::text
  );

  insert into public.shop_purchases (
    id, request_id, user_id, sku, unit_price, quantity, total_price
  ) values (
    v_purchase_id, p_request_id, v_user_id, p_sku, v_product.price, 1, v_product.price
  ) returning * into v_purchase;

  v_quantity := public.apply_item_delta(
    v_user_id,
    p_sku,
    1,
    'shop_purchase',
    v_purchase_id::text,
    'shop_item:' || p_request_id::text
  );

  v_purchased_count := v_purchased_count + 1;
  return query select
    v_purchase.sku,
    v_purchase.unit_price,
    v_balance,
    v_quantity,
    case when v_product.per_user_limit is null then null
      else greatest(v_product.per_user_limit::bigint - v_purchased_count, 0) end;
end;
$$;

create or replace function public.rename_with_item(p_game_name text, p_request_id uuid)
returns table (username text, game_name text, rename_card_quantity bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
  v_game_name text := btrim(coalesce(p_game_name, ''));
  v_profile public.profiles%rowtype;
  v_quantity bigint;
begin
  if p_request_id is null then raise exception 'INVALID_REQUEST_ID'; end if;
  if char_length(v_game_name) not between 1 and 16
     or v_game_name ~ '[[:cntrl:]]' then
    raise exception 'INVALID_GAME_NAME';
  end if;

  select profile.*
  into v_profile
  from public.profiles as profile
  where profile.id = v_user_id
  for update;

  if v_profile.game_name = v_game_name then
    select coalesce(item.quantity, 0)
    into v_quantity
    from public.player_items as item
    where item.user_id = v_user_id and item.sku = 'rename_card';
    return query select v_profile.username, v_profile.game_name, coalesce(v_quantity, 0);
    return;
  end if;

  v_quantity := public.apply_item_delta(
    v_user_id,
    'rename_card',
    -1,
    'rename',
    v_user_id::text,
    'rename:' || p_request_id::text
  );

  update public.profiles as profile
  set game_name = v_game_name,
      updated_at = now()
  where profile.id = v_user_id
  returning profile.* into v_profile;

  return query select v_profile.username, v_profile.game_name, v_quantity;
end;
$$;

create or replace function public.perform_makeup_checkin(
  p_date date,
  p_payment_method text,
  p_request_id uuid
)
returns table (
  checkin_date date,
  reward_amount bigint,
  balance bigint,
  checkin_type text,
  payment_method text,
  payment_amount bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := public.require_registered_user();
  v_today date := public.site_local_date();
  v_current_month date := date_trunc('month', v_today)::date;
  v_rule public.checkin_rule_versions%rowtype;
  v_checkin public.player_checkins%rowtype;
  v_reward bigint;
  v_balance bigint;
  v_payment_amount bigint;
begin
  if p_request_id is null then raise exception 'INVALID_REQUEST_ID'; end if;

  select wallet.balance into v_balance
  from public.player_wallets as wallet
  where wallet.user_id = v_user_id
  for update;

  if p_date is null or p_date >= v_today then raise exception 'MAKEUP_DATE_INVALID'; end if;
  if date_trunc('month', p_date)::date <> v_current_month then
    raise exception 'MAKEUP_OUTSIDE_CURRENT_MONTH';
  end if;
  if p_payment_method not in ('coins', 'item') then
    raise exception 'INVALID_MAKEUP_PAYMENT';
  end if;
  if exists (
    select 1 from public.player_checkins as checkin
    where checkin.user_id = v_user_id and checkin.checkin_date = p_date
  ) then
    raise exception 'CHECKIN_ALREADY_DONE';
  end if;

  select rule.* into v_rule
  from public.checkin_rule_for_date(p_date) as rule;
  if not found then raise exception 'INVALID_CHECKIN_RULE'; end if;

  v_reward := case extract(isodow from p_date)::integer
    when 1 then v_rule.monday_reward when 2 then v_rule.tuesday_reward
    when 3 then v_rule.wednesday_reward when 4 then v_rule.thursday_reward
    when 5 then v_rule.friday_reward when 6 then v_rule.saturday_reward
    when 7 then v_rule.sunday_reward
  end;
  v_payment_amount := case when p_payment_method = 'item' then 1 else v_rule.makeup_cost end;

  begin
    insert into public.player_checkins as checkin (
      user_id, checkin_date, checkin_type, reward_amount, payment_method, payment_amount
    ) values (
      v_user_id, p_date, 'makeup', v_reward, p_payment_method, v_payment_amount
    ) returning checkin.* into v_checkin;
  exception when unique_violation then
    raise exception 'CHECKIN_ALREADY_DONE';
  end;

  if p_payment_method = 'coins' and v_rule.makeup_cost <> 0 then
    v_balance := public.apply_coin_delta(
      v_user_id, -v_rule.makeup_cost, 'checkin_makeup_cost', p_date::text,
      'checkin:makeup:cost:' || v_user_id::text || ':' || p_date::text
    );
  elsif p_payment_method = 'item' then
    perform public.apply_item_delta(
      v_user_id, 'makeup_card', -1, 'checkin_makeup', p_date::text,
      'makeup_item:' || v_user_id::text || ':' || p_date::text
    );
  end if;

  if v_reward <> 0 then
    v_balance := public.apply_coin_delta(
      v_user_id, v_reward, 'checkin_makeup_reward', p_date::text,
      'checkin:makeup:reward:' || v_user_id::text || ':' || p_date::text
    );
  end if;

  return query select
    v_checkin.checkin_date, v_checkin.reward_amount, v_balance,
    v_checkin.checkin_type, v_checkin.payment_method, v_checkin.payment_amount;
end;
$$;

alter table public.shop_products enable row level security;
alter table public.shop_purchases enable row level security;
alter table public.player_items enable row level security;
alter table public.item_ledger enable row level security;

revoke all on table public.shop_products from public;
revoke all on table public.shop_products from anon, authenticated;
revoke all on table public.shop_purchases from public;
revoke all on table public.shop_purchases from anon, authenticated;
revoke all on table public.player_items from public;
revoke all on table public.player_items from anon, authenticated;
revoke all on table public.item_ledger from public;
revoke all on table public.item_ledger from anon, authenticated;

revoke all on function public.prevent_item_ledger_mutation() from public, anon, authenticated;
revoke all on function public.apply_item_delta(uuid, text, bigint, text, text, text) from public, anon, authenticated;

revoke execute on function public.list_shop_products() from public, anon, authenticated;
revoke execute on function public.get_player_inventory() from public, anon, authenticated;
revoke execute on function public.buy_shop_product(text, uuid) from public, anon, authenticated;
revoke execute on function public.admin_list_shop_products() from public, anon, authenticated;
revoke execute on function public.admin_update_shop_product(text, bigint, boolean, integer) from public, anon, authenticated;
revoke execute on function public.rename_with_item(text, uuid) from public, anon, authenticated;
revoke execute on function public.perform_makeup_checkin(date, text, uuid) from public, anon, authenticated;

grant execute on function public.list_shop_products() to anon, authenticated;
grant execute on function public.get_player_inventory() to authenticated;
grant execute on function public.buy_shop_product(text, uuid) to authenticated;
grant execute on function public.admin_list_shop_products() to authenticated;
grant execute on function public.admin_update_shop_product(text, bigint, boolean, integer) to authenticated;
grant execute on function public.rename_with_item(text, uuid) to authenticated;
grant execute on function public.perform_makeup_checkin(date, text, uuid) to authenticated;
