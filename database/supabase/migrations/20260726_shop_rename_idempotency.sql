create table if not exists public.rename_requests (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  game_name varchar(16) not null check (
    game_name = btrim(game_name)
    and char_length(game_name) between 1 and 16
    and game_name !~ '[[:cntrl:]]'
  ),
  result_username text not null,
  rename_card_quantity bigint not null check (rename_card_quantity >= 0),
  consumed boolean not null,
  created_at timestamptz not null default now()
);

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
    if v_existing.user_id is distinct from p_user
       or v_existing.sku is distinct from p_sku
       or v_existing.delta is distinct from p_delta
       or v_existing.event_type is distinct from p_event_type
       or v_existing.reference_id is distinct from p_reference_id then
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
    if v_existing.user_id is distinct from p_user
       or v_existing.sku is distinct from p_sku
       or v_existing.delta is distinct from p_delta
       or v_existing.event_type is distinct from p_event_type
       or v_existing.reference_id is distinct from p_reference_id then
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
  v_request public.rename_requests%rowtype;
  v_existing public.item_ledger%rowtype;
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

  perform pg_advisory_xact_lock(hashtextextended('rename:' || p_request_id::text, 0));

  select request.*
  into v_request
  from public.rename_requests as request
  where request.request_id = p_request_id;

  if found then
    if v_request.user_id is distinct from v_user_id
       or v_request.game_name is distinct from v_game_name then
      raise exception 'INVALID_ITEM_IDEMPOTENCY';
    end if;
    return query select
      v_request.result_username,
      v_request.game_name::text,
      v_request.rename_card_quantity;
    return;
  end if;

  select ledger.*
  into v_existing
  from public.item_ledger as ledger
  where ledger.idempotency_key = 'rename:' || p_request_id::text;

  if found then
    if v_existing.user_id is distinct from v_user_id
       or v_existing.sku is distinct from 'rename_card'
       or v_existing.delta is distinct from -1
       or v_existing.event_type is distinct from 'rename' then
      raise exception 'INVALID_ITEM_IDEMPOTENCY';
    end if;

    if v_existing.reference_id is not distinct from v_user_id::text || ':' || v_game_name then
      null;
    elsif v_existing.reference_id is not distinct from v_user_id::text then
      if v_profile.game_name is distinct from v_game_name then
        raise exception 'INVALID_ITEM_IDEMPOTENCY';
      end if;
    else
      raise exception 'INVALID_ITEM_IDEMPOTENCY';
    end if;

    insert into public.rename_requests (
      request_id, user_id, game_name, result_username, rename_card_quantity, consumed
    ) values (
      p_request_id, v_user_id, v_game_name,
      v_profile.username, v_existing.quantity_after, true
    );
    return query select v_profile.username, v_game_name, v_existing.quantity_after;
    return;
  end if;

  if v_profile.game_name = v_game_name then
    select coalesce(item.quantity, 0)
    into v_quantity
    from public.player_items as item
    where item.user_id = v_user_id and item.sku = 'rename_card';
    insert into public.rename_requests (
      request_id, user_id, game_name, result_username, rename_card_quantity, consumed
    ) values (
      p_request_id, v_user_id, v_profile.game_name,
      v_profile.username, coalesce(v_quantity, 0), false
    );
    return query select v_profile.username, v_profile.game_name, coalesce(v_quantity, 0);
    return;
  end if;

  v_quantity := public.apply_item_delta(
    v_user_id,
    'rename_card',
    -1,
    'rename',
    v_user_id::text || ':' || v_game_name,
    'rename:' || p_request_id::text
  );

  update public.profiles as profile
  set game_name = v_game_name,
      updated_at = now()
  where profile.id = v_user_id
  returning profile.* into v_profile;

  insert into public.rename_requests (
    request_id, user_id, game_name, result_username, rename_card_quantity, consumed
  ) values (
    p_request_id, v_user_id, v_profile.game_name,
    v_profile.username, v_quantity, true
  );

  return query select v_profile.username, v_profile.game_name, v_quantity;
end;
$$;

alter table public.rename_requests enable row level security;

revoke all on table public.rename_requests from public;
revoke all on table public.rename_requests from anon, authenticated;

revoke all on function public.apply_item_delta(uuid, text, bigint, text, text, text) from public, anon, authenticated;
revoke execute on function public.rename_with_item(text, uuid) from public, anon, authenticated;
grant execute on function public.rename_with_item(text, uuid) to authenticated;
