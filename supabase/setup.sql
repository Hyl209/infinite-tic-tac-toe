create extension if not exists pgcrypto;

drop policy if exists "online players can receive room presence" on realtime.messages;
drop policy if exists "online players can send room presence" on realtime.messages;
drop function if exists public.is_online_game_player(text);
drop table if exists public.online_games cascade;
drop function if exists public.online_winning_line(jsonb, text);
drop function if exists public.online_winning_line(text, jsonb, text, smallint);
drop function if exists public.replay_online_history(text, smallint[]);
drop function if exists public.online_empty_board(text);

create table public.online_games (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  game_type text not null check (game_type in ('tic_tac_toe', 'gomoku')),
  x_player uuid not null,
  o_player uuid,
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

create or replace function public.create_online_game(p_game_type text)
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
  if found then return next v_game; return; end if;

  for v_attempt in 1..20 loop
    begin
      insert into public.online_games (room_code, game_type, x_player, board)
      values (
        public.generate_online_room_code(),
        p_game_type,
        v_user,
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

create or replace function public.join_online_game(p_room_code text, p_game_type text)
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
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then raise exception 'ROOM_NOT_FOUND'; end if;
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

revoke all on function public.online_empty_board(text) from public, anon, authenticated;
revoke all on function public.generate_online_room_code() from public, anon, authenticated;
revoke all on function public.online_winning_line(text, jsonb, text, smallint) from public, anon, authenticated;
revoke all on function public.replay_online_history(text, smallint[]) from public, anon, authenticated;
revoke all on function public.is_online_game_player(text) from public, anon;
grant execute on function public.is_online_game_player(text) to authenticated;

revoke all on function public.create_online_game(text) from public, anon;
revoke all on function public.join_online_game(text, text) from public, anon;
revoke all on function public.play_online_move(uuid, smallint) from public, anon;
revoke all on function public.request_online_undo(uuid) from public, anon;
revoke all on function public.respond_online_undo(uuid, boolean) from public, anon;
revoke all on function public.cancel_online_undo(uuid) from public, anon;
revoke all on function public.request_online_rematch(uuid) from public, anon;
revoke all on function public.leave_online_game(uuid) from public, anon;

grant execute on function public.create_online_game(text) to authenticated;
grant execute on function public.join_online_game(text, text) to authenticated;
grant execute on function public.play_online_move(uuid, smallint) to authenticated;
grant execute on function public.request_online_undo(uuid) to authenticated;
grant execute on function public.respond_online_undo(uuid, boolean) to authenticated;
grant execute on function public.cancel_online_undo(uuid) to authenticated;
grant execute on function public.request_online_rematch(uuid) to authenticated;
grant execute on function public.leave_online_game(uuid) to authenticated;
