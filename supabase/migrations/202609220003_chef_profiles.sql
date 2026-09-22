-- Run after 001 and 002. Safe to re-run; keeps passwords, sessions and history.
begin;

-- Family chef identities are names within this kitchen. Device authorization
-- remains separate, so returning on another device resumes the same profile.
create table if not exists public.chef_profiles (
  id uuid primary key default gen_random_uuid(),
  kitchen_id uuid not null references public.kitchens(id) on delete cascade,
  display_name text not null check(length(trim(display_name)) between 1 and 60),
  unique(id,kitchen_id)
);
create unique index if not exists chef_profiles_name
  on public.chef_profiles(kitchen_id,lower(btrim(display_name)));
alter table public.chef_profiles enable row level security;
revoke all on public.chef_profiles from anon,authenticated;
grant select,update(display_name) on public.chef_profiles to authenticated;
alter table public.members add column if not exists chef_profile_id uuid;

-- Merge existing same-name chef entries into a profile without deleting any
-- membership or Auth user. Historical requests keep their original snapshots.
insert into public.chef_profiles(kitchen_id,display_name)
select kitchen_id,display_name from (
  select distinct on (kitchen_id,lower(btrim(display_name))) kitchen_id,btrim(display_name) as display_name
  from public.members where role='chef'
  order by kitchen_id,lower(btrim(display_name)),user_id
) existing
on conflict (kitchen_id,lower(btrim(display_name))) do nothing;
update public.members m set chef_profile_id=p.id
from public.chef_profiles p
where m.role='chef' and m.chef_profile_id is null and m.kitchen_id=p.kitchen_id
  and lower(btrim(m.display_name))=lower(btrim(p.display_name));
do $$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.members'::regclass and conname='members_chef_profile_fk') then
    alter table public.members add constraint members_chef_profile_fk
      foreign key(chef_profile_id,kitchen_id) references public.chef_profiles(id,kitchen_id);
    alter table public.members add constraint members_chef_profile_role
      check((role='chef')=(chef_profile_id is not null));
  end if;
end $$;

drop policy if exists chef_profiles_read on public.chef_profiles;
create policy chef_profiles_read on public.chef_profiles for select to authenticated
using(private.is_member(kitchen_id));
drop policy if exists chef_profiles_name on public.chef_profiles;
create policy chef_profiles_name on public.chef_profiles for update to authenticated
using(exists(select 1 from public.members m where m.kitchen_id=chef_profiles.kitchen_id
  and m.chef_profile_id=chef_profiles.id and m.user_id=auth.uid() and m.role='chef'))
with check(exists(select 1 from public.members m where m.kitchen_id=chef_profiles.kitchen_id
  and m.chef_profile_id=chef_profiles.id and m.user_id=auth.uid() and m.role='chef'));

create or replace function private.ensure_chef_profile(p_kitchen uuid,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare profile uuid;
begin
  insert into public.chef_profiles(kitchen_id,display_name) values(p_kitchen,trim(p_name))
  on conflict(kitchen_id,lower(btrim(display_name))) do update set display_name=chef_profiles.display_name
  returning id into profile;
  return profile;
end $$;
revoke all on function private.ensure_chef_profile(uuid,text) from public,anon,authenticated;

-- Keep per-device display names consistent with the selected family profile.
-- Direct display-name edits cannot switch which chef a device represents.
create or replace function private.use_chef_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.role='chef' then
    if new.chef_profile_id is null then
      new.chef_profile_id=private.ensure_chef_profile(new.kitchen_id,new.display_name);
    end if;
    select display_name into new.display_name from public.chef_profiles
      where id=new.chef_profile_id and kitchen_id=new.kitchen_id;
    if not found then raise exception 'invalid_name'; end if;
  else
    new.chef_profile_id=null;
  end if;
  return new;
end $$;
revoke all on function private.use_chef_profile() from public,anon,authenticated;
drop trigger if exists members_chef_profile on public.members;
create trigger members_chef_profile before insert or update of display_name,role,chef_profile_id on public.members
for each row execute function private.use_chef_profile();
update public.members m set display_name=p.display_name from public.chef_profiles p
where m.chef_profile_id=p.id and m.display_name is distinct from p.display_name;

create or replace function private.sync_chef_profile_name() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.members set display_name=new.display_name
    where chef_profile_id=new.id and display_name is distinct from new.display_name;
  return new;
end $$;
revoke all on function private.sync_chef_profile_name() from public,anon,authenticated;
drop trigger if exists chef_profiles_sync_name on public.chef_profiles;
create trigger chef_profiles_sync_name after update of display_name on public.chef_profiles
for each row when (old.display_name is distinct from new.display_name)
execute function private.sync_chef_profile_name();

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
    update public.members set display_name=trim(p_name)
      where kitchen_id=current_member.kitchen_id and user_id=auth.uid();
  end if;
  if not found then raise exception 'not_member' using errcode='42501'; end if;
exception when unique_violation then
  raise exception 'chef_name_taken';
end $$;
revoke all on function public.set_display_name(text) from public,anon;
grant execute on function public.set_display_name(text) to authenticated;

create or replace function public.unlock_kitchen(p_code text,p_name text,p_as_chef boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare secret private.access_secrets; attempt private.unlock_attempts; expected text; actor uuid=auth.uid(); profile uuid;
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
  end if;
  insert into public.members(kitchen_id,user_id,display_name,role,chef_profile_id)
  values(secret.kitchen_id,actor,trim(p_name),case when p_as_chef then 'chef' else 'customer' end,profile)
  on conflict(kitchen_id,user_id) do update set display_name=excluded.display_name,role=excluded.role,chef_profile_id=excluded.chef_profile_id;
  delete from private.unlock_attempts where user_id=actor;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.unlock_kitchen(text,text,boolean) from public,anon;
grant execute on function public.unlock_kitchen(text,text,boolean) to authenticated;
commit;
