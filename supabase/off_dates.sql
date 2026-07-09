-- Выходные дни программы (управляются владельцем в админке).
-- Выполнить ОДИН РАЗ в Supabase → SQL Editor. Безопасно, ничего не удаляет.
-- Дата в формате "ГГГГ-ММ-ДД" по Москве. В эти дни новый урок не открывается, расписание сдвигается вперёд.

create table if not exists public.off_dates (
  date text primary key
);

alter table public.off_dates enable row level security;

-- читать могут все участники (расписание сдвигается у всех)
drop policy if exists off_dates_read on public.off_dates;
create policy off_dates_read on public.off_dates
  for select to authenticated using (true);

-- добавлять и убирать могут только админы
drop policy if exists off_dates_write on public.off_dates;
create policy off_dates_write on public.off_dates
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
