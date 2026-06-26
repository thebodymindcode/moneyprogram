const { useState, useEffect, useMemo, useRef, useCallback, memo } = React;

/* ========================= helpers ========================= */
const sb = window.sb; // единый клиент Supabase (создан в supabaseClient.js)
const nowISO = () => new Date().toISOString();

/* ----- аудио уроков в Supabase Storage ----- */
const AUDIO_BUCKET = "lesson-audio";
const MAX_AUDIO_MB = 50;                                   // разумный лимит размера файла
const AUDIO_EXT = ["mp3", "m4a", "wav", "ogg"];            // поддерживаемые форматы
const SIGNED_TTL = 60 * 60 * 6;                            // ссылка на аудио живёт 6 часов

const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const extOf = (name) => (String(name).split(".").pop() || "").toLowerCase();
// безопасное имя файла для пути в хранилище (латиница, цифры, дефис, точка)
const slugFile = (name) => String(name).toLowerCase().replace(/[^a-z0-9.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "audio";

const AUDIO_MIME = { mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// подписанная ссылка на приватный файл (работает только у залогиненного участника из списка).
// С повторами: на свежей загрузке страницы токен Supabase может ещё обновляться,
// и первая попытка подписи уходит со старым токеном, хранилище отвечает ошибкой.
// Поэтому сначала дожидаемся готовой сессии, и при сбое пробуем ещё пару раз с паузой.
async function signedAudioUrl(path, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      await sb.auth.getSession();   // дать клиенту дойти до актуального токена
      const { data, error } = await sb.storage.from(AUDIO_BUCKET).createSignedUrl(path, SIGNED_TTL);
      if (error) throw error;
      if (data && data.signedUrl) return data.signedUrl;
      throw new Error("пустая ссылка на аудио");
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(500 * (i + 1));   // 0.5с, 1с
    }
  }
  throw lastErr || new Error("не удалось подписать ссылку");
}

// прочитать длительность аудио из локального файла (до загрузки), в секундах
function readAudioDuration(file) {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement("audio");
      a.preload = "metadata";
      a.onloadedmetadata = () => { const d = a.duration; URL.revokeObjectURL(url); resolve(isFinite(d) ? d : 0); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
      a.src = url;
    } catch (e) { resolve(0); }
  });
}

// загрузка файла в Storage через REST, с реальным прогрессом (supabase-js прогресс не отдаёт)
function uploadAudioFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    sb.auth.getSession().then(({ data }) => {
      const token = data && data.session && data.session.access_token;
      if (!token) return reject(new Error("Сессия истекла. Войди заново и повтори загрузку."));
      const url = window.SUPABASE_URL + "/storage/v1/object/" + AUDIO_BUCKET + "/" + path;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.setRequestHeader("x-upsert", "true");
      // верный content-type, чтобы браузер потом нормально проигрывал и перематывал.
      // У m4a/ogg file.type иногда пустой, поэтому берём по расширению.
      const ctype = file.type || AUDIO_MIME[extOf(file.name)] || "application/octet-stream";
      xhr.setRequestHeader("Content-Type", ctype);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(true);
        else if (xhr.status === 403) reject(new Error("Нет прав на загрузку. Проверь, что ты в списке админов и запущен storage_audio.sql."));
        else reject(new Error("Хранилище вернуло " + xhr.status + ". " + (xhr.responseText || "")));
      };
      xhr.onerror = () => reject(new Error("Сеть подвела при загрузке. Проверь интернет и повтори."));
      xhr.send(file);
    }).catch(reject);
  });
}

const dayWord = (n) => {
  const a = Math.abs(n) % 100, b = n % 10;
  if (a > 10 && a < 20) return "дней";
  if (b > 1 && b < 5) return "дня";
  if (b === 1) return "день";
  return "дней";
};
const taskWord = (n) => {
  const a = Math.abs(n) % 100, b = n % 10;
  if (a > 10 && a < 20) return "заданий";
  if (b > 1 && b < 5) return "задания";
  if (b === 1) return "задание";
  return "заданий";
};

// собрать контент дней из базы вместе с личными ответами и заметками пользователя
async function loadDaysFromDb() {
  const [daysRes, tasksRes, ansRes, notesRes] = await Promise.all([
    sb.from("days").select("*").order("day_number", { ascending: true }),
    sb.from("tasks").select("*").order("day_number", { ascending: true }).order("position", { ascending: true }),
    sb.from("task_answers").select("*"),
    sb.from("notes").select("*"),
  ]);
  if (daysRes.error) throw daysRes.error;
  if (tasksRes.error) throw tasksRes.error;
  const ansMap = {}; (ansRes.data || []).forEach((a) => { ansMap[a.task_id] = a; });
  const noteMap = {}; (notesRes.data || []).forEach((n) => { noteMap[n.day_number] = n.text; });
  return (daysRes.data || []).map((d) => ({
    id: d.day_number,
    title: d.title,
    lesson: d.lesson || "",
    duration: Math.round((Number(d.duration_min) || 0) * 60),
    audioPath: d.audio_url || "",                 // путь к файлу в Storage
    audioName: d.audio_name || "",                // имя файла для показа в админке
    note: noteMap[d.day_number] || "",
    tasks: (tasksRes.data || [])
      .filter((t) => t.day_number === d.day_number)
      .map((t) => ({
        id: t.id,
        text: t.text,
        done: !!(ansMap[t.id] && ansMap[t.id].done),
        answer: (ansMap[t.id] && ansMap[t.id].answer) || "",
      })),
  }));
}

const NOT_ALLOWED_MSG = "Этот e-mail не в списке участников программы. Доступ открывается после оплаты.";

// понятные сообщения об ошибках входа
function authErrorText(e) {
  const m = ((e && e.message) || "").toLowerCase();
  if (m.includes("email_not_allowed") || m.includes("not allowed") || m.includes("saving new user") || m.includes("database error")) return NOT_ALLOWED_MSG;
  if (m.includes("invalid login")) return "Неверная почта или пароль.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Такая почта уже зарегистрирована.";
  if (m.includes("email not confirmed")) return "Почта не подтверждена. Загляни в письмо от Supabase.";
  if (m.includes("at least 6") || m.includes("password should be")) return "Пароль должен быть не короче 6 символов.";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "Проверь, правильно ли введена почта.";
  if (m.includes("rate limit") || m.includes("too many")) return "Слишком много попыток, попробуй чуть позже.";
  return "Не получилось. Попробуй ещё раз.";
}

const isDayDone = (d) => d.tasks.length > 0 && d.tasks.every((t) => t.done);
const dayProgress = (d) => (d.tasks.length ? d.tasks.filter((t) => t.done).length : 0);
const fmt = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); const r = s % 60; return m + ":" + String(r).padStart(2, "0"); };
const durLabel = (s) => Math.round(s / 60) + " мин";

// 5 смысловых этапов пути
const STAGES = [
  { from: 1, to: 4, name: "Снимаем тревогу", hint: "Личная причина, тревога, привычки трат и правила из детства." },
  { from: 5, to: 8, name: "Меняем состояние", hint: "Состояние, тело, гормоны и новая опора." },
  { from: 9, to: 12, name: "Сдвигаем внутренний предел", hint: "Предел дохода и образ себя." },
  { from: 13, to: 15, name: "Открываем источники денег", hint: "Берёшь сам, через других людей, доверие и поток." },
  { from: 16, to: 17, name: "Закрепляем", hint: "Сборка системы и новая норма." },
];
const stageOf = (dayId) => { const i = STAGES.findIndex((s) => dayId >= s.from && dayId <= s.to); return i === -1 ? STAGES.length - 1 : i; };
const lower1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/* ===== открытие дней по календарю ===== */
const DAY_MS = 86400000;
const cfg = () => window.APP_CONFIG || {};
// момент старта (День 1) в UTC, исходя из даты старта, часа открытия и часового пояса
function startInstant() {
  const c = cfg();
  const p = String(c.START_DATE || "2026-07-01").split("-").map(Number);
  return Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1, (c.OPEN_HOUR || 0) - (c.TZ_OFFSET_HOURS || 0), 0, 0);
}
// сколько дней уже открыто (в тестовом режиме все)
function unlockedCountNow(total) {
  if (cfg().TEST_OPEN_ALL) return total;
  const elapsed = Date.now() - startInstant();
  if (elapsed < 0) return 0;
  return Math.max(0, Math.min(total, Math.floor(elapsed / DAY_MS) + 1));
}
// подпись «Откроется ДД.ММ в 8:00» для закрытого дня
function unlockLabel(dayNumber) {
  const c = cfg();
  const local = new Date(startInstant() + (dayNumber - 1) * DAY_MS + (c.TZ_OFFSET_HOURS || 0) * 3600000);
  const dd = String(local.getUTCDate()).padStart(2, "0");
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
  const h = c.OPEN_HOUR == null ? 8 : c.OPEN_HOUR;
  return "Откроется " + dd + "." + mm + " в " + h + ":00";
}
// первый невыполненный среди открытых дней (это и есть «сегодня»)
function computeCurrentIndex(days, unlockedCount) {
  for (let i = 0; i < days.length; i++) {
    if (i + 1 <= unlockedCount && !isDayDone(days[i])) return i;
  }
  return Math.max(0, Math.min(days.length - 1, unlockedCount - 1));
}
// статус дня. Доступ строго по порядку: открыть можно только пройденные дни и сегодняшний.
// done   — пройден (можно вернуться)
// today  — сегодняшний, открыт
// next   — следующий: видно название, минуты и число заданий, но пока закрыт
// hidden — дальше по программе: название и тема спрятаны, чтобы не забегать вперёд
// isAdmin: админу всё открыто и видно (для проверки уроков)
function dayStatus(d, i, unlockedCount, currentIndex, isAdmin) {
  if (isDayDone(d)) return "done";
  if (i <= currentIndex) return (i + 1 <= unlockedCount || isAdmin) ? "today" : "next";
  if (isAdmin) return "open";                 // админ: все остальные дни доступны
  if (i === currentIndex + 1) return "next";
  return "hidden";
}
const STATUS_LABEL = { done: "Пройден", today: "Сегодня", open: "Доступен", next: "Следующий", hidden: "Закрыто" };
// можно ли открыть день: пройденный, сегодняшний или открытый админу
const dayOpenable = (status) => status === "done" || status === "today" || status === "open";
// подпись под закрытым днём: до старта по календарю показываем дату, иначе по порядку прохождения
function lockLine(status, d, unlockedCount) {
  if (d.id > unlockedCount) return unlockLabel(d.id);
  if (status === "next") return "Откроется сразу после дня " + (d.id - 1);
  return "Откроется в свой день, идём по шагам";
}

/* ========================= icons ========================= */
const Ico = {
  check: (p) => <svg viewBox="0 0 24 24" width="15" height="15" {...p}><path d="M5 13l4 4L19 7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  chev: (p) => <svg viewBox="0 0 24 24" width="20" height="20" {...p}><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  back: (p) => <svg viewBox="0 0 24 24" width="17" height="17" {...p}><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  home: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>,
  map: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="6" cy="7" r="2.2"/><circle cx="18" cy="17" r="2.2"/><path d="M6 9.2v3.3a3 3 0 003 3h6"/></svg>,
  cog: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.6 1.6 0 00.3 1.7l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H3a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.7.3 1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.7-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.7V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/></svg>,
  lock: (p) => <svg viewBox="0 0 24 24" width="18" height="18" {...p}><path d="M7 11V8a5 5 0 0110 0v3" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"/><rect x="4.4" y="10.4" width="15.2" height="11.2" rx="3.6" fill="currentColor"/><circle cx="12" cy="14.8" r="1.7" fill="#fff"/><path d="M11.2 15.5h1.6l-.42 3a.38.38 0 01-.76 0z" fill="#fff"/></svg>,
  play: (p) => <svg viewBox="0 0 24 24" width="22" height="22" {...p}><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>,
  pause: (p) => <svg viewBox="0 0 24 24" width="22" height="22" {...p}><rect x="7" y="5" width="3.4" height="14" rx="1.2" fill="currentColor"/><rect x="13.6" y="5" width="3.4" height="14" rx="1.2" fill="currentColor"/></svg>,
  wave: (p) => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M4 12h2M9 8v8M14 5v14M19 9v6"/></svg>,
  speed: (p) => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 21a9 9 0 1 0-9-9"/><path d="M12 12l4-3.5"/><path d="M3 12H1.5M5 7l-1-1"/></svg>,
  upload: (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 19h14"/></svg>,
  out: (p) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 7V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2h6a2 2 0 002-2v-2"/><path d="M18 15l3-3-3-3M21 12H9"/></svg>,
  book: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 4h11a2 2 0 012 2v14H7a2 2 0 01-2-2z"/><path d="M5 4a2 2 0 00-2 2v12a2 2 0 002 2"/><path d="M9 8h6M9 12h6"/></svg>,
  mind: (p) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 4.5a3 3 0 00-3 3v9a3 3 0 003 3"/><path d="M12 4.5a3 3 0 013 3v9a3 3 0 01-3 3"/><path d="M9 8.5H7.5a2 2 0 000 4H9M15 8.5h1.5a2 2 0 010 4H15"/></svg>,
  layers: (p) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>,
  body: (p) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="6" r="3"/><path d="M5 21c0-4 3.1-7 7-7s7 3 7 7"/></svg>,
  drop: (p) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3.2s6 5.7 6 9.8a6 6 0 01-12 0c0-4.1 6-9.8 6-9.8z"/></svg>,
  chart: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 21h18"/><rect x="5" y="11" width="3.2" height="7" rx="1"/><rect x="10.4" y="6.5" width="3.2" height="11.5" rx="1"/><rect x="15.8" y="13.5" width="3.2" height="4.5" rx="1"/></svg>,
  info: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/></svg>,
  // единый набор тонких иконок для раздела «Инструкция» (одна линия, stroke 1.7, 24px)
  compass: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="8.5"/><path d="M14.9 9.1l-1.7 4.1-4.1 1.7 1.7-4.1z"/></svg>,
  login: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3"/><path d="M10 16l4-4-4-4"/><path d="M14 12H4"/></svg>,
  grid: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/></svg>,
  calday: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3.5" y="5" width="17" height="15.5" rx="2.6"/><path d="M3.5 9.5h17"/><path d="M8 3.3v3M16 3.3v3"/><path d="M8.3 14.4l2.4 2.4 4.8-4.8"/></svg>,
  phones: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 13.5v-1.5a8 8 0 0116 0v1.5"/><rect x="3" y="13" width="4.2" height="6.5" rx="1.6"/><rect x="16.8" y="13" width="4.2" height="6.5" rx="1.6"/></svg>,
  doc: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6.5 3.5h6.5l4.5 4.5V20a1 1 0 01-1 1H6.5a1 1 0 01-1-1V4.5a1 1 0 011-1z"/><path d="M13 3.5V9h5"/><path d="M9 13.5h6M9 16.5h4"/></svg>,
  checksq: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="4" y="4" width="16" height="16" rx="3.4"/><path d="M8.4 12.2l2.5 2.5 4.7-5"/></svg>,
  pen: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14.3 5.6l4.1 4.1"/><path d="M4 20l1.1-4.2L16 5a2.05 2.05 0 012.9 2.9L8 18.9 4 20z"/></svg>,
  sunrise: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 19h18"/><path d="M7.5 19a4.5 4.5 0 019 0"/><path d="M12 3.5v4.5"/><path d="M4.6 11.2l1.5 1.5M19.4 11.2l-1.5 1.5"/></svg>,
  shield: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3.4l7 3v4.8c0 4.2-2.9 7.7-7 9.1-4.1-1.4-7-4.9-7-9.1V6.4z"/><path d="M9 12l2 2 4-4"/></svg>,
  help: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 014.9.7c0 1.7-2.5 2.2-2.5 3.9"/><path d="M12 16.6h.01"/></svg>,
};

/* ========================= ProgressRing ========================= */
function Ring({ value, total }) {
  const r = 56, c = 2 * Math.PI * r;
  const pct = total ? value / total : 0;
  return (
    <div className="ring">
      <svg width="132" height="132" viewBox="0 0 132 132">
        <defs>
          <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5a6c83"/><stop offset=".5" stopColor="#2c3848"/><stop offset="1" stopColor="#171f29"/>
          </linearGradient>
        </defs>
        <circle cx="66" cy="66" r={r} fill="none" stroke="#e2e8ef" strokeWidth="11"/>
        <circle cx="66" cy="66" r={r} fill="none" stroke="url(#metal)" strokeWidth="11" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset .6s ease" }}/>
      </svg>
      <div className="center">
        <div className="day">ПРОЙДЕНО</div>
        <div className="big">{value}</div>
        <div className="of">из {total}</div>
      </div>
    </div>
  );
}

/* ========================= Auth ========================= */
function Auth() {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const reg = mode === "register";

  const switchMode = (m) => { setMode(m); setErr(""); setInfo(""); };

  const submit = async () => {
    setErr(""); setInfo("");
    if (!email.trim() || !pass) { setErr("Впиши почту и пароль."); return; }
    if (reg && !name.trim()) { setErr("Впиши имя."); return; }
    if (reg && pass.length < 6) { setErr("Пароль должен быть не короче 6 символов."); return; }
    setBusy(true);
    try {
      if (reg) {
        // проверяем список участников до регистрации, чтобы сразу показать понятное сообщение
        try {
          const chk = await sb.rpc("is_email_allowed", { p_email: email.trim() });
          if (!chk.error && chk.data === false) { setErr(NOT_ALLOWED_MSG); setBusy(false); return; }
        } catch (e) { /* если проверка недоступна, регистрацию всё равно ограничит триггер в базе */ }
        const { data, error } = await sb.auth.signUp({
          email: email.trim(), password: pass, options: { data: { name: name.trim() } },
        });
        if (error) throw error;
        // если подтверждение почты выключено, сессия придёт сразу и App покажет приложение
        if (!data.session) {
          setInfo("Аккаунт создан. Если включено подтверждение почты, открой письмо и подтверди, потом войди.");
          switchMode("login");
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pass });
        if (error) throw error;
      }
    } catch (e) {
      setErr(authErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div className="auth-wrap">
      <div className="auth-box">
        <div className="brand">
          <div className="mark">₽</div>
          <h1>Протокол денег</h1>
          <p>17 дней, чтобы поменять отношения с деньгами</p>
        </div>
        <div className="card">
          {reg && (
            <div className="field field-anim">
              <label>Имя</label>
              <input className="input" placeholder="Как тебя зовут" value={name}
                onChange={(e) => setName(e.target.value)} onKeyDown={onKey} />
            </div>
          )}
          <div className="field">
            <label>Почта</label>
            <input className="input" type="email" placeholder="you@mail.com" value={email}
              onChange={(e) => setEmail(e.target.value)} onKeyDown={onKey} />
          </div>
          <div className="field">
            <label>Пароль</label>
            <input className="input" type="password" placeholder="••••••••" value={pass}
              onChange={(e) => setPass(e.target.value)} onKeyDown={onKey} />
          </div>

          {err && <div className="auth-msg err">{err}</div>}
          {info && <div className="auth-msg info">{info}</div>}

          <div className="spacer" />
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Минуту…" : reg ? "Создать аккаунт" : "Войти"}
          </button>
          <div className="auth-switch">
            {reg
              ? <>Уже с нами? <b onClick={() => switchMode("login")}>Войти</b></>
              : <>Нет аккаунта? <b onClick={() => switchMode("register")}>Регистрация</b></>}
          </div>
        </div>
        <p className="center faint" style={{ fontSize: 11.5, marginTop: 18 }}>Вход только для участников программы</p>
      </div>
    </div>
  );
}

/* ========================= Dashboard ========================= */
function Dashboard({ days, currentIndex, unlockedCount, onOpenDay, onGoDiary, userName, isAdmin }) {
  const done = days.filter(isDayDone).length;
  const streak = (() => { let s = 0; for (const d of days) { if (isDayDone(d)) s++; else break; } return s; })();
  const pct = Math.round((done / days.length) * 100);
  const today = days[currentIndex];
  const todayUnlocked = currentIndex + 1 <= unlockedCount;
  const upcoming = days.slice(currentIndex, currentIndex + 3);   // сегодня, следующий и один закрытый намёк

  const stageIdx = stageOf(today.id);
  const stage = STAGES[stageIdx];
  const lastNote = [...days].reverse().find((d) => d.note && d.note.trim());
  const tasksDone = days.reduce((sum, d) => sum + d.tasks.filter((t) => t.done).length, 0);

  // «Твоя причина»: ответ на первое задание Дня 1, иначе заметка Дня 1
  const day1 = days[0];
  const reason = (day1 && (
    (day1.tasks[0] && day1.tasks[0].answer && day1.tasks[0].answer.trim()) ||
    (day1.note && day1.note.trim())
  )) || "";

  return (
    <div className="page">
      <div className="head-row">
        <div>
          <div className="eyebrow">Протокол денег</div>
          <h1>Привет{userName ? ", " + userName : ""}</h1>
          <div className="sub">Твой следующий шаг готов. Один день, несколько минут.</div>
        </div>
        <div className="streak-pill" title={streak > 0 ? "Сколько дней подряд ты занимаешься без пропусков" : "Пройди первый день, чтобы начать серию"}>
          <span className="flame">🔥</span>
          {streak > 0
            ? <span><span className="streak-lead">Занимаешься </span><span className="num">{streak}</span>&nbsp;{dayWord(streak)} подряд</span>
            : <span>Начни первый день</span>}
        </div>
      </div>

      <div className="dash">
        {/* кольцо прогресса */}
        <div className="metal ring-card">
          <Ring value={done} total={days.length} />
          <div className="ring-info">
            <div className="ttl muted">Общий прогресс</div>
            <div className="pct">Пройдено {done} из {days.length}</div>
            <div className="line"><i style={{ width: pct + "%" }} /></div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              {done < days.length ? <>Сегодня день {today.id} · {pct}% пути</> : <>Все дни пройдены · 100%</>}
            </div>
          </div>
        </div>

        {/* сегодня */}
        <div className="card today-card">
          <div className="today-top">
            <div className="today-num">{today.id}</div>
            <div className="meta">
              <div className="k">{todayUnlocked ? "Сегодня" : "Скоро"}</div>
              <div className="t">{today.title}</div>
            </div>
          </div>
          <div className="lesson">{today.lesson}</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            {todayUnlocked
              ? <>🎧 {durLabel(today.duration)} · {today.tasks.length} {taskWord(today.tasks.length)}</>
              : unlockLabel(today.id)}
          </div>
          {todayUnlocked
            ? <button className="btn btn-primary" onClick={() => onOpenDay(currentIndex)}>Открыть день <Ico.chev /></button>
            : <button className="btn btn-ghost" disabled>День ещё закрыт</button>}
        </div>

        {/* этап пути */}
        <div className="card span2 stage-card">
          <div className="eyebrow">Этап пути</div>
          <div className="stage-title">Этап {stageIdx + 1} из {STAGES.length}: {lower1(stage.name)}</div>
          <div className="stage-steps">
            {STAGES.map((s, i) => (
              <div key={i} className={"seg " + (i < stageIdx ? "done" : i === stageIdx ? "cur" : "")} title={s.name} />
            ))}
          </div>
          <div className="stage-cap muted">{stage.hint}</div>
        </div>

        {/* твоя причина */}
        <div className={"card last-note reason-card" + (reason ? "" : " empty")} onClick={() => onOpenDay(0)}>
          <div className="eyebrow">Твоя причина</div>
          <div className="block-title">Ради чего ты здесь</div>
          {reason ? (
            <div className="nt">{reason}</div>
          ) : (
            <div className="nt empty-txt">Появится после первого дня.</div>
          )}
          <div className="src">{reason ? <>День 1 <span className="go">открыть</span></> : "Пройди День 1 и впиши свой корень."}</div>
        </div>

        {/* последняя заметка */}
        <div className={"card last-note" + (lastNote ? "" : " empty")} onClick={onGoDiary}>
          <div className="eyebrow">Последняя заметка</div>
          {lastNote ? (
            <>
              <div className="nt">{lastNote.note}</div>
              <div className="src">День {lastNote.id}: {lastNote.title} <span className="go">в дневник</span></div>
            </>
          ) : (
            <>
              <div className="nt empty-txt">Здесь будет твоя последняя заметка.</div>
              <div className="src">Загляни в день и оставь короткую мысль.</div>
            </>
          )}
        </div>

        {/* показатели */}
        <div className="card span2">
          <div className="stats">
            <div className="stat"><div className="v">{done}</div><div className="k">пройдено</div></div>
            <div className="stat"><div className="v">{days.length - done}</div><div className="k">осталось</div></div>
            <div className="stat"><div className="v">{tasksDone}</div><div className="k">заданий выполнено</div></div>
          </div>
        </div>

        {/* мини-маршрут */}
        <div className="span2">
          <div className="head-row" style={{ marginBottom: 12 }}>
            <div><div className="eyebrow">Маршрут</div><h2 style={{ fontSize: 18, marginTop: 4 }}>Ближайшие дни</h2></div>
          </div>
          <div className="upnext">
            {upcoming.map((d) => {
              const di = days.indexOf(d);
              const st = dayStatus(d, di, unlockedCount, currentIndex, isAdmin);
              const clickable = dayOpenable(st);
              const hidden = st === "hidden";
              const bg = st === "done" ? { background: "var(--good-soft)", color: "var(--good)" }
                : st === "today" ? { background: "#e7ebf1", color: "var(--steel)" }
                : (st === "next" || st === "open") ? { background: "#eef1f5", color: "var(--steel-2)" }
                : { background: "#eef1f5", color: "var(--ink-faint)" };
              return (
                <div key={d.id} className={"card mini " + st} onClick={() => clickable && onOpenDay(di)} style={{ opacity: clickable ? 1 : .9 }}>
                  <div className="badge" style={bg}>{st === "done" ? <Ico.check /> : clickable ? d.id : <Ico.lock width={19} height={19} />}</div>
                  <div className="nm">{hidden ? "День " + d.id : d.title}</div>
                  <div className="du">{hidden ? "Откроется в свой день" : <>🎧 {durLabel(d.duration)}</>}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================= Day map ========================= */
function DayMap({ days, currentIndex, unlockedCount, onOpenDay, isAdmin }) {
  return (
    <div className="page">
      <div className="head-row">
        <div>
          <div className="eyebrow">Маршрут</div>
          <h1>Карта 17 дней</h1>
          <div className="sub">Короткие шаги до новых отношений с деньгами. Пропущенный день спокойно догоняется.</div>
        </div>
      </div>
      <div className="path">
        {days.map((d, i) => {
          const status = dayStatus(d, i, unlockedCount, currentIndex, isAdmin);
          const clickable = dayOpenable(status);
          const showMeta = clickable || status === "next";   // минуты и задания видны до следующего дня включительно
          const hidden = status === "hidden";
          return (
            <div key={d.id} className={"node " + status} onClick={() => clickable && onOpenDay(i)}>
              <div className="dot">{status === "done" ? <Ico.check /> : clickable ? d.id : <Ico.lock width={23} height={23} />}</div>
              <div className="body">
                <div className="t">{hidden ? "День " + d.id : "День " + d.id + ": " + d.title}</div>
                {showMeta && <div className="s">🎧 {durLabel(d.duration)} · {d.tasks.length} {taskWord(d.tasks.length)}</div>}
                {!clickable && <div className="lockhint"><Ico.lock /> {lockLine(status, d, unlockedCount)}</div>}
              </div>
              <span className={"tag " + status}>{STATUS_LABEL[status]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ========================= Audio player (настоящее аудио) ========================= */
const SPEED_KEY = "mp_audio_speed";              // ключ в localStorage для выбранной скорости
const SPEED_MIN = 0.8, SPEED_MAX = 2;            // границы ползунка
const SPEED_PRESETS = [1, 1.3, 1.5, 1.8];        // быстрые кнопки, как просили
const clampSpeed = (v) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(v) || 1));
function loadSpeed() {
  try { return clampSpeed(parseFloat(localStorage.getItem(SPEED_KEY))); } catch (e) { return 1; }
}
// красивый вид числа: 1× вместо 1.0×, 1,5× в русском стиле
const fmtSpeed = (v) => (Math.round(v * 100) / 100).toString().replace(".", ",") + "×";

function Player({ day }) {
  const audioRef = useRef(null);
  const barRef = useRef(null);
  const reqId = useRef(0);          // номер запроса ссылки: гасит гонки при быстром переключении дней
  const recoverLeft = useRef(2);    // сколько раз ещё пробуем переполучить ссылку при сбое <audio>
  const resumeAt = useRef(0);       // позиция, на которую вернуться после переполучения ссылки
  const shouldResume = useRef(false); // продолжать ли играть после восстановления
  const [src, setSrc] = useState(undefined);   // undefined=грузим, null=аудио нет, ""=ошибка, строка=ссылка
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(day.duration || 0);
  const [speed, setSpeed] = useState(loadSpeed);   // скорость воспроизведения, общая для всех уроков

  // меняем скорость и запоминаем выбор, чтобы держался на всех днях и после перезахода
  const applySpeed = (v) => {
    const s = Math.round(clampSpeed(v) * 100) / 100;
    setSpeed(s);
    try { localStorage.setItem(SPEED_KEY, String(s)); } catch (e) {}
  };

  // держим playbackRate в синхроне: при смене скорости и когда появляется новый <audio>
  useEffect(() => {
    const a = audioRef.current;
    if (a) { try { a.preservesPitch = true; a.playbackRate = speed; } catch (e) {} }
  }, [speed, src]);

  // взять (или переполучить) подписанную ссылку. resume = позиция для продолжения
  const loadSrc = (resume) => {
    const my = ++reqId.current;
    resumeAt.current = resume || 0;
    setSrc(undefined);
    signedAudioUrl(day.audioPath)
      .then((u) => { if (my === reqId.current) setSrc(u); })
      .catch(() => { if (my === reqId.current) setSrc(""); });
  };

  // смена дня: сбрасываем и берём ссылку заново
  useEffect(() => {
    setPlaying(false); setT(0); setDur(day.duration || 0);
    recoverLeft.current = 2; resumeAt.current = 0; shouldResume.current = false;
    if (!day.audioPath) { reqId.current++; setSrc(null); return; }
    loadSrc(0);
    // loadSrc и day.audioPath стабильны для этого дня
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.id, day.audioPath]);

  // аудио для дня не загружено или совсем не открылось: честное сообщение, без фейкового таймера
  if (src === null || src === "") {
    const failed = src === "";
    return (
      <div className="card">
        <div className="player">
          <div className="cover"><Ico.wave /></div>
          <div className="pl-body">
            <div className="k">Урок дня</div>
            <div className="t">{day.title}</div>
          </div>
          {failed && (
            <button className="play-btn" title="Повторить"
              onClick={() => { recoverLeft.current = 2; loadSrc(0); }}><Ico.play /></button>
          )}
        </div>
        <div className="player-empty">
          {failed ? "Аудио не открылось. Нажми кнопку справа, чтобы попробовать ещё раз." : "Аудио для этого дня пока не загружено."}
        </div>
      </div>
    );
  }

  const loading = src === undefined;
  const onLoaded = () => {
    const a = audioRef.current; if (!a) return;
    try { a.preservesPitch = true; a.playbackRate = speed; } catch (e) {}
    if (isFinite(a.duration)) setDur(a.duration);
    if (resumeAt.current > 0) { try { a.currentTime = resumeAt.current; } catch (e) {} resumeAt.current = 0; }
    if (shouldResume.current) { shouldResume.current = false; a.play().catch(() => {}); }
  };
  const onTime = () => { const a = audioRef.current; if (a) setT(a.currentTime); };
  // сбой воспроизведения (просроченная/битая ссылка, разрыв сети): тихо переполучаем ссылку
  const onAudioError = () => {
    const a = audioRef.current;
    if (recoverLeft.current > 0) {
      recoverLeft.current -= 1;
      shouldResume.current = a ? !a.paused : false;
      loadSrc(a ? a.currentTime : 0);
    } else {
      setSrc("");
    }
  };
  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (a.paused) a.play().catch(() => setPlaying(false));
    else a.pause();
  };
  const seek = (e) => {
    const a = audioRef.current; if (!a || !dur) return;
    const rect = barRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const nt = Math.min(dur, Math.max(0, (cx / rect.width) * dur));
    a.currentTime = nt; setT(nt);
  };
  const pct = dur ? (t / dur) * 100 : 0;

  return (
    <div className="card">
      {!loading && (
        <audio ref={audioRef} src={src} preload="metadata"
          onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onError={onAudioError}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      )}
      <div className="player">
        <div className="cover"><Ico.wave /></div>
        <div className="pl-body">
          <div className="k">Урок дня</div>
          <div className="t">{day.title}</div>
        </div>
        <button className="play-btn" onClick={toggle} disabled={loading}>
          {playing ? <Ico.pause /> : <Ico.play />}
        </button>
      </div>
      <div className="seek">
        <div className="seek-bar" ref={barRef} onClick={seek}>
          <i style={{ width: pct + "%" }} />
          <b style={{ left: pct + "%" }} />
        </div>
        <div className="seek-time"><span>{loading ? "загрузка…" : fmt(t)}</span><span>{fmt(dur)}</span></div>
      </div>
      <div className="speed-box">
        <div className="speed-head">
          <span className="speed-lbl"><Ico.speed /> Скорость</span>
          <div className="speed-chips">
            {SPEED_PRESETS.map((p) => (
              <button key={p} className={"speed-chip" + (Math.abs(speed - p) < 0.001 ? " sel" : "")}
                disabled={loading} onClick={() => applySpeed(p)}>{fmtSpeed(p)}</button>
            ))}
          </div>
        </div>
        <input className="speed-range" type="range"
          min={SPEED_MIN} max={SPEED_MAX} step="0.05" value={speed} disabled={loading}
          aria-label="Скорость воспроизведения"
          onChange={(e) => applySpeed(e.target.value)} />
      </div>
    </div>
  );
}

/* ========================= Task with answer ========================= */
function TaskItem({ task, num, just, onAnswer, onAnswerBlur, onConfirm, onEdit }) {
  const filled = task.answer && task.answer.trim().length > 0;
  return (
    <div className={"qtask" + (task.done ? " done" : "") + (just ? " just-checked" : "")}>
      <div className="q-row">
        <div className="q-check"><span className="glow" /><Ico.check /></div>
        <div className="q-text"><span className="q-num">Задание {num}</span>{task.text}</div>
      </div>
      {task.done ? (
        <div className="q-answer-view">
          <div className="q-answer-text">{task.answer}</div>
          <button className="q-edit" onClick={() => onEdit(task.id)}>Изменить</button>
        </div>
      ) : (
        <div className="q-edit-zone">
          <textarea className="q-input" placeholder="Впиши свой ответ" value={task.answer}
            onChange={(e) => onAnswer(task.id, e.target.value)}
            onBlur={() => onAnswerBlur(task.id)} />
          <button className="btn btn-primary btn-sm q-confirm" disabled={!filled}
            onClick={() => filled && onConfirm(task.id)}>
            <Ico.check /> Готово
          </button>
        </div>
      )}
    </div>
  );
}

/* ========================= Day screen ========================= */
function DayScreen({ day, dayIndex, total, onBack, onAnswer, onAnswerBlur, onConfirm, onEdit, onNote }) {
  const [flash, setFlash] = useState(false);
  const [justId, setJustId] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const prog = dayProgress(day);
  const allDone = prog === day.tasks.length;

  const confirm = (id) => {
    onConfirm(id);
    setJustId(id); setTimeout(() => setJustId(null), 700);
    const willAllBeDone = day.tasks.every((t) => (t.id === id ? true : t.done));
    if (willAllBeDone) { setShowDone(true); setTimeout(() => setShowDone(false), 2600); }
  };
  const saveNote = (v) => { onNote(v); setFlash(true); setTimeout(() => setFlash(false), 1400); };

  return (
    <div className="page day-col">
      <button className="back" onClick={onBack}><Ico.back /> Назад к карте</button>
      <div className="day-head">
        <div className="eyebrow">День {day.id} из {total}</div>
        <h1>{day.title}</h1>
      </div>
      <div className="gap16" />

      <Player day={day} />

      <div className="card">
        <p className="muted" style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55 }}>{day.lesson}</p>
      </div>

      <div className="card">
        <div className="tasks-head">
          <div className="eyebrow">Задания дня</div>
          <div className="day-mini-prog">
            <div className="bar"><i style={{ width: (prog / day.tasks.length * 100) + "%" }} /></div>
            {prog}/{day.tasks.length}
          </div>
        </div>
        <div className="q-list">
          {day.tasks.map((t, i) => (
            <TaskItem key={t.id} task={t} num={i + 1} just={justId === t.id}
              onAnswer={onAnswer} onAnswerBlur={onAnswerBlur} onConfirm={confirm} onEdit={onEdit} />
          ))}
        </div>
      </div>

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 9 }}>Заметка дня</div>
        <textarea className="note-area" placeholder="Короткая мысль, вывод или итог дня" defaultValue={day.note} onBlur={(e) => saveNote(e.target.value)} />
        <div className="spacer" />
        {flash ? <span className="saved-flash">✓ Сохранено</span> : <span className="faint" style={{ fontSize: 12.5 }}>Сохраняется при выходе из поля</span>}
      </div>

      {allDone
        ? <div className={"card day-done-card" + (showDone ? " pop" : "")}>
            <div className="dd-check"><Ico.check /></div>
            <div style={{ fontWeight: 800, marginTop: 10, fontSize: 17 }}>День {day.id} пройден</div>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Спокойный шаг сделан. Прогресс обновился.</div>
            <div className="spacer" /><div className="spacer" />
            <button className="btn btn-primary" onClick={onBack}>{dayIndex + 1 < total ? "К следующему дню" : "Завершить протокол"}</button>
          </div>
        : <>
            <button className="btn btn-primary" onClick={onBack}>Сохранить и вернуться</button>
            <div className="encourage">Ответь на задания и нажми «Готово», чтобы день засчитался. Спешить некуда, пропуск не страшен.</div>
          </>}
    </div>
  );
}

/* ========================= Diary ========================= */
function Diary({ days, onOpenDay }) {
  const filled = days.filter((d) => isDayDone(d) || d.note.trim() || d.tasks.some((t) => t.answer && t.answer.trim()));
  return (
    <div className="page day-col">
      <div className="head-row">
        <div>
          <div className="eyebrow">Мой дневник</div>
          <h1>Дневник</h1>
          <div className="sub">Всё, что ты записываешь за дни протокола, собрано в одном месте.</div>
        </div>
      </div>

      {filled.length === 0 ? (
        <div className="card center" style={{ padding: 40 }}>
          <div style={{ fontSize: 30 }}>📖</div>
          <div style={{ fontWeight: 700, marginTop: 8 }}>Пока пусто</div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Пройди первый день, и твои ответы появятся здесь.</div>
        </div>
      ) : filled.map((d) => {
        const di = days.indexOf(d);
        return (
          <div key={d.id} className="card diary-day">
            <div className="diary-head" onClick={() => onOpenDay(di)}>
              <div className="diary-num">{d.id}</div>
              <div className="diary-ttl">
                <div className="eyebrow">День {d.id}{isDayDone(d) ? " · пройден" : ""}</div>
                <div className="t">{d.title}</div>
              </div>
              <Ico.chev className="chev" />
            </div>
            {d.tasks.filter((t) => t.answer && t.answer.trim()).map((t) => (
              <div key={t.id} className="diary-item">
                <div className="diary-q">{t.text}</div>
                <div className="diary-a">{t.answer}</div>
              </div>
            ))}
            {d.note && d.note.trim() && (
              <div className="diary-item note">
                <div className="diary-q">Заметка дня</div>
                <div className="diary-a">{d.note}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ========================= Инструкция ========================= */
// Картинка-экран с подписью. Если файла нет, показываем аккуратную рамку-заглушку.
function GuideShot({ src, cap }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="gd-shot">
      {failed
        ? <div className="gd-frame">Сюда вставится картинка экрана</div>
        : <img src={src} alt={cap || ""} loading="lazy" onError={() => setFailed(true)} />}
      {cap && <figcaption>{cap}</figcaption>}
    </figure>
  );
}

// Шаги курса. icon = ключ из Ico, body = абзацы, list = пункты, shot = картинка.
const GUIDE_STEPS = [
  { icon: "login", title: "Как сюда войти",
    body: [
      "Вы заходите по своей почте и паролю. Это та самая почта, по которой вам открыли доступ. Впишите её, впишите пароль и нажмите «Войти».",
      "Заходить каждый раз заново не нужно. Программа вас запомнит. Закрыли страницу, открыли снова, и вы по-прежнему внутри.",
      "Зайти можно и с телефона, и с компьютера. Всё работает одинаково.",
    ] },
  { icon: "grid", title: "Меню и разделы",
    body: ["Внизу экрана есть полоска с кнопками. Это меню, через него вы переходите между разделами. На компьютере это же меню стоит слева.", "Разделов четыре:"],
    list: [
      ["Мой прогресс.", " Главная страница. Тут видно, сколько дней вы уже прошли и какой день у вас сегодня."],
      ["Карта дней.", " Все 17 дней по порядку. Видно, что пройдено, что сегодня, а что пока закрыто."],
      ["Дневник.", " Сюда сами собираются все ваши ответы и заметки за все дни. В одном месте."],
      ["Инструкция.", " Эта страница. Сюда можно вернуться в любой момент, если что-то забылось."],
    ],
    shot: { src: "guide-img/step-menu.png", cap: "Меню внизу экрана. Сейчас вы в «Инструкции»." } },
  { icon: "calday", title: "Откройте сегодняшний день",
    body: ["Откройте раздел «Мой прогресс». Там есть карточка сегодняшнего дня. Нажмите на ней кнопку «Открыть день».", "Откроется страница урока. С неё и начинается ваш день."],
    shot: { src: "guide-img/step-open-day.png", cap: "Кнопка «Открыть день» на главной странице." } },
  { icon: "phones", title: "Послушайте аудио",
    body: [
      "Наверху страницы дня стоит проигрыватель. Нажмите круглую кнопку с треугольником, и аудио начнёт играть. Чтобы поставить на паузу, нажмите ту же кнопку ещё раз.",
      "Слушать удобнее в наушниках или просто включить погромче.",
      "Аудио не включилось с первого раза? Не переживайте. Обновите страницу и нажмите кнопку снова. Чтобы обновить, потяните страницу пальцем сверху вниз, либо нажмите кружок со стрелкой наверху браузера.",
    ],
    shot: { src: "guide-img/step-audio.png", cap: "Нажмите круглую кнопку, чтобы включить урок." } },
  { icon: "doc", title: "Прочитайте текст урока",
    body: ["Под проигрывателем идёт текст урока. Прочитайте его спокойно. Можно до аудио, можно после, как вам удобнее."] },
  { icon: "checksq", title: "Выполните задания",
    body: [
      "Ниже текста идут задания дня. Их немного. Под каждым заданием есть поле, куда можно вписать ответ.",
      "Впишите ответ своими словами и нажмите кнопку «Готово». Задание отметится зелёной галочкой.",
      "Ответ сохраняется сам. Отдельно сохранять ничего не надо. Захотите поправить ответ, нажмите «Изменить».",
    ],
    shot: { src: "guide-img/step-task.png", cap: "Впишите ответ и нажмите «Готово»." } },
  { icon: "pen", title: "Запишите мысль в дневник",
    body: [
      "В самом низу дня есть «Заметка дня». Это место для короткой мысли или вывода. Захотелось что-то записать, впишите.",
      "Заметка сохраняется сама, как только вы нажмёте в другое место. Потом все заметки и ответы соберутся в разделе «Дневник».",
    ],
    shot: { src: "guide-img/step-diary.png", cap: "Так выглядит ваш дневник. Записи собираются сами." } },
  { icon: "sunrise", title: "Завтра вернитесь за новым днём",
    body: [
      "Дни открываются по одному, по расписанию. Каждое утро открывается следующий день. Поэтому завтрашний день пока закрыт. На нём виден замочек и подпись, когда он откроется.",
      "Это сделано специально. Так у вас каждый день один спокойный шаг, без спешки.",
      "Завтра просто зайдите снова и откройте новый день. Пропустили день, ничего страшного. Он не пропадёт, вы спокойно вернётесь к нему позже.",
    ],
    shot: { src: "guide-img/step-map.png", cap: "Замочек значит, что день ещё не открылся. Под ним написано, когда откроется." } },
];

const GUIDE_FAQ = [
  { q: "День не открывается", a: "Дни открываются по одному, каждое утро. Если день закрыт, на нём замочек и время открытия. Дождитесь этого времени и обновите страницу." },
  { q: "Аудио не играет", a: "Обновите страницу и нажмите кнопку снова. Проверьте, что звук на телефоне включён и громкость поднята. Чаще всего помогает именно обновление страницы." },
  { q: "Как вернуться завтра", a: "Просто откройте программу снова с того же телефона или компьютера. Вы сразу окажетесь внутри. Зайдите в «Мой прогресс» и откройте новый день." },
  { q: "Я вышел, как войти обратно", a: "Впишите свою почту и пароль и нажмите «Войти». Это та же почта, по которой вам открыли доступ." },
  { q: "Можно проходить с телефона и с компьютера", a: "Да. Программа работает и там, и там. Прогресс общий, он привязан к вашей почте, а не к устройству." },
  { q: "Я случайно отметил задание", a: "Ничего страшного. Нажмите «Изменить» под ответом, поправьте и снова нажмите «Готово»." },
];

// один вопрос-ответ, раскрывается по нажатию (крупная зона нажатия)
function FaqItem({ q, a, open, onToggle }) {
  return (
    <div className={"gd-faq" + (open ? " open" : "")}>
      <button className="gd-faq-q" onClick={onToggle} aria-expanded={open}>
        <span className="gd-faq-text">{q}</span>
        <span className="gd-faq-chev"><Ico.chev /></span>
      </button>
      <div className="gd-faq-wrap"><div className="gd-faq-a">{a}</div></div>
    </div>
  );
}

function Guide() {
  const [openFaq, setOpenFaq] = useState(0);   // первый вопрос открыт, чтобы было понятно, как это работает
  return (
    <div className="page guide-col">
      <div className="head-row">
        <div>
          <div className="eyebrow">Помощь</div>
          <h1>Инструкция</h1>
          <div className="sub">Как тут всё устроено и как проходить курс. Всё по шагам, простыми словами.</div>
        </div>
      </div>

      {/* что это за платформа */}
      <div className="card gd-lead">
        <div className="gd-lead-head">
          <div className="gd-ico"><Ico.compass /></div>
          <h2 className="gd-lead-title">С чего начать</h2>
        </div>
        <div className="gd-body">
          <p>«Протокол денег» это ваша программа на 17 дней. Каждый день мы открываем для вас новый небольшой урок.</p>
          <p>Вы слушаете короткое аудио, читаете текст, выполняете простое задание и записываете пару мыслей. Всё занимает минут двадцать. Спешить никуда не нужно.</p>
          <p>Ниже всё показано по шагам, с картинками. Эта страница всегда тут, в любой момент можно вернуться и перечитать.</p>
        </div>
      </div>

      {/* шаги */}
      {GUIDE_STEPS.map((s, i) => {
        const Icon = Ico[s.icon];
        return (
          <div key={i} className="card gd-step">
            <div className="gd-step-head">
              <div className="gd-num">{i + 1}</div>
              <h2 className="gd-step-title">{s.title}</h2>
              <div className="gd-ico"><Icon /></div>
            </div>
            <div className="gd-body">
              {s.body.map((p, j) => <p key={j}>{p}</p>)}
              {s.list && (
                <ul className="gd-list">
                  {s.list.map((li, j) => <li key={j}><b>{li[0]}</b>{li[1]}</li>)}
                </ul>
              )}
            </div>
            {s.shot && <GuideShot src={s.shot.src} cap={s.shot.cap} />}
          </div>
        );
      })}

      {/* спокойствие */}
      <div className="card gd-calm">
        <div className="gd-lead-head">
          <div className="gd-ico gd-ico-good"><Ico.shield /></div>
          <h2 className="gd-lead-title">Ничего не потеряется</h2>
        </div>
        <div className="gd-body">
          <p>Всё, что вы делаете, сохраняется само. Ответы, заметки, пройденные дни. Можно закрыть страницу, выключить телефон, вернуться через день. Вы окажетесь там же, где остановились.</p>
        </div>
      </div>

      {/* частые вопросы */}
      <div className="gd-faq-head">
        <div className="gd-ico"><Ico.help /></div>
        <div>
          <div className="eyebrow">Если что-то непонятно</div>
          <h2>Частые вопросы</h2>
        </div>
      </div>
      <div className="gd-faq-list">
        {GUIDE_FAQ.map((it, i) => (
          <FaqItem key={i} q={it.q} a={it.a} open={openFaq === i}
            onToggle={() => setOpenFaq((cur) => (cur === i ? -1 : i))} />
        ))}
      </div>

      <div className="gd-end">Спокойно идите по одному дню. У вас всё получится.</div>
    </div>
  );
}

/* ========================= Управление доступом ========================= */
const emailValid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Модульный кеш списка доступа: переживает переключение вкладок,
// поэтому при возврате в админку список показывается сразу, без «Загрузка...»
// и без мигания, а сетевой сбой не стирает уже показанные данные.
let accessCache = { list: null, admins: [] };

function AccessSection() {
  const [list, setList] = useState(accessCache.list);     // null = ещё ни разу не грузили
  const [admins, setAdmins] = useState(accessCache.admins); // e-mail админов (их нельзя убрать)
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState(null);       // {type:"ok"|"err", text}
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    // оба запроса разом, так быстрее, чем один за другим
    const [aRes, lRes] = await Promise.all([
      sb.from("admins").select("email"),
      sb.from("allowed_emails").select("email, note, created_at").order("created_at", { ascending: true }),
    ]);
    if (!aRes.error) {
      const a = ((aRes.data) || []).map((r) => (r.email || "").toLowerCase());
      accessCache.admins = a; setAdmins(a);
    }
    if (lRes.error) {
      // ВАЖНО: не стираем уже показанный список из-за временного сбоя (обновление токена, сеть).
      // Раньше тут был setList([]), из-за чего список «пропадал».
      if (accessCache.list === null) setList([]);
      setMsg({ type: "err", text: "Не удалось обновить список: " + (lRes.error.message || "") });
      return;
    }
    accessCache.list = lRes.data || [];
    setList(accessCache.list);
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    setMsg(null);
    const e = email.trim().toLowerCase();
    if (!emailValid(e)) { setMsg({ type: "err", text: "Впиши корректный e-mail." }); return; }
    if ((list || []).some((r) => (r.email || "").toLowerCase() === e)) { setMsg({ type: "err", text: "Уже в списке." }); return; }
    setBusy(true);
    const { error } = await sb.from("allowed_emails").insert({ email: e });
    setBusy(false);
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) setMsg({ type: "err", text: "Уже в списке." });
      else setMsg({ type: "err", text: "Не получилось добавить: " + (error.message || "") });
      return;
    }
    setEmail(""); setMsg({ type: "ok", text: "Добавлен: " + e }); load();
  };

  const remove = async (e) => {
    setMsg(null); setBusy(true);
    const { error } = await sb.from("allowed_emails").delete().eq("email", e);
    setBusy(false); setConfirm(null);
    if (error) { setMsg({ type: "err", text: "Не получилось удалить: " + (error.message || "") }); return; }
    setMsg({ type: "ok", text: "Удалён: " + e }); load();
  };

  return (
    <div className="card access-card">
      <div className="eyebrow">Доступы</div>
      <div className="block-title">Кто допущен в программу</div>
      <div className="block-sub muted">Добавляй e-mail оплативших. Регистр не важен, адрес приводится к нижнему регистру.</div>

      <div className="access-add">
        <input className="adm-input" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
          placeholder="email@example.com" value={email}
          onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button className="btn btn-primary btn-sm" onClick={add} disabled={busy}>Добавить</button>
      </div>

      {msg && <div className={"access-msg " + msg.type}>{msg.text}</div>}

      <div className="access-list">
        {list === null ? (
          <div className="muted" style={{ fontSize: 13, padding: "10px 0" }}>Загрузка...</div>
        ) : list.length === 0 ? (
          <div className="muted" style={{ fontSize: 13, padding: "10px 0" }}>Пока никого нет.</div>
        ) : list.map((r) => {
          const e = (r.email || "").toLowerCase();
          const isAdminEmail = admins.indexOf(e) !== -1;
          return (
            <div key={r.email} className="access-row">
              <span className="access-email">{r.email}{isAdminEmail && <span className="access-tag">админ</span>}</span>
              {isAdminEmail ? (
                <span className="faint" style={{ fontSize: 11.5, flex: "none" }}>защищён</span>
              ) : confirm === r.email ? (
                <span className="access-confirm">
                  <button className="btn btn-sm access-del" onClick={() => remove(r.email)} disabled={busy}>Удалить</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Отмена</button>
                </span>
              ) : (
                <button className="icon-btn" title="Удалить" onClick={() => setConfirm(r.email)}>×</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ========================= Статистика участников ========================= */
// застрял, если не закрыл ни одного нового дня столько дней подряд при идущей программе
const STUCK_AFTER_DAYS = 3;

// русское склонение числа: 1 минута, 2 минуты, 5 минут
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};

// «2 дня назад», «вчера», «только что» из метки времени (мс)
function timeAgo(ms, now) {
  if (!ms) return "нет активности";
  const diff = now - ms;
  if (diff < 45000) return "только что";
  const min = Math.floor(diff / 60000);
  if (min < 60) return min + " " + plural(min, "минуту", "минуты", "минут") + " назад";
  const hr = Math.floor(diff / 3600000);
  if (hr < 24) return hr + " " + plural(hr, "час", "часа", "часов") + " назад";
  const d = Math.floor(diff / 86400000);
  if (d === 1) return "вчера";
  if (d < 7) return d + " " + plural(d, "день", "дня", "дней") + " назад";
  if (d < 31) { const w = Math.floor(d / 7); return w + " " + plural(w, "неделю", "недели", "недель") + " назад"; }
  const mo = Math.floor(d / 30);
  return mo + " " + plural(mo, "месяц", "месяца", "месяцев") + " назад";
}

const ST_STATUS = {
  passed: { label: "Прошёл",  cls: "passed" },
  active: { label: "Активен", cls: "active" },
  stuck:  { label: "Застрял", cls: "stuck" },
  none:   { label: "Не начал", cls: "none" },
};

let statsCache = null; // переживает переключение вкладок, чтобы сводка не моргала при возврате

function StatsSection({ totalDays }) {
  const [rows, setRows] = useState(statsCache);   // null = ещё ни разу не грузили
  const [err, setErr] = useState("");
  const [sort, setSort] = useState("progress"); // progress | activity

  const load = async () => {
    setErr("");
    if (statsCache === null) setRows(null); // первый раз показываем «Загрузка...», дальше держим прежнее
    // только прогресс и профиль, без личных ответов и заметок (приватность)
    const [pr, gr, ad] = await Promise.all([
      sb.from("profiles").select("id,name,email"),
      sb.from("progress").select("user_id,completed,completed_at"),
      sb.from("admins").select("email"),
    ]);
    if (pr.error || gr.error) {
      const e = pr.error || gr.error;
      if (statsCache === null) setRows([]); // не стираем уже показанную сводку из-за разового сбоя
      setErr("Не удалось загрузить данные. Запусти SQL для доступа админа (supabase/admin_stats.sql), затем обнови. " + ((e && e.message) || ""));
      return;
    }
    const adminSet = new Set(((ad.data) || []).map((r) => (r.email || "").toLowerCase()));
    const byUser = {};
    (pr.data || []).forEach((p) => {
      const email = (p.email || "").toLowerCase();
      if (adminSet.has(email)) return; // админов в сводке участников не показываем
      byUser[p.id] = { id: p.id, name: (p.name || "").trim(), email: p.email || "", completed: 0, last: null };
    });
    (gr.data || []).forEach((r) => {
      const u = byUser[r.user_id];
      if (!u || !r.completed) return;
      u.completed += 1;
      if (r.completed_at) {
        const t = new Date(r.completed_at).getTime();
        if (!u.last || t > u.last) u.last = t;
      }
    });
    const now = Date.now();
    const list = Object.values(byUser).map((u) => {
      const daysSince = u.last ? Math.floor((now - u.last) / 86400000) : null;
      let status;
      if (u.completed >= totalDays) status = "passed";
      else if (u.completed === 0) status = "none";
      else if (daysSince === null || daysSince >= STUCK_AFTER_DAYS) status = "stuck";
      else status = "active";
      const curDay = u.completed === 0 ? 0 : Math.min(u.completed + 1, totalDays);
      const stageIdx = u.completed === 0 ? -1 : stageOf(curDay);
      return { ...u, status, daysSince, curDay, stageIdx };
    });
    statsCache = list; setRows(list);
  };
  useEffect(() => { load(); }, []);

  const summary = useMemo(() => {
    if (!rows) return null;
    const total = rows.length;
    const passed = rows.filter((r) => r.status === "passed").length;
    const active = rows.filter((r) => r.status === "active").length;
    const stuck  = rows.filter((r) => r.status === "stuck").length;
    const avg = total ? Math.round(rows.reduce((s, r) => s + r.completed, 0) / (total * totalDays) * 100) : 0;
    const dist = [0, 0, 0, 0, 0, 0]; // [не начали, этап1..этап5]
    rows.forEach((r) => { if (r.stageIdx === -1) dist[0] += 1; else dist[r.stageIdx + 1] += 1; });
    return { total, passed, active, stuck, avg, dist };
  }, [rows, totalDays]);

  const sorted = useMemo(() => {
    if (!rows) return [];
    const arr = rows.slice();
    if (sort === "progress") arr.sort((a, b) => (b.completed - a.completed) || ((b.last || 0) - (a.last || 0)));
    else arr.sort((a, b) => ((b.last || 0) - (a.last || 0)) || (b.completed - a.completed));
    return arr;
  }, [rows, sort]);

  const distRows = [
    { name: "Ещё не начали", range: "" },
    ...STAGES.map((s) => ({ name: s.name, range: "Дни " + s.from + "-" + s.to })),
  ];

  const now = Date.now();

  return (
    <div className="page">
      <div className="head-row">
        <div>
          <div className="eyebrow">Управление</div>
          <h1>Статистика участников</h1>
          <div className="sub">Прогресс и статус каждого. Личные ответы и заметки участников остаются приватными.</div>
        </div>
      </div>

      {err && <div className="access-msg err" style={{ marginBottom: 16 }}>{err}</div>}

      {rows === null ? (
        <div className="card center" style={{ padding: 40 }}>
          <div className="muted" style={{ fontSize: 14 }}>Загружаю статистику…</div>
        </div>
      ) : summary.total === 0 && !err ? (
        <div className="card center" style={{ padding: 40 }}>
          <div style={{ fontSize: 30 }}>📊</div>
          <div style={{ fontWeight: 700, marginTop: 8 }}>Пока нет участников</div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>Как только люди начнут проходить программу, здесь появится их прогресс.</div>
        </div>
      ) : summary.total > 0 ? (
        <>
          {/* сводка */}
          <div className="st-cards">
            <div className="st-kpi"><div className="v">{summary.total}</div><div className="k">всего участников</div></div>
            <div className="st-kpi"><div className="v">{summary.active}</div><div className="k">активны сейчас</div></div>
            <div className={"st-kpi" + (summary.stuck > 0 ? " stuck-on" : "")}><div className="v">{summary.stuck}</div><div className="k">застряли</div></div>
            <div className="st-kpi"><div className="v">{summary.passed}</div><div className="k">прошли всю программу</div></div>
            <div className="st-kpi st-kpi-accent">
              <div className="v">{summary.avg}%</div>
              <div className="k">средний прогресс</div>
              <div className="st-kpi-bar"><i style={{ width: summary.avg + "%" }} /></div>
            </div>
          </div>

          {/* распределение по этапам */}
          <div className="card st-dist">
            <div className="eyebrow">Распределение</div>
            <div className="block-title">Где сейчас участники</div>
            <div className="st-bars">
              {distRows.map((d, i) => {
                const count = summary.dist[i];
                const w = summary.total ? Math.round(count / summary.total * 100) : 0;
                return (
                  <div key={i} className="st-bar-row">
                    <div className="st-bar-label">
                      <span className="nm">{d.name}</span>
                      {d.range && <span className="rg muted">{d.range}</span>}
                    </div>
                    <div className="st-bar-num">{count}</div>
                    <div className="st-bar-track"><i className={"st-bar-fill s" + i} style={{ width: w + "%" }} /></div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* список участников */}
          <div className="st-toolbar">
            <h2 style={{ fontSize: 18 }}>Участники <span className="faint" style={{ fontWeight: 700, fontSize: 14 }}>· {summary.total}</span></h2>
            <div className="st-sort">
              <button className={sort === "progress" ? "active" : ""} onClick={() => setSort("progress")}>По прогрессу</button>
              <button className={sort === "activity" ? "active" : ""} onClick={() => setSort("activity")}>По активности</button>
            </div>
          </div>

          <div className="st-table">
            <div className="st-thead">
              <div>Участник</div><div>Прогресс</div><div>Этап</div><div>Активность</div><div>Статус</div>
            </div>
            {sorted.map((r) => {
              const pct = Math.round(r.completed / totalDays * 100);
              const initial = ((r.name || r.email || "?").trim().charAt(0) || "?").toUpperCase();
              const st = ST_STATUS[r.status];
              const sCell = r.status === "none" ? { nm: "Ещё не начал", sub: "" }
                : r.status === "passed" ? { nm: "Пройдено", sub: "все " + totalDays + " дней" }
                : { nm: STAGES[r.stageIdx].name, sub: "идёт день " + r.curDay };
              return (
                <div key={r.id} className={"st-row " + st.cls}>
                  <div className="st-c st-who">
                    <div className="st-ava">{initial}</div>
                    <div className="st-id">
                      <div className="nm">{r.name || r.email}</div>
                      {r.name && r.email ? <div className="em">{r.email}</div> : null}
                    </div>
                  </div>
                  <div className="st-c st-prog">
                    <span className="st-k">Прогресс</span>
                    <div className="st-prog-top"><span className="num">{r.completed}/{totalDays}</span><span className="pct muted">{pct}%</span></div>
                    <div className="st-prog-bar"><i style={{ width: pct + "%" }} /></div>
                  </div>
                  <div className="st-c st-stage">
                    <span className="st-k">Этап</span>
                    <div className="st-stage-v"><span className="nm">{sCell.nm}</span>{sCell.sub && <span className="sub">{sCell.sub}</span>}</div>
                  </div>
                  <div className="st-c st-act">
                    <span className="st-k">Активность</span>
                    <span className="val">{timeAgo(r.last, now)}</span>
                  </div>
                  <div className="st-c st-stat"><span className={"st-chip " + st.cls}>{st.label}</span></div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ========================= Admin ========================= */
// Карточка одного дня вынесена и обёрнута в memo: при правке одного дня
// перерисовывается только его карточка, а не все 17 сразу (раньше из-за этого
// админка подлагивала при наборе текста). Все обработчики приходят стабильными.
const DayCard = memo(function DayCard({ day, di, status, onTitle, onLesson, onTaskText, onTaskRemove, onTaskAdd, onPickAudio, onSaveDay }) {
  const s = status || {};
  return (
    <div className="card adm-day">
      <div className="head">
        <div className="n">{day.id}</div>
        <input className="adm-input" value={day.title} onChange={(e) => onTitle(di, e.target.value)} />
      </div>

      <div className="adm-label">Текст урока</div>
      <textarea className="adm-input" value={day.lesson} onChange={(e) => onLesson(di, e.target.value)} />

      <div className="adm-label">Аудио урока</div>
      <div className="uploader">
        <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
          <Ico.upload /> Загрузить аудио
          <input type="file" accept=".mp3,.m4a,.wav,.ogg,audio/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; onPickAudio(di, f); }} />
        </label>
        <span className={"file-name" + (day.audioName ? "" : " empty")}>{day.audioName || "файл не выбран"}</span>
      </div>

      {s.up === "uploading" && (
        <div className="up-status">
          <div className="up-bar"><i style={{ width: (s.progress || 0) + "%" }} /></div>
          <div className="up-line muted">Загружается… {s.progress || 0}%</div>
        </div>
      )}
      {s.up === "done" && (
        <div className="up-status">
          <div className="up-line ok"><span className="ok-tick">✓</span> Загружено: {s.msg}</div>
          {s.preview && <audio className="up-preview" controls preload="metadata" src={s.preview} />}
        </div>
      )}
      {s.up === "error" && <div className="up-line err">{s.msg}</div>}

      <div className="adm-label">Задания</div>
      {day.tasks.map((t, ti) => (
        <div key={t.id} className="adm-task">
          <input className="adm-input" value={t.text} onChange={(e) => onTaskText(di, ti, e.target.value)} />
          <button className="icon-btn" title="Удалить" onClick={() => onTaskRemove(di, ti)}>×</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm adm-add" onClick={() => onTaskAdd(di)}>+ Задание</button>

      <div className="adm-save">
        <button className="btn btn-primary btn-sm" disabled={s.save === "saving"} onClick={() => onSaveDay(di)}>
          {s.save === "saving" ? "Сохраняю…" : "Сохранить день"}
        </button>
        {s.save === "saved" && <span className="save-ok"><span className="ok-tick">✓</span> {s.saveMsg}</span>}
        {s.save === "error" && <span className="save-err">{s.saveMsg}</span>}
      </div>
    </div>
  );
});

function Admin({ days, setDays, onReload }) {
  // статус загрузки/сохранения по каждому дню, ключ = id дня
  const [stMap, setStMap] = useState({});
  // ссылка на актуальные дни для асинхронных обработчиков (без пересоздания колбэков)
  const daysRef = useRef(days);
  daysRef.current = days;

  const setSt = useCallback((id, patch) => setStMap((s) => ({ ...s, [id]: { ...(s[id] || {}), ...patch } })), []);

  // одна стабильная точка правки дня по индексу, через функциональный setState
  const patchDay = useCallback((di, patch) => {
    setDays((ds) => ds.map((d, i) => (i === di ? { ...d, ...(typeof patch === "function" ? patch(d) : patch) } : d)));
  }, [setDays]);

  const onTitle = useCallback((di, v) => patchDay(di, { title: v }), [patchDay]);
  const onLesson = useCallback((di, v) => patchDay(di, { lesson: v }), [patchDay]);
  const onTaskText = useCallback((di, ti, v) => patchDay(di, (x) => ({ ...x, tasks: x.tasks.map((tt, j) => (j === ti ? { ...tt, text: v } : tt)) })), [patchDay]);
  const onTaskRemove = useCallback((di, ti) => patchDay(di, (x) => ({ ...x, tasks: x.tasks.filter((_, j) => j !== ti) })), [patchDay]);
  const onTaskAdd = useCallback((di) => patchDay(di, (x) => ({ ...x, tasks: [...x.tasks, { id: "new-" + Date.now(), text: "Новое задание", done: false, answer: "" }] })), [patchDay]);

  const addDay = useCallback(() => setDays((ds) => [...ds, {
    id: (ds.length ? ds[ds.length - 1].id : 0) + 1, title: "Новый день", lesson: "Текст урока.", duration: 420, audioPath: "", audioName: "", note: "",
    tasks: [{ id: "new-" + Date.now(), text: "Новое задание", done: false, answer: "" }],
  }]), [setDays]);

  // выбрали файл аудио: проверяем, грузим в Storage, привязываем к дню, показываем плеер
  const onPickAudio = useCallback(async (di, file) => {
    const d = daysRef.current[di];
    if (!file) return;
    const ext = extOf(file.name);
    if (!AUDIO_EXT.includes(ext)) {
      setSt(d.id, { up: "error", msg: "Формат «." + ext + "» не поддержан. Нужен mp3, m4a, wav или ogg. Для веба надёжнее mp3 и m4a.", preview: null });
      return;
    }
    const mb = file.size / 1024 / 1024;
    if (mb > MAX_AUDIO_MB) {
      setSt(d.id, { up: "error", msg: "Файл весит " + mb.toFixed(1) + " МБ, это больше лимита " + MAX_AUDIO_MB + " МБ. Сожми его или сохрани как mp3.", preview: null });
      return;
    }
    setSt(d.id, { up: "uploading", progress: 0, msg: "", preview: null });
    try {
      const dur = await readAudioDuration(file);
      const path = "day-" + d.id + "/" + Date.now() + "-" + slugFile(file.name);
      await uploadAudioFile(path, file, (p) => setSt(d.id, { up: "uploading", progress: p }));
      const preview = await signedAudioUrl(path);
      const durSec = dur ? Math.round(dur) : d.duration;
      patchDay(di, (x) => ({ ...x, audioPath: path, audioName: file.name, duration: durSec }));
      // сразу привязываем аудио к дню в базе, чтобы ссылка не потерялась
      const cur = daysRef.current[di];
      const { error } = await sb.from("days").upsert(
        { day_number: d.id, title: cur.title, lesson: cur.lesson, audio_url: path, audio_name: file.name, duration_min: durSec / 60 },
        { onConflict: "day_number" }
      );
      if (error) throw error;
      setSt(d.id, { up: "done", progress: 100, msg: file.name, preview });
    } catch (e) {
      setSt(d.id, { up: "error", msg: (e && e.message) || "Не удалось загрузить файл.", preview: null });
    }
  }, [patchDay, setSt]);

  // сохранить все правки дня в базу: название, текст, ссылку на аудио и задания
  const onSaveDay = useCallback(async (di) => {
    const d = daysRef.current[di];
    setSt(d.id, { save: "saving", saveMsg: "" });
    try {
      const { error: de } = await sb.from("days").upsert({
        day_number: d.id,
        title: d.title,
        lesson: d.lesson,
        audio_url: d.audioPath || null,
        audio_name: d.audioName || null,
        duration_min: (Number(d.duration) || 0) / 60,
      }, { onConflict: "day_number" });
      if (de) throw de;

      // задания: уже существующие (с UUID) обновляем, новые вставляем, пропавшие удаляем.
      // Так личные ответы участников по неизменённым заданиям не теряются.
      const { data: existing, error: ee } = await sb.from("tasks").select("id,position").eq("day_number", d.id);
      if (ee) throw ee;
      const keepIds = d.tasks.filter((t) => isUuid(t.id)).map((t) => t.id);
      const toDelete = (existing || []).filter((r) => !keepIds.includes(r.id)).map((r) => r.id);
      if (toDelete.length) { const { error } = await sb.from("tasks").delete().in("id", toDelete); if (error) throw error; }

      let maxPos = (existing || []).reduce((m, r) => Math.max(m, r.position || 0), 0);
      const remap = [];
      for (let i = 0; i < d.tasks.length; i++) {
        const t = d.tasks[i];
        const text = (t.text || "").trim();
        if (!text) continue;
        if (isUuid(t.id)) {
          const { error } = await sb.from("tasks").update({ text }).eq("id", t.id);
          if (error) throw error;
        } else {
          maxPos += 1;
          const { data, error } = await sb.from("tasks").insert({ day_number: d.id, position: maxPos, text }).select("id").single();
          if (error) throw error;
          remap.push({ idx: i, id: data.id });
        }
      }
      // подменяем временные id заданий настоящими, чтобы повторное «Сохранить» работало
      if (remap.length) {
        setDays((ds) => ds.map((x, ix) => ix !== di ? x : {
          ...x, tasks: x.tasks.map((t, j) => { const f = remap.find((r) => r.idx === j); return f ? { ...t, id: f.id } : t; })
        }));
      }
      setSt(d.id, { save: "saved", saveMsg: "Сохранено" });
      setTimeout(() => setSt(d.id, { save: "idle", saveMsg: "" }), 3500);
    } catch (e) {
      setSt(d.id, { save: "error", saveMsg: (e && e.message) || "Не удалось сохранить." });
    }
  }, [setDays, setSt]);

  return (
    <div className="page">
      <div className="head-row">
        <div>
          <div className="eyebrow">Управление</div>
          <h1>Админ</h1>
          <div className="sub">Доступы участников и контент дней.</div>
        </div>
      </div>

      <AccessSection />

      <div className="eyebrow" style={{ margin: "26px 0 14px" }}>Дни и уроки</div>
      <div className="block-sub muted" style={{ marginTop: -8, marginBottom: 14 }}>Меняй названия, тексты уроков, аудио и задания. Загрузи файл, потом нажми «Сохранить день», и правки уйдут в базу, останутся навсегда и покажутся участникам.</div>
      <div className="adm-actions">
        <button className="btn btn-primary btn-sm" onClick={addDay}>+ Добавить день</button>
        <button className="btn btn-ghost btn-sm" onClick={onReload}>Обновить из базы</button>
      </div>

      <div className="adm-list">
        {days.map((d, di) => (
          <DayCard key={d.id} day={d} di={di} status={stMap[d.id]}
            onTitle={onTitle} onLesson={onLesson} onTaskText={onTaskText}
            onTaskRemove={onTaskRemove} onTaskAdd={onTaskAdd}
            onPickAudio={onPickAudio} onSaveDay={onSaveDay} />
        ))}
      </div>
    </div>
  );
}

/* ========================= Nav ========================= */
const NAV = [
  { k: "dashboard", label: "Мой прогресс", short: "Прогресс", icon: Ico.home },
  { k: "map", label: "Карта дней", short: "Карта", icon: Ico.map },
  { k: "diary", label: "Дневник", short: "Дневник", icon: Ico.book },
  { k: "guide", label: "Инструкция", short: "Инструкция", icon: Ico.info },
  { k: "stats", label: "Статистика", short: "Сводка", icon: Ico.chart, adminOnly: true },
  { k: "admin", label: "Админ", short: "Админ", icon: Ico.cog, adminOnly: true },
];

// видимые пункты меню: помеченные adminOnly видны только админам
const navItems = (isAdmin) => NAV.filter((it) => !it.adminOnly || isAdmin);

function Sidebar({ tab, setTab, onLogout, profile, isAdmin }) {
  const name = (profile && profile.name) || "Профиль";
  const email = (profile && profile.email) || "";
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-mark">₽</div>
        <div><div className="nm">Протокол денег</div><div className="sub">17 дней</div></div>
      </div>
      <nav className="sb-nav">
        {navItems(isAdmin).map((it) => (
          <button key={it.k} className={tab === it.k ? "active" : ""} onClick={() => setTab(it.k)}><it.icon /> {it.label}</button>
        ))}
      </nav>
      <div className="sb-foot">
        <div className="sb-user">
          <div className="sb-ava">{initial}</div>
          <div className="who"><div className="n">{name}</div><div className="e">{email}</div></div>
          <button className="sb-logout" title="Выйти" onClick={onLogout}><Ico.out /></button>
        </div>
      </div>
    </aside>
  );
}

function BottomNav({ tab, setTab, isAdmin }) {
  return (
    <nav className="bottomnav">
      {navItems(isAdmin).map((it) => (
        <button key={it.k} className={tab === it.k ? "active" : ""} onClick={() => setTab(it.k)}><it.icon /> {it.short}</button>
      ))}
    </nav>
  );
}

/* ========================= Splash / служебные экраны ========================= */
function Splash({ text, sub, onLogout }) {
  return (
    <div className="auth-wrap">
      <div className="auth-box">
        <div className="brand"><div className="mark">₽</div></div>
        <div className="card center">
          <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.4 }}>{text}</div>
          {sub && <div className="muted" style={{ fontSize: 12.5, marginTop: 10, wordBreak: "break-word", lineHeight: 1.5 }}>{sub}</div>}
          {onLogout && <><div className="spacer" /><div className="spacer" /><button className="btn btn-ghost" onClick={onLogout}>Выйти</button></>}
        </div>
      </div>
    </div>
  );
}

/* ========================= App ========================= */
function App() {
  const [session, setSession] = useState(undefined); // undefined = ещё проверяем
  const [profile, setProfile] = useState(null);
  const [days, setDays] = useState(null);            // null = ещё не загружены
  const [loadErr, setLoadErr] = useState("");
  const [saveErr, setSaveErr] = useState("");        // ошибка сохранения, показываем человеку
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [openDay, setOpenDay] = useState(null);
  const loadedUid = useRef(null);                    // для какого пользователя данные уже загружены

  // сессия: восстановление при загрузке и слежение за входом/выходом
  useEffect(() => {
    if (!sb) { setSession(null); return; }
    // не дёргаем состояние, если по сути сессия не изменилась: тот же пользователь и тот же токен.
    // Supabase шлёт событие при каждом фокусе вкладки и фоновом обновлении токена,
    // а лишний setSession перерисовывает всё приложение и ощущается как подлагивание.
    const applySession = (s) => setSession((prev) => {
      const next = s || null;
      if (prev && next && prev.user && next.user && prev.user.id === next.user.id && prev.access_token === next.access_token) return prev;
      if (prev === null && next === null) return prev;
      return next;
    });
    sb.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => applySession(s));
    return () => { if (sub && sub.subscription) sub.subscription.unsubscribe(); };
  }, []);

  const reload = async () => {
    setLoadErr("");
    try { setDays(await loadDaysFromDb()); }
    catch (e) { setDays([]); setLoadErr((e && e.message) || "Не удалось загрузить данные."); }
  };

  // загрузка контента и профиля. Грузим один раз на пользователя, чтобы повторные
  // события сессии (обновление токена и т.п.) не перетирали прогресс пустыми данными.
  useEffect(() => {
    if (session) {
      const uid = session.user.id;
      if (loadedUid.current === uid) return;
      loadedUid.current = uid;
      reload();
      sb.from("profiles").select("name,email").eq("id", uid).maybeSingle()
        .then(({ data }) => setProfile(data || { name: (session.user.user_metadata && session.user.user_metadata.name) || "", email: session.user.email }));
      sb.rpc("is_admin").then(({ data }) => setIsAdmin(!!data)).catch(() => setIsAdmin(false));
    } else {
      loadedUid.current = null;
      setDays(null); setProfile(null); setOpenDay(null); setTab("dashboard"); setIsAdmin(false);
    }
  }, [session]);

  const unlockedCount = useMemo(() => (days ? unlockedCountNow(days.length) : 0), [days]);
  const currentIndex = useMemo(() => {
    if (!days || !days.length) return 0;
    return computeCurrentIndex(days, unlockedCount);
  }, [days, unlockedCount]);

  // экраны-заглушки до готовности приложения
  if (!sb) return <Splash text="Нет ключей Supabase" sub="Создай config.js из config.example.js и обнови страницу." />;
  if (session === undefined) return <Splash text="Загрузка…" />;
  if (!session) return <Auth />;
  if (days === null) return <Splash text="Загружаю курс…" />;
  if (loadErr) return <Splash text="Не удалось загрузить дни" sub={"Запусти SQL-скрипт supabase/schema.sql в Supabase, затем обнови страницу. Подробности: " + loadErr} onLogout={() => sb.auth.signOut()} />;
  if (!days.length) return <Splash text="В базе пока нет дней" sub="Запусти раздел наполнения в supabase/schema.sql, затем обнови страницу." onLogout={() => sb.auth.signOut()} />;

  const uid = session.user.id;

  const setLocalTask = (di, tid, patch) =>
    setDays((ds) => ds.map((d, i) => (i !== di ? d : { ...d, tasks: d.tasks.map((t) => (t.id === tid ? { ...t, ...patch } : t)) })));

  // ВАЖНО: запрос в supabase-js выполняется только при await/then.
  // Поэтому каждую запись обязательно ждём и проверяем ошибку, а не глотаем её.
  const persist = async (builder, what) => {
    try {
      const { error } = await builder;
      if (error) throw error;
      return true;
    } catch (e) {
      console.error("Ошибка сохранения (" + what + "):", e);
      setSaveErr("Не удалось сохранить " + what + ". " + ((e && e.message) || ""));
      setTimeout(() => setSaveErr(""), 6000);
      return false;
    }
  };

  const saveAnswer = (tid, answer, done) =>
    persist(sb.from("task_answers").upsert({ user_id: uid, task_id: tid, answer: answer, done: done, updated_at: nowISO() }, { onConflict: "user_id,task_id" }), "ответ");
  const saveProgress = (dayNumber, completed) =>
    persist(sb.from("progress").upsert({ user_id: uid, day_number: dayNumber, completed: completed, completed_at: completed ? nowISO() : null }, { onConflict: "user_id,day_number" }), "прогресс");

  const onAnswer = (di, tid, v) => setLocalTask(di, tid, { answer: v });
  const onAnswerBlur = (di, tid) => { const t = days[di].tasks.find((x) => x.id === tid); if (t && t.answer && t.answer.trim()) saveAnswer(tid, t.answer, t.done); };
  const onConfirm = (di, tid) => {
    setLocalTask(di, tid, { done: true });
    const day = days[di]; const t = day.tasks.find((x) => x.id === tid);
    saveAnswer(tid, t ? t.answer : "", true);
    saveProgress(day.id, day.tasks.every((x) => (x.id === tid ? true : x.done)));
  };
  const onEdit = (di, tid) => {
    setLocalTask(di, tid, { done: false });
    const t = days[di].tasks.find((x) => x.id === tid);
    saveAnswer(tid, t ? t.answer : "", false);
    saveProgress(days[di].id, false);
  };
  const onNote = (di, v) => {
    setDays((ds) => ds.map((d, i) => (i !== di ? d : { ...d, note: v })));
    persist(sb.from("notes").upsert({ user_id: uid, day_number: days[di].id, text: v, updated_at: nowISO() }, { onConflict: "user_id,day_number" }), "заметку");
  };

  const goTab = (t) => { setOpenDay(null); setTab(t); };
  const logout = () => sb.auth.signOut();
  // открыть день можно только если он доступен (пройден или сегодняшний). Админу открыто всё.
  const openDayGuarded = (i) => {
    if (i == null || !days[i]) { setOpenDay(null); return; }
    if (isAdmin || dayOpenable(dayStatus(days[i], i, unlockedCount, currentIndex))) setOpenDay(i);
  };

  let content;
  if (openDay !== null) {
    content = <DayScreen day={days[openDay]} dayIndex={openDay} total={days.length} onBack={() => setOpenDay(null)}
      onAnswer={(tid, v) => onAnswer(openDay, tid, v)}
      onAnswerBlur={(tid) => onAnswerBlur(openDay, tid)}
      onConfirm={(tid) => onConfirm(openDay, tid)}
      onEdit={(tid) => onEdit(openDay, tid)}
      onNote={(v) => onNote(openDay, v)} />;
  } else if (tab === "dashboard") {
    content = <Dashboard days={days} currentIndex={currentIndex} unlockedCount={unlockedCount} onOpenDay={openDayGuarded} onGoDiary={() => goTab("diary")} userName={(profile && profile.name && profile.name.trim()) || ""} isAdmin={isAdmin} />;
  } else if (tab === "map") {
    content = <DayMap days={days} currentIndex={currentIndex} unlockedCount={unlockedCount} onOpenDay={openDayGuarded} isAdmin={isAdmin} />;
  } else if (tab === "diary") {
    content = <Diary days={days} onOpenDay={openDayGuarded} />;
  } else if (tab === "guide") {
    content = <Guide />;
  } else if (tab === "stats" && isAdmin) {
    content = <StatsSection totalDays={days.length} />;
  } else if (tab === "admin" && isAdmin) {
    content = <Admin days={days} setDays={setDays} onReload={reload} />;
  } else {
    content = <Dashboard days={days} currentIndex={currentIndex} unlockedCount={unlockedCount} onOpenDay={openDayGuarded} onGoDiary={() => goTab("diary")} userName={(profile && profile.name && profile.name.trim()) || ""} isAdmin={isAdmin} />;
  }

  return (
    <div className="layout">
      {saveErr && <div className="save-banner">{saveErr}</div>}
      <Sidebar tab={tab} setTab={goTab} onLogout={logout} profile={profile} isAdmin={isAdmin} />
      <main className="main">
        <div className="content">{content}</div>
      </main>
      <BottomNav tab={tab} setTab={goTab} isAdmin={isAdmin} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
