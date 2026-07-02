-- Лог клиентских ошибок «Протокола денег».
-- Приложение тихо пишет сюда сбои (window.error, unhandledrejection, ошибки сохранения, ошибки входа),
-- админ смотрит. Запусти один раз в SQL-редакторе Supabase.

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null default auth.uid(),
  context     text,
  message     text,
  detail      text,
  url         text,
  ua          text
);

alter table public.client_errors enable row level security;

-- писать может кто угодно (в т.ч. до входа, чтобы ловить ошибки на экране входа)
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors
  for insert to anon, authenticated with check (true);

-- читать только админ
drop policy if exists client_errors_read on public.client_errors;
create policy client_errors_read on public.client_errors
  for select to authenticated using (public.is_admin());

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);
