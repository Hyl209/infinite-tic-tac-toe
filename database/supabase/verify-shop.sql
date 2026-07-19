-- SAFETY: read-only, repeatable acceptance checks for the explicitly selected test project.
-- Apply 20260724_shop.sql first. This file performs no schema or data writes.

do $verify_shop$
declare
  v_name text;
  v_role text;
  v_privilege text;
  v_definition text;
  v_tables text[] := array[
    'shop_products', 'shop_purchases', 'player_items', 'item_ledger', 'rename_requests'
  ];
  v_authenticated_rpcs text[] := array[
    'get_player_inventory()', 'buy_shop_product(text,uuid)',
    'admin_list_shop_products()',
    'admin_update_shop_product(text,bigint,boolean,integer)',
    'rename_with_item(text,uuid)'
  ];
begin
  foreach v_name in array v_tables loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'missing shop table: public.%', v_name;
    end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_name)) then
      raise exception 'RLS disabled: public.%', v_name;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        if has_table_privilege(v_role, 'public.' || v_name, v_privilege) then
          raise exception '% has direct % on public.%', v_role, v_privilege, v_name;
        end if;
      end loop;
    end loop;
  end loop;

  if (select array_agg(product.sku order by product.sort_order)
      from public.shop_products as product)
     is distinct from array['makeup_card', 'rename_card']::text[] then
    raise exception 'shop must contain exactly the two fixed SKUs';
  end if;

  if exists (
    select 1
    from public.shop_products as product
    where (product.sku = 'makeup_card'
           and row(product.name::text, product.description)
               is distinct from row('补签卡'::text, '抵扣一次补签金币费用'::text))
       or (product.sku = 'rename_card'
           and row(product.name::text, product.description)
               is distinct from row('改名卡'::text, '修改一次注册账号游戏名'::text))
  ) then raise exception 'fixed product metadata mismatch'; end if;

  if exists (
    select 1 from public.shop_products
    where price not between 0 and 1000000
       or (is_active and price < 1)
       or (per_user_limit is not null and per_user_limit not between 1 and 100000)
  ) then raise exception 'invalid persisted shop product config'; end if;

  if to_regprocedure('public.list_shop_products()') is null
     or not has_function_privilege('anon', 'public.list_shop_products()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.list_shop_products()', 'EXECUTE') then
    raise exception 'public shop list ACL missing';
  end if;

  foreach v_name in array v_authenticated_rpcs loop
    if to_regprocedure('public.' || v_name) is null then
      raise exception 'missing shop RPC: public.%', v_name;
    end if;
    if not has_function_privilege('authenticated', to_regprocedure('public.' || v_name), 'EXECUTE')
       or has_function_privilege('anon', to_regprocedure('public.' || v_name), 'EXECUTE') then
      raise exception 'shop RPC ACL mismatch: public.%', v_name;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.apply_item_delta(uuid,text,bigint,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.apply_item_delta(uuid,text,bigint,text,text,text)', 'EXECUTE') then
    raise exception 'apply_item_delta must remain internal';
  end if;

  if not exists (
    select 1 from pg_trigger
    where not tgisinternal
      and tgname = 'item_ledger_immutable'
      and tgrelid = to_regclass('public.item_ledger')
      and tgfoid = to_regprocedure('public.prevent_item_ledger_mutation()')
      and pg_get_triggerdef(oid) like '%BEFORE DELETE OR UPDATE%'
  ) then raise exception 'item_ledger_immutable trigger missing'; end if;

  v_definition := lower(pg_get_functiondef(
    to_regprocedure('public.apply_item_delta(uuid,text,bigint,text,text,text)')
  ));
  if v_definition not like '%for update%'
     or v_definition not like '%insufficient_items%'
     or v_definition not like '%idempotency_key%'
     or v_definition not like '%v_existing.user_id is distinct from p_user%'
     or v_definition not like '%v_existing.sku is distinct from p_sku%'
     or v_definition not like '%v_existing.delta is distinct from p_delta%'
     or v_definition not like '%v_existing.event_type is distinct from p_event_type%'
     or v_definition not like '%v_existing.reference_id is distinct from p_reference_id%' then
    raise exception 'apply_item_delta locking or idempotency contract missing';
  end if;

  v_definition := lower(pg_get_functiondef(to_regprocedure('public.buy_shop_product(text,uuid)')));
  if v_definition not like '%from public.shop_products%for update%'
     or v_definition not like '%public.apply_coin_delta(%'
     or v_definition not like '%public.apply_item_delta(%'
     or v_definition like '%p_price%' then
    raise exception 'buy_shop_product server-price transaction contract missing';
  end if;

  v_definition := lower(pg_get_functiondef(to_regprocedure('public.rename_with_item(text,uuid)')));
  if v_definition not like '%from public.profiles%for update%'
     or v_definition not like '%pg_advisory_xact_lock%p_request_id::text%'
     or v_definition not like '%from public.rename_requests%'
     or v_definition not like '%request.request_id = p_request_id%'
     or v_definition not like '%v_request.user_id is distinct from v_user_id%'
     or v_definition not like '%v_request.game_name is distinct from v_game_name%'
     or v_definition not like '%from public.item_ledger%'
     or v_definition not like '%ledger.idempotency_key = ''rename:'' || p_request_id::text%'
     or v_definition not like '%v_existing.reference_id is not distinct from v_user_id::text%'
     or v_definition not like '%v_profile.game_name is distinct from v_game_name%'
     or v_definition not like '%public.apply_item_delta(%'
     or v_definition not like '%v_profile.game_name = v_game_name%'
     or v_definition not like '%v_user_id::text || '':'' || v_game_name%'
     or v_definition not like '%return query select%v_request.result_username%v_request.game_name::text%v_request.rename_card_quantity%'
     or v_definition not like '%insert into public.rename_requests%' then
    raise exception 'rename_with_item lock, consumption, or same-name shortcut missing';
  end if;

  v_definition := lower(pg_get_functiondef(to_regprocedure('public.perform_makeup_checkin(date,text,uuid)')));
  if v_definition not like '%p_payment_method not in (''coins'', ''item'')%'
     or v_definition not like '%public.apply_item_delta(%'
     or v_definition not like '%makeup_item:%' then
    raise exception 'item makeup contract missing';
  end if;

  if exists (select 1 from public.player_items where quantity < 0)
     or exists (select 1 from public.item_ledger where quantity_after < 0 or delta = 0) then
    raise exception 'negative or zero-delta item state found';
  end if;

  if exists (
    select 1
    from public.player_wallets as wallet
    left join (
      select user_id, sum(delta) as total
      from public.coin_ledger
      group by user_id
    ) as ledger on ledger.user_id = wallet.user_id
    where wallet.balance <> coalesce(ledger.total, 0)
  ) then raise exception 'wallet balance differs from coin ledger sum'; end if;

  if exists (
    select 1
    from public.player_items as item
    left join (
      select user_id, sku, sum(delta) as total
      from public.item_ledger
      group by user_id, sku
    ) as ledger on ledger.user_id = item.user_id and ledger.sku = item.sku
    where item.quantity <> coalesce(ledger.total, 0)
  ) then raise exception 'inventory quantity differs from item ledger sum'; end if;

  if exists (
    select 1 from public.item_ledger as ledger
    left join public.player_items as item
      on item.user_id = ledger.user_id and item.sku = ledger.sku
    where item.user_id is null
  ) then raise exception 'item ledger row has no inventory row'; end if;

  if exists (
    select 1
    from public.shop_purchases as purchase
    left join public.coin_ledger as coin
      on coin.idempotency_key = 'shop_purchase:' || purchase.request_id::text
    left join public.item_ledger as item
      on item.idempotency_key = 'shop_item:' || purchase.request_id::text
    where coin.user_id is distinct from purchase.user_id
       or coin.delta is distinct from -purchase.total_price
       or coin.event_type is distinct from 'shop_purchase'
       or coin.reference_id is distinct from purchase.id::text
       or item.user_id is distinct from purchase.user_id
       or item.sku is distinct from purchase.sku
       or item.delta is distinct from 1
       or item.event_type is distinct from 'shop_purchase'
       or item.reference_id is distinct from purchase.id::text
  ) then raise exception 'purchase is missing its exact coin/item ledger pair'; end if;

  if exists (
    select 1 from public.coin_ledger as coin
    where coin.event_type = 'shop_purchase'
      and not exists (
        select 1 from public.shop_purchases as purchase
        where coin.idempotency_key = 'shop_purchase:' || purchase.request_id::text
      )
  ) or exists (
    select 1 from public.item_ledger as item
    where item.event_type = 'shop_purchase'
      and not exists (
        select 1 from public.shop_purchases as purchase
        where item.idempotency_key = 'shop_item:' || purchase.request_id::text
      )
  ) then raise exception 'orphan shop_purchase ledger event'; end if;

  if exists (
    select 1
    from public.player_checkins as checkin
    left join public.item_ledger as item
      on item.idempotency_key = 'makeup_item:' || checkin.user_id::text || ':' || checkin.checkin_date::text
    where checkin.checkin_type = 'makeup'
      and checkin.payment_method = 'item'
      and (
        checkin.payment_amount <> 1
        or item.user_id is distinct from checkin.user_id
        or item.sku is distinct from 'makeup_card'
        or item.delta is distinct from -1
      )
  ) then raise exception 'item makeup is missing its card ledger event'; end if;

  if exists (
    select 1
    from public.player_checkins as checkin
    join public.coin_ledger as coin
      on coin.idempotency_key = 'checkin:makeup:cost:' || checkin.user_id::text || ':' || checkin.checkin_date::text
    where checkin.payment_method = 'item'
  ) then raise exception 'item makeup must not write a coin cost event'; end if;

  if exists (
    select idempotency_key
    from public.item_ledger
    group by idempotency_key
    having count(*) <> 1
  ) then raise exception 'duplicate item ledger idempotency key'; end if;

  if exists (
    select 1
    from public.rename_requests as request
    left join public.item_ledger as item
      on item.idempotency_key = 'rename:' || request.request_id::text
    where (request.consumed and (
             item.user_id is distinct from request.user_id
             or item.sku is distinct from 'rename_card'
             or item.delta is distinct from -1
             or item.event_type is distinct from 'rename'
             or (
               item.reference_id is distinct from request.user_id::text || ':' || request.game_name
               and item.reference_id is distinct from request.user_id::text
             )
             or item.quantity_after is distinct from request.rename_card_quantity
           ))
       or (not request.consumed and item.id is not null)
  ) then raise exception 'rename request result differs from its item ledger event'; end if;
end;
$verify_shop$;

select sku, name, price, is_active, per_user_limit, updated_at
from public.shop_products
order by sort_order;

select event_type, sku, count(*) as event_count, sum(delta) as net_delta
from public.item_ledger
group by event_type, sku
order by event_type, sku;

select count(*) as purchase_count, coalesce(sum(total_price), 0) as total_spent
from public.shop_purchases;

-- External authenticated acceptance, run with real test sessions:
-- 1. Admin configures both fixed products, then a player buys each and repeats the same request ID.
-- 2. Expect one purchase, one shop_purchase coin event, and one shop_purchase item event per request ID.
-- 3. Run simultaneous purchases at balance/limit boundaries; successes must not exceed the allowed count.
-- 4. Use a makeup card: card -1, no makeup-cost coin event, reward once; zero-card failure rolls back all rows.
-- 5. Rename with a card: card -1 and profile changed; zero-card failure preserves profile; same-name retry costs 0.
-- 6. Ordinary users must fail admin RPCs; inactive products must fail purchase but held cards must remain usable.
