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
