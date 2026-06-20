-- ============================================================
--  Протокол денег, аудио уроков в Supabase Storage
--  Запусти весь этот файл в Supabase: раздел SQL Editor,
--  вставь, нажми Run. Скрипт можно запускать повторно,
--  он не ломает уже созданное (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Приватный бакет для аудио уроков
--    public = false: по прямой ссылке файл не отдаётся,
--    слушать можно только через подписанную ссылку,
--    которую приложение выдаёт залогиненному участнику.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('lesson-audio', 'lesson-audio', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 2. Имя загруженного файла для показа в админке
-- ------------------------------------------------------------
alter table public.days add column if not exists audio_name text;

-- ------------------------------------------------------------
-- 3. Политики доступа к файлам бакета lesson-audio
--    (RLS на storage.objects Supabase включает сам)
-- ------------------------------------------------------------

-- слушать: допущенный в программу участник или админ
drop policy if exists lesson_audio_read on storage.objects;
create policy lesson_audio_read on storage.objects
  for select to authenticated
  using (bucket_id = 'lesson-audio'
         and (public.current_email_allowed() or public.is_admin()));

-- загружать: только админ
drop policy if exists lesson_audio_insert on storage.objects;
create policy lesson_audio_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lesson-audio' and public.is_admin());

-- перезаписывать: только админ
drop policy if exists lesson_audio_update on storage.objects;
create policy lesson_audio_update on storage.objects
  for update to authenticated
  using (bucket_id = 'lesson-audio' and public.is_admin())
  with check (bucket_id = 'lesson-audio' and public.is_admin());

-- удалять: только админ
drop policy if exists lesson_audio_delete on storage.objects;
create policy lesson_audio_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'lesson-audio' and public.is_admin());

-- Готово. Бакет приватный, грузит только админ, слушает только участник из списка.
