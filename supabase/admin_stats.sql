-- ============================================================
--  Протокол денег: доступ админам к разделу «Статистика участников»
--  Разрешаем e-mail из таблицы admins читать профили и прогресс
--  ВСЕХ участников. Только чтение.
--  Личные ответы (task_answers) и заметки (notes) НЕ затрагиваются
--  и остаются приватными.
--
--  Политики добавляются ПОВЕРХ существующих (permissive, через OR),
--  ничего не ломают и не меняют права обычных участников.
--  Запуск: Supabase → SQL Editor → вставь → Run. Можно повторно.
-- ============================================================

-- профили всех участников видны админу (имя, e-mail, прогресс)
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated using (public.is_admin());

-- прогресс всех участников виден админу (какие дни закрыты и когда)
drop policy if exists progress_select_admin on public.progress;
create policy progress_select_admin on public.progress
  for select to authenticated using (public.is_admin());

-- Готово. Обнови приложение, открой вкладку «Статистика».
