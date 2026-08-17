create policy "watchlist_state_insert_own"
on public.watchlist_state
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "watchlist_state_update_own"
on public.watchlist_state
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

alter function public.save_watchlist_state(jsonb, bigint, text) security invoker;
revoke all on function public.save_watchlist_state(jsonb, bigint, text) from public;
revoke all on function public.save_watchlist_state(jsonb, bigint, text) from anon;
grant execute on function public.save_watchlist_state(jsonb, bigint, text) to authenticated;
