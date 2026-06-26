-- ------------------------------------------------------------
-- Отметки состояния по дням: где человек между тревогой и спокойствием.
-- value: 0 = тревожно … 10 = спокойно. Одна отметка на день.
-- Запусти этот файл один раз в Supabase → SQL Editor.
-- ------------------------------------------------------------
create table if not exists public.checkins (
  user_id    uuid        not null references auth.users(id)        on delete cascade,
  day_number int         not null references public.days(day_number) on delete cascade,
  value      smallint    not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, day_number)
);

alter table public.checkins enable row level security;

-- свои строки и только если e-mail в списке участников (как у notes / task_answers)
drop policy if exists checkins_own on public.checkins;
create policy checkins_own on public.checkins
  for all to authenticated
  using      (auth.uid() = user_id and public.current_email_allowed())
  with check (auth.uid() = user_id and public.current_email_allowed());
