-- Run after 001, 002 and 003. Safe to re-run; keeps passwords, sessions and history.
begin;

-- Family customer identities are names within this kitchen. Device authorization
-- remains separate, so returning on another device resumes the same profile.
create table if not exists public.customer_profiles (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  display_name text not null check(length(trim(display_name)) between 1 and 60),
  unique(id,kitchen_id)
);
create unique index if not exists customer_profiles_name
  on public.customer_profiles(kitchen_id,lower(btrim(display_name)));
alter table public.customer_profiles enable row level security;
revoke all on public.customer_profiles from anon,authenticated;
grant select,update(display_name) on public.customer_profiles to authenticated;
alter table public.members add column if not exists customer_profile_id uuid;

-- Merge existing same-name customer entries into a profile without deleting any
-- membership or Auth user. Historical requests keep their original snapshots.
insert into public.customer_profiles(kitchen_id,display_name)
select kitchen_id,display_name from (
  select distinct on (kitchen_id,lower(btrim(display_name))) kitchen_id,btrim(display_name) as display_name
  from public.members where role='customer'
  order by kitchen_id,lower(btrim(display_name)),user_id
) existing
on conflict (kitchen_id,lower(btrim(display_name))) do nothing;
update public.members m set customer_profile_id=p.id
from public.customer_profiles p
where m.role='customer' and m.customer_profile_id is null and m.kitchen_id=p.kitchen_id
  and lower(btrim(m.display_name))=lower(btrim(p.display_name));
do $$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.members'::regclass and conname='members_customer_profile_fk') then
    alter table public.members add constraint members_customer_profile_fk
      foreign key(customer_profile_id,kitchen_id) references public.customer_profiles(id,kitchen_id);
    alter table public.members add constraint members_customer_profile_role
      check((role='customer')=(customer_profile_id is not null));
  end if;
end $$;

drop policy if exists customer_profiles_read on public.customer_profiles;
create policy customer_profiles_read on public.customer_profiles for select to authenticated
using(private.is_member(kitchen_id));
drop policy if exists customer_profiles_name on public.customer_profiles;
create policy customer_profiles_name on public.customer_profiles for update to authenticated
using(exists(select 1 from public.members m where m.kitchen_id=customer_profiles.kitchen_id
  and m.customer_profile_id=customer_profiles.id and m.user_id=auth.uid() and m.role='customer'))
with check(exists(select 1 from public.members m where m.kitchen_id=customer_profiles.kitchen_id
  and m.customer_profile_id=customer_profiles.id and m.user_id=auth.uid() and m.role='customer'));

create or replace function private.ensure_customer_profile(p_kitchen uuid,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare profile uuid;
begin
  insert into public.customer_profiles(kitchen_id,display_name) values(p_kitchen,trim(p_name))
  on conflict(kitchen_id,lower(btrim(display_name))) do update set display_name=customer_profiles.display_name
  returning id into profile;
  return profile;
end $$;
revoke all on function private.ensure_customer_profile(uuid,text) from public,anon,authenticated;

-- Keep per-device display names consistent with the selected family profile.
-- Direct display-name edits cannot switch which customer a device represents.
create or replace function private.use_customer_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.role='customer' then
    if new.customer_profile_id is null then
      new.customer_profile_id=private.ensure_customer_profile(new.kitchen_id,new.display_name);
    end if;
    select display_name into new.display_name from public.customer_profiles
      where id=new.customer_profile_id and kitchen_id=new.kitchen_id;
    if not found then raise exception 'invalid_name'; end if;
  else
    new.customer_profile_id=null;
  end if;
  return new;
end $$;
revoke all on function private.use_customer_profile() from public,anon,authenticated;
drop trigger if exists members_customer_profile on public.members;
create trigger members_customer_profile before insert or update of display_name,role,customer_profile_id on public.members
for each row execute function private.use_customer_profile();
update public.members m set display_name=p.display_name from public.customer_profiles p
where m.customer_profile_id=p.id and m.display_name is distinct from p.display_name;

create or replace function private.sync_customer_profile_name() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.members set display_name=new.display_name
    where customer_profile_id=new.id and display_name is distinct from new.display_name;
  return new;
end $$;
revoke all on function private.sync_customer_profile_name() from public,anon,authenticated;
drop trigger if exists customer_profiles_sync_name on public.customer_profiles;
create trigger customer_profiles_sync_name after update of display_name on public.customer_profiles
for each row when (old.display_name is distinct from new.display_name)
execute function private.sync_customer_profile_name();

-- Existing order snapshots remain unchanged. Only link legacy requests whose
-- creator still has a matching customer membership; do not guess roles from
-- a historical display name, or relink old requests on repeated migration runs.
do $$
begin
  if not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='requests' and column_name='customer_profile_id') then
    alter table public.requests add column customer_profile_id uuid;
    alter table public.requests add constraint requests_customer_profile_fk
      foreign key(customer_profile_id,kitchen_id) references public.customer_profiles(id,kitchen_id);
    update public.requests r set customer_profile_id=m.customer_profile_id
      from public.members m
      where m.role='customer' and m.user_id=r.created_by and m.kitchen_id=r.kitchen_id
        and lower(btrim(m.display_name))=lower(btrim(r.customer_name));
  end if;
end $$;

-- Snapshot stable ownership on the server when either a menu order or a wish
-- is inserted. Neither a later rename nor changing profiles can transfer it.
create or replace function private.set_request_customer_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select customer_profile_id into new.customer_profile_id from public.members
    where kitchen_id=new.kitchen_id and user_id=new.created_by and role='customer';
  return new;
end $$;
revoke all on function private.set_request_customer_profile() from public,anon,authenticated;
drop trigger if exists requests_customer_profile on public.requests;
create trigger requests_customer_profile before insert on public.requests
for each row execute function private.set_request_customer_profile();

create or replace function public.set_display_name(p_name text) returns void
language plpgsql security invoker set search_path='' as $$
declare current_member public.members;
begin
  if p_name is null or length(trim(p_name)) not between 1 and 60 then raise exception 'invalid_name'; end if;
  select * into current_member from public.members where user_id=auth.uid();
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  if current_member.role='chef' then
    update public.chef_profiles set display_name=trim(p_name) where id=current_member.chef_profile_id;
  else
    update public.customer_profiles set display_name=trim(p_name) where id=current_member.customer_profile_id;
  end if;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
exception when unique_violation then
  if current_member.role='chef' then raise exception 'chef_name_taken';
  else raise exception 'customer_name_taken'; end if;
end $$;
revoke all on function public.set_display_name(text) from public,anon;
grant execute on function public.set_display_name(text) to authenticated;

create or replace function public.unlock_kitchen(p_code text,p_name text,p_as_chef boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare secret private.access_secrets; attempt private.unlock_attempts; expected text; actor uuid=auth.uid(); profile uuid; customer_profile uuid;
begin
  if actor is null then return jsonb_build_object('error','not_member'); end if;
  if p_code is null or p_code='' or p_name is null or length(trim(p_name)) not between 1 and 60 then return jsonb_build_object('error','invalid_request'); end if;
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
  if not private.verify_credential(p_code,expected) then return jsonb_build_object('error','invalid_code'); end if;
  if p_as_chef then
    profile=private.ensure_chef_profile(secret.kitchen_id,p_name);
  else
    customer_profile=private.ensure_customer_profile(secret.kitchen_id,p_name);
  end if;
  insert into public.members(kitchen_id,user_id,display_name,role,chef_profile_id,customer_profile_id)
  values(secret.kitchen_id,actor,trim(p_name),case when p_as_chef then 'chef' else 'customer' end,profile,customer_profile)
  on conflict(kitchen_id,user_id) do update set display_name=excluded.display_name,role=excluded.role,chef_profile_id=excluded.chef_profile_id,customer_profile_id=excluded.customer_profile_id;
  delete from private.unlock_attempts where user_id=actor;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.set_request_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare r public.requests;
begin
  select * into r from public.requests where id=p_id for update;
  if not found or not private.is_member(r.kitchen_id) then raise exception 'not_member' using errcode='42501'; end if;
  if p_status=r.status then return; end if;
  if p_status='completed' and r.status='pending' and private.is_chef(r.kitchen_id) then null;
  elsif p_status='pending' and r.status='completed' and private.is_chef(r.kitchen_id) then null;
  elsif p_status='cancelled' and r.status='pending' and (
    private.is_chef(r.kitchen_id)
    or (r.customer_profile_id is null and r.created_by=auth.uid())
    or (r.customer_profile_id is not null and exists(
      select 1 from public.members m where m.kitchen_id=r.kitchen_id and m.user_id=auth.uid()
        and m.role='customer' and m.customer_profile_id=r.customer_profile_id
    ))
  ) then null;
  else raise exception 'not_allowed' using errcode='42501'; end if;
  update public.requests set status=p_status,completed_at=case when p_status='completed' then now() else null end where id=p_id;
end $$;
revoke all on function public.unlock_kitchen(text,text,boolean),public.set_request_status(uuid,text) from public,anon;
grant execute on function public.unlock_kitchen(text,text,boolean),public.set_request_status(uuid,text) to authenticated;
commit;
