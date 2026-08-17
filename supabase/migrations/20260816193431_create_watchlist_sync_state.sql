create table if not exists public.watchlist_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text,
  created_at timestamptz not null default now()
);

alter table public.watchlist_state enable row level security;

create policy "watchlist_state_select_own"
on public.watchlist_state
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.save_watchlist_state(
  p_state jsonb,
  p_expected_revision bigint,
  p_device_id text default null
)
returns table (
  state jsonb,
  revision bigint,
  updated_at timestamptz,
  updated_by text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_exists boolean;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select exists(
    select 1 from public.watchlist_state s where s.user_id = v_user_id
  ) into v_exists;

  if not v_exists then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'revision_conflict';
    end if;

    return query
    insert into public.watchlist_state as s(user_id, state, revision, updated_at, updated_by)
    values (v_user_id, coalesce(p_state, '{}'::jsonb), 1, now(), nullif(p_device_id, ''))
    returning s.state, s.revision, s.updated_at, s.updated_by;
    return;
  end if;

  return query
  update public.watchlist_state as s
     set state = coalesce(p_state, '{}'::jsonb),
         revision = s.revision + 1,
         updated_at = now(),
         updated_by = nullif(p_device_id, '')
   where s.user_id = v_user_id
     and s.revision = p_expected_revision
  returning s.state, s.revision, s.updated_at, s.updated_by;

  if not found then
    raise exception 'revision_conflict';
  end if;
end;
$$;

revoke all on function public.save_watchlist_state(jsonb, bigint, text) from public;
grant execute on function public.save_watchlist_state(jsonb, bigint, text) to authenticated;

-- Realtime subscription for cross-device updates.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'watchlist_state'
  ) then
    alter publication supabase_realtime add table public.watchlist_state;
  end if;
end;
$$;
