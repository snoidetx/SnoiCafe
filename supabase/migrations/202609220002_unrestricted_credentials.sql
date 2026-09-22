-- Run after 202609220001_kitchen.sql. Safe to re-run on an existing kitchen.
-- Existing credentials and sessions remain valid. No application length limits.
begin;

-- Pre-hash the complete UTF-8 input with a per-hash salt before bcrypt, so bcrypt
-- never truncates long/Chinese credentials. The printable SHA-256 output is 64
-- ASCII bytes. A format marker distinguishes this from legacy raw bcrypt hashes.
-- Salt-keyed HMAC follows the bcrypt-sha256 v2 approach documented by Passlib:
-- https://passlib.readthedocs.io/en/stable/lib/passlib.hash.bcrypt_sha256.html
-- Our SnoiCafe-specific encoding is not the Passlib wire format.
create or replace function private.hash_credential(p_value text) returns text
language plpgsql volatile set search_path='' as $$
declare salt text; prepared text;
begin
  if p_value is null or p_value='' then raise exception 'empty_credential'; end if;
  salt=extensions.gen_salt('bf',10);
  prepared=encode(extensions.hmac(convert_to(p_value,'UTF8'),convert_to('SnoiCafe v1:'||salt,'UTF8'),'sha256'),'hex');
  return 'snoi-v1$'||extensions.crypt(prepared,salt);
end $$;

create or replace function private.verify_credential(p_value text,p_hash text) returns boolean
language plpgsql immutable set search_path='' as $$
declare encoded text; salt text; prepared text;
begin
  if p_value is null or p_value='' or p_hash is null then return false; end if;
  if left(p_hash,8)='snoi-v1$' then
    encoded=substring(p_hash from 9);
    salt=left(encoded,29);
    prepared=encode(extensions.hmac(convert_to(p_value,'UTF8'),convert_to('SnoiCafe v1:'||salt,'UTF8'),'sha256'),'hex');
    return extensions.crypt(prepared,encoded)=encoded;
  end if;
  -- Legacy setup never accepted inputs beyond bcrypt's byte limit. Reject a
  -- longer candidate instead of accepting a matching truncated prefix.
  if octet_length(p_value)>72 then return false; end if;
  return extensions.crypt(p_value,p_hash)=p_hash;
end $$;
revoke all on function private.hash_credential(text),private.verify_credential(text,text) from public,anon,authenticated;

create or replace function public.unlock_kitchen(p_code text,p_name text,p_as_chef boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare secret private.access_secrets; attempt private.unlock_attempts; expected text; actor uuid=auth.uid();
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
  insert into public.members(kitchen_id,user_id,display_name,role)
  values(secret.kitchen_id,actor,trim(p_name),case when p_as_chef then 'chef' else 'customer' end)
  on conflict(kitchen_id,user_id) do update set display_name=excluded.display_name,role=excluded.role;
  delete from private.unlock_attempts where user_id=actor;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.change_access_codes(p_kitchen_code text default null,p_chef_password text default null)
returns void language plpgsql security definer set search_path='' as $$
declare secret private.access_secrets;
begin
  select s.* into secret from private.access_secrets s where private.is_chef(s.kitchen_id) for update;
  if not found then raise exception 'not_allowed' using errcode='42501'; end if;
  if p_kitchen_code='' then raise exception 'empty_credential'; end if;
  if p_chef_password='' then raise exception 'empty_credential'; end if;
  if (p_kitchen_code is not null and p_chef_password is not null and p_kitchen_code=p_chef_password)
     or (p_kitchen_code is not null and p_chef_password is null and private.verify_credential(p_kitchen_code,secret.chef_hash))
     or (p_chef_password is not null and p_kitchen_code is null and private.verify_credential(p_chef_password,secret.kitchen_hash)) then raise exception 'different_codes'; end if;
  if p_kitchen_code is not null then
    update private.access_secrets set kitchen_hash=private.hash_credential(p_kitchen_code) where kitchen_id=secret.kitchen_id;
    delete from public.members where kitchen_id=secret.kitchen_id and role='customer';
  end if;
  if p_chef_password is not null then
    update private.access_secrets set chef_hash=private.hash_credential(p_chef_password) where kitchen_id=secret.kitchen_id;
    delete from public.members where kitchen_id=secret.kitchen_id and role='chef' and user_id<>auth.uid();
  end if;
end $$;

create or replace function public.bootstrap_kitchen(p_chef_password text,p_kitchen_code text,p_name text default 'SnoiCafe') returns uuid
language plpgsql security definer set search_path='' as $$
declare k uuid;
begin
  if p_chef_password is null or p_chef_password='' then raise exception 'empty_credential'; end if;
  if p_kitchen_code is null or p_kitchen_code='' then raise exception 'empty_credential'; end if;
  if p_chef_password=p_kitchen_code then raise exception 'different_codes'; end if;
  insert into public.kitchens(name) values(p_name) returning id into k;
  insert into private.access_secrets(kitchen_id,kitchen_hash,chef_hash)
  values(k,private.hash_credential(p_kitchen_code),private.hash_credential(p_chef_password));
  insert into public.categories(kitchen_id,name,name_zh,emoji,position) values(k,'Chinese','中餐','🥟',0),(k,'Western','西餐','🍝',1),(k,'Snacks','小吃','🥐',2),(k,'Drinks','饮品','🍵',3);
  return k;
end $$;
revoke all on function public.bootstrap_kitchen(text,text,text) from public,anon,authenticated;

revoke all on function public.unlock_kitchen(text,text,boolean),public.change_access_codes(text,text) from public,anon;
grant execute on function public.unlock_kitchen(text,text,boolean),public.change_access_codes(text,text) to authenticated;
commit;
