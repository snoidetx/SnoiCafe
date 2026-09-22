-- One private kitchen per installation. Run as the database owner.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.kitchens (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check(singleton),
  name text not null check(length(trim(name)) between 1 and 80),
  announcement text not null default '' check(length(announcement)<=500)
);
create table public.members (
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check(length(trim(display_name)) between 1 and 60),
  role text not null default 'customer' check(role in ('chef','customer')),
  primary key(kitchen_id,user_id)
);
create table public.categories (
  id uuid primary key default gen_random_uuid(), kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 60),
  name_zh text not null default '' check(length(name_zh)<=60),
  emoji text not null default '🍽️' check(length(emoji)<=12), position integer not null default 0,
  unique(id,kitchen_id)
);
create function private.valid_options(input jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare opt jsonb; val jsonb; names text[]='{}';
begin
  if jsonb_typeof(input) <> 'array' or jsonb_array_length(input)>8 then return false; end if;
  for opt in select * from jsonb_array_elements(input) loop
    if jsonb_typeof(opt)<>'object' or jsonb_typeof(opt->'name') is distinct from 'string'
       or length(trim(opt->>'name')) not between 1 and 60 or (opt->>'name')=any(names)
       or jsonb_typeof(opt->'values') is distinct from 'array' then return false; end if;
    names=array_append(names,opt->>'name');
    if jsonb_array_length(opt->'values') not between 1 and 12 then return false; end if;
    for val in select * from jsonb_array_elements(opt->'values') loop
      if jsonb_typeof(val)<>'string' or length(trim(val#>>'{}')) not between 1 and 60 then return false; end if;
    end loop;
    if (select count(distinct v) from jsonb_array_elements_text(opt->'values') v) <> jsonb_array_length(opt->'values') then return false; end if;
  end loop;
  return true;
end $$;
create table public.dishes (
  id uuid primary key default gen_random_uuid(), kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  category_id uuid, name text not null check(length(trim(name)) between 1 and 100),
  name_zh text not null default '' check(length(name_zh)<=100),
  description text not null default '' check(length(description)<=1000), description_zh text not null default '' check(length(description_zh)<=1000),
  price numeric(10,2) not null default 0 check(price between 0 and 999999),
  photo_path text not null check(length(photo_path)<=300 and photo_path like kitchen_id::text||'/%'),
  options jsonb not null default '[]' check(private.valid_options(options)),
  available boolean not null default true, archived boolean not null default false, created_at timestamptz not null default now(),
  foreign key(category_id,kitchen_id) references public.categories(id,kitchen_id), unique(id,kitchen_id)
);
create table public.requests (
  id uuid primary key default gen_random_uuid(), kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  dish_id uuid, created_by uuid not null references auth.users(id), customer_name text not null,
  name text not null check(length(trim(name)) between 1 and 100), name_zh text not null default '',
  quantity integer not null check(quantity between 1 and 20), price numeric(10,2) not null default 0,
  selected_options jsonb not null default '{}', notes text not null default '' check(length(notes)<=500),
  status text not null default 'pending' check(status in ('pending','completed','cancelled')),
  created_at timestamptz not null default now(), completed_at timestamptz,
  client_id uuid not null, unique(created_by,client_id),
  foreign key(dish_id,kitchen_id) references public.dishes(id,kitchen_id)
);
create index requests_kitchen_status on public.requests(kitchen_id,status,created_at desc);
create index dishes_kitchen_category on public.dishes(kitchen_id,category_id);
create index members_user on public.members(user_id);
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table private.access_secrets (
  kitchen_id uuid primary key references public.kitchens(id) on delete cascade,
  kitchen_hash text not null, chef_hash text not null
);
create table private.unlock_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  attempts integer not null default 0, window_end timestamptz not null
);
revoke all on private.access_secrets,private.unlock_attempts from public,anon,authenticated;

create function private.is_member(k uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.members where kitchen_id=k and user_id=(select auth.uid()));
$$;
create function private.is_chef(k uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.members where kitchen_id=k and user_id=(select auth.uid()) and role='chef');
$$;
revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

alter table public.kitchens enable row level security;
alter table public.members enable row level security;
alter table public.categories enable row level security;
alter table public.dishes enable row level security;
alter table public.requests enable row level security;
revoke all on public.kitchens,public.members,public.categories,public.dishes,public.requests from anon,authenticated;
grant select on public.kitchens,public.members,public.categories,public.dishes,public.requests to authenticated;
grant update(name,announcement) on public.kitchens to authenticated;
grant update(display_name) on public.members to authenticated;
grant insert,update,delete on public.categories to authenticated;
grant insert,update on public.dishes to authenticated;
create policy kitchens_read on public.kitchens for select to authenticated using(private.is_member(id));
create policy kitchens_edit on public.kitchens for update to authenticated using(private.is_chef(id)) with check(private.is_chef(id));
create policy members_read on public.members for select to authenticated using(private.is_member(kitchen_id));
create policy members_name on public.members for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy categories_read on public.categories for select to authenticated using(private.is_member(kitchen_id));
create policy categories_insert on public.categories for insert to authenticated with check(private.is_chef(kitchen_id));
create policy categories_update on public.categories for update to authenticated using(private.is_chef(kitchen_id)) with check(private.is_chef(kitchen_id));
create policy categories_delete on public.categories for delete to authenticated using(private.is_chef(kitchen_id));
create policy dishes_read on public.dishes for select to authenticated using(private.is_member(kitchen_id));
create policy dishes_insert on public.dishes for insert to authenticated with check(private.is_chef(kitchen_id));
create policy dishes_update on public.dishes for update to authenticated using(private.is_chef(kitchen_id)) with check(private.is_chef(kitchen_id));
create policy requests_read on public.requests for select to authenticated using(private.is_member(kitchen_id));

-- RPC functions are the only way to change orders or memberships from the browser.
create function public.place_request(p_kitchen_id uuid,p_dish_id uuid,p_name text,p_quantity integer,p_notes text,p_selected_options jsonb,p_client_id uuid)
returns public.requests language plpgsql security definer set search_path='' as $$
declare d public.dishes; result public.requests; member_name text; opt jsonb; selected text;
begin
  if not private.is_member(p_kitchen_id) then raise exception 'not_member' using errcode='42501'; end if;
  select * into result from public.requests where created_by=auth.uid() and client_id=p_client_id;
  if found then return result; end if;
  if p_quantity is null or p_quantity not between 1 and 20 or p_notes is null or length(p_notes)>500
     or p_selected_options is null or jsonb_typeof(p_selected_options)<>'object' then raise exception 'invalid_request'; end if;
  select display_name into member_name from public.members where kitchen_id=p_kitchen_id and user_id=auth.uid();
  if p_dish_id is not null then
    select * into d from public.dishes where id=p_dish_id and kitchen_id=p_kitchen_id and available and not archived for share;
    if not found then raise exception 'dish_unavailable'; end if;
    if public.jsonb_object_length_safe(p_selected_options) <> jsonb_array_length(d.options) then raise exception 'invalid_options'; end if;
    for opt in select * from jsonb_array_elements(d.options) loop
      selected=p_selected_options->>(opt->>'name');
      if selected is null or jsonb_typeof(p_selected_options->(opt->>'name'))<>'string' or not (opt->'values' ? selected) then raise exception 'invalid_options'; end if;
    end loop;
  else
    if p_name is null or length(trim(p_name)) not between 1 and 100 or p_selected_options<>'{}'::jsonb then raise exception 'invalid_request'; end if;
  end if;
  insert into public.requests(kitchen_id,dish_id,created_by,customer_name,name,name_zh,quantity,price,notes,selected_options,client_id)
  values(p_kitchen_id,p_dish_id,auth.uid(),member_name,coalesce(d.name,trim(p_name)),coalesce(d.name_zh,''),p_quantity,coalesce(d.price,0),p_notes,p_selected_options,p_client_id)
  on conflict(created_by,client_id) do nothing returning * into result;
  if result.id is null then select * into result from public.requests where created_by=auth.uid() and client_id=p_client_id; end if;
  return result;
end $$;
-- Small helper uses count instead of assuming a JSON object-length extension.
create function public.jsonb_object_length_safe(value jsonb) returns integer language sql immutable set search_path='' as $$
  select count(*)::integer from jsonb_object_keys(value);
$$;
-- Qualify the helper explicitly, keeping the security-definer search_path empty.
create function public.set_request_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare r public.requests;
begin
  select * into r from public.requests where id=p_id for update;
  if not found or not private.is_member(r.kitchen_id) then raise exception 'not_member' using errcode='42501'; end if;
  if p_status=r.status then return; end if;
  if p_status='completed' and r.status='pending' and private.is_chef(r.kitchen_id) then null;
  elsif p_status='pending' and r.status='completed' and private.is_chef(r.kitchen_id) then null;
  elsif p_status='cancelled' and r.status='pending' and (r.created_by=auth.uid() or private.is_chef(r.kitchen_id)) then null;
  else raise exception 'not_allowed' using errcode='42501'; end if;
  update public.requests set status=p_status,completed_at=case when p_status='completed' then now() else null end where id=p_id;
end $$;
-- Serialize attempts per device. Return errors as values so failed attempts are not rolled back.
create function public.unlock_kitchen(p_code text,p_name text,p_as_chef boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare secret private.access_secrets; attempt private.unlock_attempts; expected text; actor uuid=auth.uid();
begin
  if actor is null then return jsonb_build_object('error','not_member'); end if;
  if p_code is null or octet_length(p_code)>72 or p_name is null or length(trim(p_name)) not between 1 and 60 then return jsonb_build_object('error','invalid_request'); end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text,0));
  insert into private.unlock_attempts(user_id,attempts,window_end) values(actor,0,now()+interval '15 minutes') on conflict do nothing;
  select * into attempt from private.unlock_attempts where user_id=actor for update;
  if attempt.window_end<=now() then
    update private.unlock_attempts set attempts=0,window_end=now()+interval '15 minutes' where user_id=actor;
    attempt.attempts=0;
  end if;
  if attempt.attempts>=8 then return jsonb_build_object('error','rate_limited'); end if;
  update private.unlock_attempts set attempts=attempts+1 where user_id=actor;
  select * into secret from private.access_secrets limit 1 for share;
  if not found then return jsonb_build_object('error','kitchen_not_ready'); end if;
  expected=case when p_as_chef then secret.chef_hash else secret.kitchen_hash end;
  if extensions.crypt(p_code,expected)<>expected then return jsonb_build_object('error','invalid_code'); end if;
  insert into public.members(kitchen_id,user_id,display_name,role)
  values(secret.kitchen_id,actor,trim(p_name),case when p_as_chef then 'chef' else 'customer' end)
  on conflict(kitchen_id,user_id) do update set display_name=excluded.display_name,role=excluded.role;
  delete from private.unlock_attempts where user_id=actor;
  return jsonb_build_object('ok',true);
end $$;
create function public.change_access_codes(p_kitchen_code text default null,p_chef_password text default null)
returns void language plpgsql security definer set search_path='' as $$
declare secret private.access_secrets;
begin
  select s.* into secret from private.access_secrets s where private.is_chef(s.kitchen_id) for update;
  if not found then raise exception 'not_allowed' using errcode='42501'; end if;
  if p_kitchen_code is not null and (length(p_kitchen_code) not between 6 and 64 or octet_length(p_kitchen_code)>72 or length(trim(p_kitchen_code))<>length(p_kitchen_code)) then raise exception 'invalid_code_length'; end if;
  if p_chef_password is not null and (length(p_chef_password) not between 10 and 64 or octet_length(p_chef_password)>72) then raise exception 'invalid_password_length'; end if;
  if (p_kitchen_code is not null and p_chef_password is not null and p_kitchen_code=p_chef_password)
     or (p_kitchen_code is not null and p_chef_password is null and extensions.crypt(p_kitchen_code,secret.chef_hash)=secret.chef_hash)
     or (p_chef_password is not null and p_kitchen_code is null and extensions.crypt(p_chef_password,secret.kitchen_hash)=secret.kitchen_hash) then raise exception 'different_codes'; end if;
  if p_kitchen_code is not null then
    update private.access_secrets set kitchen_hash=extensions.crypt(p_kitchen_code,extensions.gen_salt('bf',10)) where kitchen_id=secret.kitchen_id;
    delete from public.members where kitchen_id=secret.kitchen_id and role='customer';
  end if;
  if p_chef_password is not null then
    update private.access_secrets set chef_hash=extensions.crypt(p_chef_password,extensions.gen_salt('bf',10)) where kitchen_id=secret.kitchen_id;
    delete from public.members where kitchen_id=secret.kitchen_id and role='chef' and user_id<>auth.uid();
  end if;
end $$;
create function public.remove_member(p_user_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_user_id=auth.uid() then raise exception 'not_allowed' using errcode='42501'; end if;
  delete from public.members where user_id=p_user_id and private.is_chef(kitchen_id);
end $$;
create function public.delete_category(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare k uuid;
begin
  select kitchen_id into k from public.categories where id=p_id;
  if k is null or not private.is_chef(k) then raise exception 'not_allowed' using errcode='42501'; end if;
  update public.dishes set category_id=null where category_id=p_id;
  delete from public.categories where id=p_id;
end $$;
revoke all on function public.place_request(uuid,uuid,text,integer,text,jsonb,uuid),public.set_request_status(uuid,text),public.unlock_kitchen(text,text,boolean),public.change_access_codes(text,text),public.remove_member(uuid),public.delete_category(uuid),public.jsonb_object_length_safe(jsonb) from public,anon;
grant execute on function public.place_request(uuid,uuid,text,integer,text,jsonb,uuid),public.set_request_status(uuid,text),public.unlock_kitchen(text,text,boolean),public.change_access_codes(text,text),public.remove_member(uuid),public.delete_category(uuid) to authenticated;

-- Only the database administrator can provision the kitchen or recover the chef secret.
create function public.bootstrap_kitchen(p_chef_password text,p_kitchen_code text,p_name text default 'SnoiCafe') returns uuid
language plpgsql security definer set search_path='' as $$
declare k uuid;
begin
  if p_chef_password is null or length(p_chef_password) not between 10 and 64 or octet_length(p_chef_password)>72 then raise exception 'invalid_password_length'; end if;
  if p_kitchen_code is null or length(p_kitchen_code) not between 6 and 64 or octet_length(p_kitchen_code)>72 or trim(p_kitchen_code)<>p_kitchen_code then raise exception 'invalid_code_length'; end if;
  if p_chef_password=p_kitchen_code then raise exception 'different_codes'; end if;
  insert into public.kitchens(name) values(p_name) returning id into k;
  insert into private.access_secrets(kitchen_id,kitchen_hash,chef_hash)
  values(k,extensions.crypt(p_kitchen_code,extensions.gen_salt('bf',10)),extensions.crypt(p_chef_password,extensions.gen_salt('bf',10)));
  insert into public.categories(kitchen_id,name,name_zh,emoji,position) values(k,'Chinese','中餐','🥟',0),(k,'Western','西餐','🍝',1),(k,'Snacks','小吃','🥐',2),(k,'Drinks','饮品','🍵',3);
  return k;
end $$;
revoke all on function public.bootstrap_kitchen(text,text,text) from public,anon,authenticated;

-- Private photos. Public URLs and listing by outsiders do not work.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('dish-photos','dish-photos',false,2097152,array['image/jpeg','image/png','image/webp']);
create policy photos_read on storage.objects for select to authenticated
using(bucket_id='dish-photos' and exists(select 1 from public.members m where m.user_id=auth.uid() and m.kitchen_id::text=(storage.foldername(storage.objects.name))[1]));
create policy photos_insert on storage.objects for insert to authenticated
with check(bucket_id='dish-photos' and exists(select 1 from public.kitchens k where private.is_chef(k.id) and k.id::text=(storage.foldername(storage.objects.name))[1]));
create policy photos_delete on storage.objects for delete to authenticated
using(bucket_id='dish-photos' and exists(select 1 from public.kitchens k where private.is_chef(k.id) and k.id::text=(storage.foldername(storage.objects.name))[1]) and not exists(select 1 from public.dishes d where d.photo_path=storage.objects.name));

-- Grants are explicit for the trusted server role; its key must never reach the browser.
grant all on public.kitchens,public.members,public.categories,public.dishes,public.requests to service_role;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.dishes,public.categories,public.requests,public.kitchens;
  end if;
end $$;
commit;
