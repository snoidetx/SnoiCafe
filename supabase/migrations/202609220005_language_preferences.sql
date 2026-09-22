-- Run after 001–004. Preserve menu/history and remember language per family profile.
begin;

alter table public.chef_profiles add column if not exists preferred_language text
  check(preferred_language in ('en','zh'));
alter table public.customer_profiles add column if not exists preferred_language text
  check(preferred_language in ('en','zh'));

-- Existing profile RLS limits updates to the profile used by the current session.
grant update(preferred_language) on public.chef_profiles,public.customer_profiles to authenticated;

create or replace function public.set_language_preference(p_language text,p_only_if_unset boolean default false)
returns text language plpgsql security invoker set search_path='' as $$
declare current_member public.members; chosen text;
begin
  if p_language is null or p_language not in ('en','zh') then raise exception 'invalid_language'; end if;
  select * into current_member from public.members where user_id=auth.uid();
  if not found then raise exception 'not_member' using errcode='42501'; end if;
  if current_member.role='chef' then
    update public.chef_profiles
      set preferred_language=case when p_only_if_unset then coalesce(preferred_language,p_language) else p_language end
      where id=current_member.chef_profile_id returning preferred_language into chosen;
  else
    update public.customer_profiles
      set preferred_language=case when p_only_if_unset then coalesce(preferred_language,p_language) else p_language end
      where id=current_member.customer_profile_id returning preferred_language into chosen;
  end if;
  if chosen is null then raise exception 'not_member' using errcode='42501'; end if;
  return chosen;
end $$;
revoke all on function public.set_language_preference(text,boolean) from public,anon;
grant execute on function public.set_language_preference(text,boolean) to authenticated;

-- Either language may be the sole name. Keep real translations separate rather
-- than copying Chinese into the English field. Request snapshots use the same rule.
alter table public.categories drop constraint if exists categories_name_check;
alter table public.categories add constraint categories_name_check
  check(length(btrim(name))<=60 and (length(btrim(name))>0 or length(btrim(name_zh))>0));
alter table public.dishes drop constraint if exists dishes_name_check;
alter table public.dishes add constraint dishes_name_check
  check(length(btrim(name))<=100 and (length(btrim(name))>0 or length(btrim(name_zh))>0));
alter table public.requests drop constraint if exists requests_name_check;
alter table public.requests add constraint requests_name_check
  check(length(btrim(name))<=100 and (length(btrim(name))>0 or length(btrim(name_zh))>0));

notify pgrst,'reload schema';
commit;
