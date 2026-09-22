-- Run after 001–006. Extend chef deletion to cancelled requests in History.
-- Applying this migration does not delete any existing data. Safe to re-run.
begin;

create or replace function public.delete_wishlist_request(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare chef_kitchen uuid; r public.requests;
begin
  select kitchen_id into chef_kitchen from public.members
    where user_id=auth.uid() and role='chef';
  if not found then raise exception 'not_allowed' using errcode='42501'; end if;

  -- Lock the same row used by status updates. A stale card cannot delete a
  -- request that another device has already completed.
  select * into r from public.requests where id=p_id and kitchen_id=chef_kitchen for update;
  if not found then return; end if; -- Retrying a successful deletion is harmless.
  if r.status not in ('pending','cancelled') then raise exception 'request_not_deletable'; end if;
  delete from public.requests where id=r.id;
end $$;
revoke all on function public.delete_wishlist_request(uuid) from public,anon;
grant execute on function public.delete_wishlist_request(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
