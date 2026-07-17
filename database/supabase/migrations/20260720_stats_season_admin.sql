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
