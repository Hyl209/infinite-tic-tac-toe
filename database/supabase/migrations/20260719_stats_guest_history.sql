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
