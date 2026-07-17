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
