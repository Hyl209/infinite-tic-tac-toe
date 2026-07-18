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
