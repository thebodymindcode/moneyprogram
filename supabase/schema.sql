-- ============================================================
--  Протокол денег, схема базы для Supabase
--  Запусти весь этот файл в Supabase: раздел SQL Editor,
--  вставь, нажми Run. Скрипт можно запускать повторно,
--  он не ломает уже созданное (idempotent).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Таблицы
-- ------------------------------------------------------------

-- Профиль пользователя (1 к 1 с auth.users)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text,
  email      text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- Общий контент: дни курса
create table if not exists public.days (
  day_number   int primary key check (day_number between 1 and 1000),
  title        text not null,
  lesson       text not null default '',
  audio_url    text,
  duration_min numeric not null default 0
);

-- Общий контент: задания дней
create table if not exists public.tasks (
  id         uuid primary key default gen_random_uuid(),
  day_number int not null references public.days(day_number) on delete cascade,
  position   int not null,
  text       text not null,
  constraint tasks_day_position_unique unique (day_number, position)
);

-- Личное: пройден ли день
create table if not exists public.progress (
  user_id      uuid not null references auth.users(id) on delete cascade,
  day_number   int  not null references public.days(day_number) on delete cascade,
  completed    boolean not null default false,
  completed_at timestamptz,
  primary key (user_id, day_number)
);

-- Личное: ответы на задания
create table if not exists public.task_answers (
  user_id    uuid not null references auth.users(id) on delete cascade,
  task_id    uuid not null references public.tasks(id) on delete cascade,
  answer     text not null default '',
  done       boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

-- Личное: заметки дня
create table if not exists public.notes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  day_number int  not null references public.days(day_number) on delete cascade,
  text       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, day_number)
);

-- ------------------------------------------------------------
-- 2. Автосоздание профиля при регистрации
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Проверка админа (security definer, чтобы не было рекурсии в RLS)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ------------------------------------------------------------
-- 3. Включаем защиту строк (RLS)
-- ------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.days         enable row level security;
alter table public.tasks        enable row level security;
alter table public.progress     enable row level security;
alter table public.task_answers enable row level security;
alter table public.notes        enable row level security;

-- ------------------------------------------------------------
-- 4. Политики доступа
-- ------------------------------------------------------------

-- profiles: только своя запись
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (auth.uid() = id);

-- days: читают все вошедшие, меняет только админ
drop policy if exists days_select_auth on public.days;
create policy days_select_auth on public.days
  for select to authenticated using (true);

drop policy if exists days_admin_write on public.days;
create policy days_admin_write on public.days
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- tasks: читают все вошедшие, меняет только админ
drop policy if exists tasks_select_auth on public.tasks;
create policy tasks_select_auth on public.tasks
  for select to authenticated using (true);

drop policy if exists tasks_admin_write on public.tasks;
create policy tasks_admin_write on public.tasks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- progress: только свои строки
drop policy if exists progress_own on public.progress;
create policy progress_own on public.progress
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- task_answers: только свои строки
drop policy if exists task_answers_own on public.task_answers;
create policy task_answers_own on public.task_answers
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- notes: только свои строки
drop policy if exists notes_own on public.notes;
create policy notes_own on public.notes
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 5. Наполнение: 17 дней и задания (как в прототипе)
-- ------------------------------------------------------------
insert into public.days (day_number, title, lesson, audio_url, duration_min) values
(1,  'Что на самом деле стоит под твоими деньгами', 'Деньги это не только цифры на счёте. За каждым денежным решением стоит твоё состояние и привычки мозга. В этом уроке смотрим, с чего начинается перенастройка и почему сила воли тут почти ни при чём.', null, 7),
(2,  'Денежная тревога и откуда она берётся', 'Тревога вокруг денег это работа древних участков мозга, которые путают пустой счёт с реальной опасностью. Разбираем механизм, чтобы перестать принимать решения из страха.', null, 8),
(3,  'Сканер трат: куда уходит внимание и деньги', 'Большая часть трат проходит на автопилоте. Сегодня включаем наблюдателя и просто смотрим, без вины и контроля, куда реально утекают деньги за день.', null, 6.5),
(4,  'Денежные правила из детства', 'Подсознание хранит правила о деньгах, услышанные в детстве, и тихо управляет выбором взрослого. Находим эти правила и проверяем, твои ли они вообще.', null, 8.5),
(5,  'Состояние, из которого ты принимаешь решения о деньгах', 'Из спокойствия и из паники человек принимает разные финансовые решения. Учимся замечать своё состояние перед денежным выбором и возвращать ясную голову.', null, 7.5),
(6,  'Тело и деньги: как стресс мешает зарабатывать', 'Хронический стресс держит тело в режиме защиты, и на смелые денежные шаги просто не остаётся ресурса. Связываем телесное напряжение с финансовыми тормозами.', null, 7),
(7,  'Гормоны спокойствия и ясная голова', 'Кортизол сужает мышление, дофамин и серотонин возвращают ясность и интерес. Простыми привычками влияем на химию мозга, чтобы думать о деньгах спокойно.', null, 8),
(8,  'Тревога уходит: новая база', 'Собираем первую неделю в опору. Тревоги стало меньше, появилось место для решений. Закрепляем спокойное отношение к деньгам как новую точку отсчёта.', null, 6),
(9,  'Внутренний предел дохода', 'У каждого есть невидимый потолок: сумма, выше которой становится некомфортно. Сегодня нащупываем свой предел и смотрим, что стоит прямо под ним.', null, 8.5),
(10, 'Образ себя и сколько ты себе разрешаешь', 'Доход почти всегда совпадает с тем, каким человек себя считает. Работаем с образом себя, потому что деньги приходят к той версии тебя, которой ты разрешаешь быть.', null, 8),
(11, 'Право называть цену', 'Назвать цену без извинений это навык, а не дерзость. Разбираем, почему сложно говорить о деньгах вслух, и тренируем спокойно называть свою стоимость.', null, 7.5),
(12, 'Новый масштаб: кем ты становишься', 'Большие деньги это про более крупную версию себя, а не про больше суеты. Примеряем новый масштаб мышления и решений, к которому идём вторую половину пути.', null, 8.5),
(13, 'Первый источник денег: то, что ты берёшь сам', 'Первый поток это результат твоих действий: работа, услуги, дело. Смотрим, где ты сам можешь усилить этот источник без перегруза.', null, 8),
(14, 'Второй источник: деньги через других людей', 'Второй поток приходит через людей: рекомендации, партнёрства, доверие. Деньги любят связи, и сегодня смотрим на свою сеть как на ресурс.', null, 7.5),
(15, 'Доверие и денежный поток между людьми', 'Там, где есть доверие, деньги двигаются легче. Разбираем, как открытость и репутация превращаются в стабильный поток, и убираем лишнюю закрытость.', null, 7),
(16, 'Сборка системы на каждый день', 'Чтобы новое отношение к деньгам осталось, нужен простой ежедневный ритм. Собираем привычки сознания, тела и решений в короткую рабочую систему.', null, 6.5),
(17, 'Закрепляем новую норму', 'Финал пути. Спокойствие, ясные решения и два источника денег становятся твоей нормой, а не разовым усилием. Фиксируем результат и образ себя дальше.', null, 6)
on conflict (day_number) do update
  set title = excluded.title,
      lesson = excluded.lesson,
      audio_url = excluded.audio_url,
      duration_min = excluded.duration_min;

insert into public.tasks (day_number, position, text) values
(1,1,'Записать первую мысль, которая приходит при слове «деньги»'),
(1,2,'Назвать одну денежную ситуацию, которую хочется изменить'),
(2,1,'Заметить момент, когда деньги вызвали тревогу'),
(2,2,'Описать, что чувствует тело в этот момент'),
(3,1,'Записать все траты за сегодня'),
(3,2,'Отметить одну трату, которая была на автомате'),
(4,1,'Вспомнить 3 фразы о деньгах из семьи'),
(4,2,'Отметить, какая мешает прямо сейчас'),
(4,3,'Переписать одну фразу в поддерживающую'),
(5,1,'Перед любой покупкой сделать паузу на 3 вдоха'),
(5,2,'Назвать своё состояние словом до решения'),
(6,1,'Найти, где в теле живёт денежное напряжение'),
(6,2,'Сделать одно действие, которое снимает стресс'),
(7,1,'Добавить в день одну привычку на спокойствие'),
(7,2,'Заметить, как меняются мысли о деньгах после неё'),
(8,1,'Отметить, что в деньгах стало спокойнее'),
(8,2,'Назвать одно денежное решение, принятое без паники'),
(9,1,'Назвать сумму, выше которой становится тревожно'),
(9,2,'Описать страх, который прячется за этим пределом'),
(10,1,'Описать себя через год в деньгах'),
(10,2,'Выбрать одну черту этой версии и прожить её сегодня'),
(11,1,'Сформулировать свою ценность одной фразой'),
(11,2,'Назвать цену вслух, без оправданий'),
(12,1,'Записать цель, которая чуть больше привычной'),
(12,2,'Сделать один маленький шаг в её сторону сегодня'),
(13,1,'Назвать, что приносит тебе деньги напрямую'),
(13,2,'Выбрать одно действие, которое усилит этот доход'),
(14,1,'Назвать 3 человек, через которых уже приходили деньги'),
(14,2,'Написать одному человеку с понятным предложением'),
(15,1,'Сделать одно действие, которое укрепляет доверие'),
(15,2,'Поблагодарить человека, который помог тебе с деньгами'),
(16,1,'Выбрать 3 ежедневные денежные привычки'),
(16,2,'Назначить им место в дне'),
(17,1,'Записать, что изменилось в деньгах за 17 дней'),
(17,2,'Выбрать одно правило, которое оставляешь навсегда')
on conflict (day_number, position) do update
  set text = excluded.text;

-- Готово. Контент и права настроены, профиль создаётся автоматически.
