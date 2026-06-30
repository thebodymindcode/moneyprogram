/* СГЕНЕРИРОВАНО из app.jsx через build.py. Не редактируй вручную, правь app.jsx и пересобери. */
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  memo
} = React;
const sb = window.sb;
const nowISO = () => new Date().toISOString();
const AUDIO_BUCKET = "lesson-audio";
const MAX_AUDIO_MB = 50;
const AUDIO_EXT = ["mp3", "m4a", "wav", "ogg"];
const SIGNED_TTL = 60 * 60 * 6;
const isUuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const extOf = name => (String(name).split(".").pop() || "").toLowerCase();
const slugFile = name => String(name).toLowerCase().replace(/[^a-z0-9.\-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "audio";
const AUDIO_MIME = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg"
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function signedAudioUrl(path, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      await sb.auth.getSession();
      const {
        data,
        error
      } = await sb.storage.from(AUDIO_BUCKET).createSignedUrl(path, SIGNED_TTL);
      if (error) throw error;
      if (data && data.signedUrl) return data.signedUrl;
      throw new Error("пустая ссылка на аудио");
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(500 * (i + 1));
    }
  }
  throw lastErr || new Error("не удалось подписать ссылку");
}
function readAudioDuration(file) {
  return new Promise(resolve => {
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement("audio");
      a.preload = "metadata";
      a.onloadedmetadata = () => {
        const d = a.duration;
        URL.revokeObjectURL(url);
        resolve(isFinite(d) ? d : 0);
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      a.src = url;
    } catch (e) {
      resolve(0);
    }
  });
}
function uploadAudioFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    sb.auth.getSession().then(({
      data
    }) => {
      const token = data && data.session && data.session.access_token;
      if (!token) return reject(new Error("Сессия истекла. Войди заново и повтори загрузку."));
      const url = window.SUPABASE_URL + "/storage/v1/object/" + AUDIO_BUCKET + "/" + path;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.setRequestHeader("x-upsert", "true");
      const ctype = file.type || AUDIO_MIME[extOf(file.name)] || "application/octet-stream";
      xhr.setRequestHeader("Content-Type", ctype);
      xhr.upload.onprogress = e => {
        if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(true);else if (xhr.status === 403) reject(new Error("Нет прав на загрузку. Проверь, что ты в списке админов и запущен storage_audio.sql."));else reject(new Error("Хранилище вернуло " + xhr.status + ". " + (xhr.responseText || "")));
      };
      xhr.onerror = () => reject(new Error("Сеть подвела при загрузке. Проверь интернет и повтори."));
      xhr.send(file);
    }).catch(reject);
  });
}
const dayWord = n => {
  const a = Math.abs(n) % 100,
    b = n % 10;
  if (a > 10 && a < 20) return "дней";
  if (b > 1 && b < 5) return "дня";
  if (b === 1) return "день";
  return "дней";
};
const taskWord = n => {
  const a = Math.abs(n) % 100,
    b = n % 10;
  if (a > 10 && a < 20) return "заданий";
  if (b > 1 && b < 5) return "задания";
  if (b === 1) return "задание";
  return "заданий";
};
const STATE_LS = "mp_state";
function stateLSget(uid) {
  try {
    return JSON.parse(localStorage.getItem(STATE_LS + ":" + uid)) || {};
  } catch (e) {
    return {};
  }
}
function stateLSset(uid, dn, val) {
  try {
    const m = stateLSget(uid);
    m[dn] = val;
    localStorage.setItem(STATE_LS + ":" + uid, JSON.stringify(m));
  } catch (e) {}
}
const DAYS_CACHE = "mp_days_v2";
function readDaysCache(uid) {
  try {
    const r = JSON.parse(localStorage.getItem(DAYS_CACHE + ":" + uid));
    return Array.isArray(r) && r.length ? r : null;
  } catch (e) {
    return null;
  }
}
function writeDaysCache(uid, days) {
  try {
    if (Array.isArray(days) && days.length) localStorage.setItem(DAYS_CACHE + ":" + uid, JSON.stringify(days));
  } catch (e) {}
}
async function loadDaysFromDb() {
  const wantCheckins = !!cfg().CHECKINS_READY;
  const reqs = [sb.from("days").select("*").order("day_number", {
    ascending: true
  }), sb.from("tasks").select("*").order("day_number", {
    ascending: true
  }).order("position", {
    ascending: true
  }), sb.from("task_answers").select("*"), sb.from("notes").select("*")];
  if (wantCheckins) reqs.push(sb.from("checkins").select("day_number,value"));
  const results = await Promise.all(reqs);
  const [daysRes, tasksRes, ansRes, notesRes] = results;
  const ciRes = wantCheckins ? results[4] : null;
  if (daysRes.error) throw daysRes.error;
  if (tasksRes.error) throw tasksRes.error;
  const ansMap = {};
  (ansRes.data || []).forEach(a => {
    ansMap[a.task_id] = a;
  });
  const noteMap = {};
  (notesRes.data || []).forEach(n => {
    noteMap[n.day_number] = n.text;
  });
  const ciMap = {};
  if (ciRes && !ciRes.error && Array.isArray(ciRes.data)) ciRes.data.forEach(c => {
    ciMap[c.day_number] = c.value;
  });
  return (daysRes.data || []).map(d => ({
    id: d.day_number,
    title: d.title,
    lesson: d.lesson || "",
    duration: Math.round((Number(d.duration_min) || 0) * 60),
    audioPath: d.audio_url || "",
    audioName: d.audio_name || "",
    note: noteMap[d.day_number] || "",
    state: ciMap[d.day_number] != null ? Number(ciMap[d.day_number]) : null,
    tasks: (tasksRes.data || []).filter(t => t.day_number === d.day_number).map(t => ({
      id: t.id,
      text: t.text,
      done: !!(ansMap[t.id] && ansMap[t.id].done),
      answer: ansMap[t.id] && ansMap[t.id].answer || ""
    }))
  }));
}
const NOT_ALLOWED_MSG = "Этот e-mail не в списке участников программы. Доступ открывается после оплаты.";
function authErrorText(e) {
  const m = (e && e.message || "").toLowerCase();
  if (m.includes("email_not_allowed") || m.includes("not allowed") || m.includes("saving new user") || m.includes("database error")) return NOT_ALLOWED_MSG;
  if (m.includes("invalid login")) return "Неверная почта или пароль.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Такая почта уже зарегистрирована.";
  if (m.includes("email not confirmed")) return "Почта не подтверждена. Загляни в письмо от Supabase.";
  if (m.includes("at least 6") || m.includes("password should be")) return "Пароль должен быть не короче 6 символов.";
  if (m.includes("unable to validate email") || m.includes("invalid email")) return "Проверь, правильно ли введена почта.";
  if (m.includes("rate limit") || m.includes("too many")) return "Слишком много попыток, попробуй чуть позже.";
  return "Не получилось. Попробуй ещё раз.";
}
const isDayDone = d => d.tasks.length > 0 && d.tasks.every(t => t.done);
const dayProgress = d => d.tasks.length ? d.tasks.filter(t => t.done).length : 0;
const fmt = s => {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ":" + String(r).padStart(2, "0");
};
const durLabel = s => Math.round(s / 60) + " мин";
const STAGES = [{
  from: 1,
  to: 4,
  name: "Снимаем тревогу",
  hint: "Личная причина, тревога, привычки трат и правила из детства."
}, {
  from: 5,
  to: 8,
  name: "Меняем состояние",
  hint: "Состояние, тело, гормоны и новая опора."
}, {
  from: 9,
  to: 12,
  name: "Сдвигаем внутренний предел",
  hint: "Предел дохода и образ себя."
}, {
  from: 13,
  to: 15,
  name: "Открываем источники денег",
  hint: "Берёшь сам, через других людей, доверие и поток."
}, {
  from: 16,
  to: 17,
  name: "Закрепляем",
  hint: "Сборка системы и новая норма."
}];
const stageOf = dayId => {
  const i = STAGES.findIndex(s => dayId >= s.from && dayId <= s.to);
  return i === -1 ? STAGES.length - 1 : i;
};
const lower1 = s => s.charAt(0).toLowerCase() + s.slice(1);
const DAY_MS = 86400000;
const cfg = () => window.APP_CONFIG || {};
function startInstant() {
  const c = cfg();
  const p = String(c.START_DATE || "2026-07-01").split("-").map(Number);
  return Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1, (c.OPEN_HOUR || 0) - (c.TZ_OFFSET_HOURS || 0), 0, 0);
}
function unlockedCountNow(total) {
  if (cfg().TEST_OPEN_ALL) return total;
  const elapsed = Date.now() - startInstant();
  if (elapsed < 0) return 0;
  return Math.max(0, Math.min(total, Math.floor(elapsed / DAY_MS) + 1));
}
const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function unlockLabel(dayNumber) {
  const c = cfg();
  const local = new Date(startInstant() + (dayNumber - 1) * DAY_MS + (c.TZ_OFFSET_HOURS || 0) * 3600000);
  return "Откроется " + local.getUTCDate() + " " + MONTHS_RU[local.getUTCMonth()];
}
function computeCurrentIndex(days, unlockedCount) {
  return Math.max(0, Math.min(days.length - 1, unlockedCount - 1));
}
function dayStatus(d, i, unlockedCount, currentIndex, isAdmin) {
  const unlocked = i + 1 <= unlockedCount;
  if (unlocked || isAdmin) {
    if (isDayDone(d)) return "done";
    if (unlocked && i === unlockedCount - 1) return "today";
    return "open";
  }
  if (i === unlockedCount) return "next";
  return "hidden";
}
const STATUS_LABEL = {
  done: "Пройден",
  today: "Сегодня",
  open: "Доступен",
  next: "Следующий",
  hidden: "Закрыто"
};
const dayOpenable = status => status === "done" || status === "today" || status === "open";
function lockLine(status, d, unlockedCount) {
  return unlockLabel(d.id);
}
const Ico = {
  check: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "15",
    height: "15"
  }, p), React.createElement("path", {
    d: "M5 13l4 4L19 7",
    fill: "none",
    stroke: "#fff",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })),
  chev: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "20",
    height: "20"
  }, p), React.createElement("path", {
    d: "M9 6l6 6-6 6",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })),
  back: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "17",
    height: "17"
  }, p), React.createElement("path", {
    d: "M15 6l-6 6 6 6",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })),
  home: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M3 11l9-8 9 8"
  }), React.createElement("path", {
    d: "M5 10v10h14V10"
  })),
  map: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("circle", {
    cx: "6",
    cy: "7",
    r: "2.2"
  }), React.createElement("circle", {
    cx: "18",
    cy: "17",
    r: "2.2"
  }), React.createElement("path", {
    d: "M6 9.2v3.3a3 3 0 003 3h6"
  })),
  cog: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), React.createElement("path", {
    d: "M19.4 13.5a1.6 1.6 0 00.3 1.7l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H3a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.7.3 1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.7-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.7V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"
  })),
  lock: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18"
  }, p), React.createElement("path", {
    d: "M7 11V8a5 5 0 0110 0v3",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.1",
    strokeLinecap: "round"
  }), React.createElement("rect", {
    x: "4.4",
    y: "10.4",
    width: "15.2",
    height: "11.2",
    rx: "3.6",
    fill: "currentColor"
  }), React.createElement("circle", {
    cx: "12",
    cy: "14.8",
    r: "1.7",
    fill: "#fff"
  }), React.createElement("path", {
    d: "M11.2 15.5h1.6l-.42 3a.38.38 0 01-.76 0z",
    fill: "#fff"
  })),
  play: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "22",
    height: "22"
  }, p), React.createElement("path", {
    d: "M8 5.5v13l11-6.5z",
    fill: "currentColor"
  })),
  pause: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "22",
    height: "22"
  }, p), React.createElement("rect", {
    x: "7",
    y: "5",
    width: "3.4",
    height: "14",
    rx: "1.2",
    fill: "currentColor"
  }), React.createElement("rect", {
    x: "13.6",
    y: "5",
    width: "3.4",
    height: "14",
    rx: "1.2",
    fill: "currentColor"
  })),
  wave: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "24",
    height: "24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, p), React.createElement("path", {
    d: "M4 12h2M9 8v8M14 5v14M19 9v6"
  })),
  speed: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "14",
    height: "14",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M12 21a9 9 0 1 0-9-9"
  }), React.createElement("path", {
    d: "M12 12l4-3.5"
  }), React.createElement("path", {
    d: "M3 12H1.5M5 7l-1-1"
  })),
  upload: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M12 16V5M8 9l4-4 4 4"
  }), React.createElement("path", {
    d: "M5 19h14"
  })),
  download: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M12 4v11M8 11l4 4 4-4"
  }), React.createElement("path", {
    d: "M5 20h14"
  })),
  share: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M12 3v13M8 7l4-4 4 4"
  }), React.createElement("path", {
    d: "M6 12H5a1 1 0 00-1 1v6a1 1 0 001 1h14a1 1 0 001-1v-6a1 1 0 00-1-1h-1"
  })),
  out: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M14 7V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2h6a2 2 0 002-2v-2"
  }), React.createElement("path", {
    d: "M18 15l3-3-3-3M21 12H9"
  })),
  book: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M5 4h11a2 2 0 012 2v14H7a2 2 0 01-2-2z"
  }), React.createElement("path", {
    d: "M5 4a2 2 0 00-2 2v12a2 2 0 002 2"
  }), React.createElement("path", {
    d: "M9 8h6M9 12h6"
  })),
  mind: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M12 4.5a3 3 0 00-3 3v9a3 3 0 003 3"
  }), React.createElement("path", {
    d: "M12 4.5a3 3 0 013 3v9a3 3 0 01-3 3"
  }), React.createElement("path", {
    d: "M9 8.5H7.5a2 2 0 000 4H9M15 8.5h1.5a2 2 0 010 4H15"
  })),
  layers: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M12 3l9 5-9 5-9-5z"
  }), React.createElement("path", {
    d: "M3 13l9 5 9-5"
  })),
  body: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("circle", {
    cx: "12",
    cy: "6",
    r: "3"
  }), React.createElement("path", {
    d: "M5 21c0-4 3.1-7 7-7s7 3 7 7"
  })),
  drop: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    width: "18",
    height: "18",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M12 3.2s6 5.7 6 9.8a6 6 0 01-12 0c0-4.1 6-9.8 6-9.8z"
  })),
  chart: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M3 21h18"
  }), React.createElement("rect", {
    x: "5",
    y: "11",
    width: "3.2",
    height: "7",
    rx: "1"
  }), React.createElement("rect", {
    x: "10.4",
    y: "6.5",
    width: "3.2",
    height: "11.5",
    rx: "1"
  }), React.createElement("rect", {
    x: "15.8",
    y: "13.5",
    width: "3.2",
    height: "4.5",
    rx: "1"
  })),
  info: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9"
  }), React.createElement("path", {
    d: "M12 8h.01"
  }), React.createElement("path", {
    d: "M11 12h1v4h1"
  })),
  compass: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "8.5"
  }), React.createElement("path", {
    d: "M14.9 9.1l-1.7 4.1-4.1 1.7 1.7-4.1z"
  })),
  login: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M14 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3"
  }), React.createElement("path", {
    d: "M10 16l4-4-4-4"
  }), React.createElement("path", {
    d: "M14 12H4"
  })),
  grid: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("rect", {
    x: "4",
    y: "4",
    width: "7",
    height: "7",
    rx: "1.6"
  }), React.createElement("rect", {
    x: "13",
    y: "4",
    width: "7",
    height: "7",
    rx: "1.6"
  }), React.createElement("rect", {
    x: "4",
    y: "13",
    width: "7",
    height: "7",
    rx: "1.6"
  }), React.createElement("rect", {
    x: "13",
    y: "13",
    width: "7",
    height: "7",
    rx: "1.6"
  })),
  calday: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("rect", {
    x: "3.5",
    y: "5",
    width: "17",
    height: "15.5",
    rx: "2.6"
  }), React.createElement("path", {
    d: "M3.5 9.5h17"
  }), React.createElement("path", {
    d: "M8 3.3v3M16 3.3v3"
  }), React.createElement("path", {
    d: "M8.3 14.4l2.4 2.4 4.8-4.8"
  })),
  phones: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M4 13.5v-1.5a8 8 0 0116 0v1.5"
  }), React.createElement("rect", {
    x: "3",
    y: "13",
    width: "4.2",
    height: "6.5",
    rx: "1.6"
  }), React.createElement("rect", {
    x: "16.8",
    y: "13",
    width: "4.2",
    height: "6.5",
    rx: "1.6"
  })),
  doc: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M6.5 3.5h6.5l4.5 4.5V20a1 1 0 01-1 1H6.5a1 1 0 01-1-1V4.5a1 1 0 011-1z"
  }), React.createElement("path", {
    d: "M13 3.5V9h5"
  }), React.createElement("path", {
    d: "M9 13.5h6M9 16.5h4"
  })),
  checksq: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("rect", {
    x: "4",
    y: "4",
    width: "16",
    height: "16",
    rx: "3.4"
  }), React.createElement("path", {
    d: "M8.4 12.2l2.5 2.5 4.7-5"
  })),
  pen: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M14.3 5.6l4.1 4.1"
  }), React.createElement("path", {
    d: "M4 20l1.1-4.2L16 5a2.05 2.05 0 012.9 2.9L8 18.9 4 20z"
  })),
  sunrise: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M3 19h18"
  }), React.createElement("path", {
    d: "M7.5 19a4.5 4.5 0 019 0"
  }), React.createElement("path", {
    d: "M12 3.5v4.5"
  }), React.createElement("path", {
    d: "M4.6 11.2l1.5 1.5M19.4 11.2l-1.5 1.5"
  })),
  shield: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("path", {
    d: "M12 3.4l7 3v4.8c0 4.2-2.9 7.7-7 9.1-4.1-1.4-7-4.9-7-9.1V6.4z"
  }), React.createElement("path", {
    d: "M9 12l2 2 4-4"
  })),
  help: p => React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.7",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, p), React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "8.5"
  }), React.createElement("path", {
    d: "M9.6 9.3a2.5 2.5 0 014.9.7c0 1.7-2.5 2.2-2.5 3.9"
  }), React.createElement("path", {
    d: "M12 16.6h.01"
  }))
};
function Ring({
  value,
  total
}) {
  const r = 56,
    c = 2 * Math.PI * r;
  const pct = total ? value / total : 0;
  return React.createElement("div", {
    className: "ring"
  }, React.createElement("svg", {
    width: "132",
    height: "132",
    viewBox: "0 0 132 132"
  }, React.createElement("defs", null, React.createElement("linearGradient", {
    id: "metal",
    x1: "0",
    y1: "0",
    x2: "1",
    y2: "1"
  }, React.createElement("stop", {
    offset: "0",
    stopColor: "#5a6c83"
  }), React.createElement("stop", {
    offset: ".5",
    stopColor: "#2c3848"
  }), React.createElement("stop", {
    offset: "1",
    stopColor: "#171f29"
  }))), React.createElement("circle", {
    cx: "66",
    cy: "66",
    r: r,
    fill: "none",
    stroke: "#e2e8ef",
    strokeWidth: "11"
  }), React.createElement("circle", {
    cx: "66",
    cy: "66",
    r: r,
    fill: "none",
    stroke: "url(#metal)",
    strokeWidth: "11",
    strokeLinecap: "round",
    strokeDasharray: c,
    strokeDashoffset: c * (1 - pct),
    style: {
      transition: "stroke-dashoffset .6s ease"
    }
  })), React.createElement("div", {
    className: "center"
  }, React.createElement("div", {
    className: "day"
  }, "\u041F\u0420\u041E\u0419\u0414\u0415\u041D\u041E"), React.createElement("div", {
    className: "big"
  }, value), React.createElement("div", {
    className: "of"
  }, "\u0438\u0437 ", total)));
}
function Auth() {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const reg = mode === "register";
  const switchMode = m => {
    setMode(m);
    setErr("");
    setInfo("");
  };
  const submit = async () => {
    setErr("");
    setInfo("");
    if (!email.trim() || !pass) {
      setErr("Впиши почту и пароль.");
      return;
    }
    if (reg && !name.trim()) {
      setErr("Впиши имя.");
      return;
    }
    if (reg && pass.length < 6) {
      setErr("Пароль должен быть не короче 6 символов.");
      return;
    }
    setBusy(true);
    try {
      if (reg) {
        try {
          const chk = await sb.rpc("is_email_allowed", {
            p_email: email.trim()
          });
          if (!chk.error && chk.data === false) {
            setErr(NOT_ALLOWED_MSG);
            setBusy(false);
            return;
          }
        } catch (e) {}
        const {
          data,
          error
        } = await sb.auth.signUp({
          email: email.trim(),
          password: pass,
          options: {
            data: {
              name: name.trim()
            }
          }
        });
        if (error) throw error;
        if (!data.session) {
          setInfo("Аккаунт создан. Если включено подтверждение почты, открой письмо и подтверди, потом войди.");
          switchMode("login");
        }
      } else {
        const {
          error
        } = await sb.auth.signInWithPassword({
          email: email.trim(),
          password: pass
        });
        if (error) throw error;
      }
    } catch (e) {
      setErr(authErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const onKey = e => {
    if (e.key === "Enter") submit();
  };
  return React.createElement("div", {
    className: "auth-wrap"
  }, React.createElement("div", {
    className: "auth-box"
  }, React.createElement("div", {
    className: "brand"
  }, React.createElement("div", {
    className: "mark"
  }, "\u20BD"), React.createElement("h1", null, "\u041F\u0440\u043E\u0442\u043E\u043A\u043E\u043B \u0434\u0435\u043D\u0435\u0433"), React.createElement("p", null, "17 \u0434\u043D\u0435\u0439, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u043C\u0435\u043D\u044F\u0442\u044C \u043E\u0442\u043D\u043E\u0448\u0435\u043D\u0438\u044F \u0441 \u0434\u0435\u043D\u044C\u0433\u0430\u043C\u0438")), React.createElement("div", {
    className: "card"
  }, reg && React.createElement("div", {
    className: "field field-anim"
  }, React.createElement("label", null, "\u0418\u043C\u044F"), React.createElement("input", {
    className: "input",
    placeholder: "\u041A\u0430\u043A \u0442\u0435\u0431\u044F \u0437\u043E\u0432\u0443\u0442",
    value: name,
    onChange: e => setName(e.target.value),
    onKeyDown: onKey
  })), React.createElement("div", {
    className: "field"
  }, React.createElement("label", null, "\u041F\u043E\u0447\u0442\u0430"), React.createElement("input", {
    className: "input",
    type: "email",
    placeholder: "you@mail.com",
    value: email,
    onChange: e => setEmail(e.target.value),
    onKeyDown: onKey
  })), React.createElement("div", {
    className: "field"
  }, React.createElement("label", null, "\u041F\u0430\u0440\u043E\u043B\u044C"), React.createElement("input", {
    className: "input",
    type: "password",
    placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
    value: pass,
    onChange: e => setPass(e.target.value),
    onKeyDown: onKey
  })), err && React.createElement("div", {
    className: "auth-msg err"
  }, err), info && React.createElement("div", {
    className: "auth-msg info"
  }, info), React.createElement("div", {
    className: "spacer"
  }), React.createElement("button", {
    className: "btn btn-primary",
    onClick: submit,
    disabled: busy
  }, busy ? "Минуту…" : reg ? "Создать аккаунт" : "Войти"), React.createElement("div", {
    className: "auth-switch"
  }, reg ? React.createElement(React.Fragment, null, "\u0423\u0436\u0435 \u0441 \u043D\u0430\u043C\u0438? ", React.createElement("b", {
    onClick: () => switchMode("login")
  }, "\u0412\u043E\u0439\u0442\u0438")) : React.createElement(React.Fragment, null, "\u041D\u0435\u0442 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430? ", React.createElement("b", {
    onClick: () => switchMode("register")
  }, "\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044F")))), React.createElement("p", {
    className: "center faint",
    style: {
      fontSize: 11.5,
      marginTop: 18
    }
  }, "\u0412\u0445\u043E\u0434 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u044B")));
}
function StateChart({
  days
}) {
  const pts = days.filter(d => d.state != null).map(d => ({
    day: d.id,
    v: d.state
  }));
  const W = 320,
    H = 132,
    padX = 16,
    padT = 12,
    padB = 10;
  const innerW = W - padX * 2,
    innerH = H - padT - padB;
  const X = i => pts.length <= 1 ? W / 2 : padX + i / (pts.length - 1) * innerW;
  const Y = v => padT + (1 - v / 10) * innerH;
  const line = pts.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1)).join(" ");
  const area = pts.length > 1 ? line + " L " + X(pts.length - 1).toFixed(1) + " " + (padT + innerH) + " L " + X(0).toFixed(1) + " " + (padT + innerH) + " Z" : "";
  const first = pts.length ? pts[0].v : null;
  const last = pts.length ? pts[pts.length - 1].v : null;
  const delta = pts.length > 1 ? last - first : null;
  const shift = delta == null ? "" : delta > 0 ? "спокойнее на " + delta : delta < 0 ? "пока тревожнее на " + -delta : "держится ровно";
  return React.createElement("div", {
    className: "card span2 state-chart"
  }, React.createElement("div", {
    className: "eyebrow"
  }, "\u041E\u0442 \u0442\u0440\u0435\u0432\u043E\u0433\u0438 \u043A \u0441\u043F\u043E\u043A\u043E\u0439\u0441\u0442\u0432\u0438\u044E"), React.createElement("div", {
    className: "sc-desc"
  }, "\u041A\u0430\u0436\u0434\u044B\u0439 \u0432\u0435\u0447\u0435\u0440 \u0442\u044B \u043E\u0442\u043C\u0435\u0447\u0430\u0435\u0448\u044C, \u0441\u043F\u043E\u043A\u043E\u0439\u043D\u043E \u0438\u043B\u0438 \u0442\u0440\u0435\u0432\u043E\u0436\u043D\u043E \u0442\u0435\u0431\u0435 \u0431\u044B\u043B\u043E \u0441 \u0434\u0435\u043D\u044C\u0433\u0430\u043C\u0438, \u043F\u043E \u0448\u043A\u0430\u043B\u0435 \u043E\u0442 0 \u0434\u043E 10. \u0417\u0434\u0435\u0441\u044C \u0432\u0438\u0434\u043D\u043E, \u043A\u0430\u043A \u0434\u0435\u043D\u044C \u0437\u0430 \u0434\u043D\u0451\u043C \u0442\u0440\u0435\u0432\u043E\u0433\u0430 \u043E\u0442\u0441\u0442\u0443\u043F\u0430\u0435\u0442."), pts.length === 0 ? React.createElement("div", {
    className: "sc-empty"
  }, "\u041F\u0435\u0440\u0432\u0443\u044E \u043E\u0442\u043C\u0435\u0442\u043A\u0443 \u043F\u043E\u0441\u0442\u0430\u0432\u0438\u0448\u044C \u0432 \u043A\u043E\u043D\u0446\u0435 \u0441\u0435\u0433\u043E\u0434\u043D\u044F\u0448\u043D\u0435\u0433\u043E \u0434\u043D\u044F, \u0438 \u043B\u0438\u043D\u0438\u044F \u043D\u0430\u0447\u043D\u0451\u0442 \u0440\u0430\u0441\u0442\u0438.") : React.createElement(React.Fragment, null, React.createElement("div", {
    className: "sc-head"
  }, pts.length > 1 ? React.createElement(React.Fragment, null, React.createElement("span", {
    className: "sc-big"
  }, first), React.createElement("span", {
    className: "sc-arrow"
  }, React.createElement(Ico.chev, null)), React.createElement("span", {
    className: "sc-big now"
  }, last), React.createElement("span", {
    className: "sc-sub"
  }, "\u0438\u0437 10, ", shift)) : React.createElement(React.Fragment, null, React.createElement("span", {
    className: "sc-big now"
  }, last), React.createElement("span", {
    className: "sc-sub"
  }, "\u0438\u0437 10, \u043F\u0435\u0440\u0432\u0430\u044F \u043E\u0442\u043C\u0435\u0442\u043A\u0430"))), React.createElement("svg", {
    className: "sc-svg",
    viewBox: "0 0 " + W + " " + H,
    role: "img",
    "aria-label": "\u0413\u0440\u0430\u0444\u0438\u043A \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u044F"
  }, React.createElement("defs", null, React.createElement("linearGradient", {
    id: "scFill",
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, React.createElement("stop", {
    offset: "0%",
    stopColor: "var(--steel)",
    stopOpacity: "0.20"
  }), React.createElement("stop", {
    offset: "100%",
    stopColor: "var(--steel)",
    stopOpacity: "0"
  }))), [0, 5, 10].map(g => React.createElement("line", {
    key: g,
    x1: padX,
    x2: W - padX,
    y1: Y(g),
    y2: Y(g),
    className: "sc-grid"
  })), area && React.createElement("path", {
    d: area,
    fill: "url(#scFill)"
  }), pts.length > 1 && React.createElement("path", {
    d: line,
    className: "sc-line",
    fill: "none"
  }), pts.map((p, i) => React.createElement("circle", {
    key: i,
    cx: X(i),
    cy: Y(p.v),
    r: i === pts.length - 1 ? 5 : 3.4,
    className: "sc-dot" + (i === pts.length - 1 ? " last" : "")
  }))), React.createElement("div", {
    className: "sc-x",
    style: {
      justifyContent: pts.length <= 1 ? "center" : "space-between"
    }
  }, pts.map((p, i) => React.createElement("span", {
    key: i
  }, "\u0434", p.day)))));
}
function Dashboard({
  days,
  currentIndex,
  unlockedCount,
  onOpenDay,
  onGoDiary,
  userName,
  isAdmin,
  onLogout
}) {
  const done = days.filter(isDayDone).length;
  const streak = (() => {
    let s = 0;
    for (const d of days) {
      if (isDayDone(d)) s++;else break;
    }
    return s;
  })();
  const pct = Math.round(done / days.length * 100);
  const today = days[currentIndex];
  const todayUnlocked = currentIndex + 1 <= unlockedCount;
  const upcoming = days.slice(currentIndex, currentIndex + 3);
  const stageIdx = stageOf(today.id);
  const stage = STAGES[stageIdx];
  const lastNote = [...days].reverse().find(d => d.note && d.note.trim());
  const tasksDone = days.reduce((sum, d) => sum + d.tasks.filter(t => t.done).length, 0);
  return React.createElement("div", {
    className: "page"
  }, React.createElement("div", {
    className: "head-row"
  }, React.createElement("div", null, React.createElement("div", {
    className: "eyebrow"
  }, "\u041F\u0440\u043E\u0442\u043E\u043A\u043E\u043B \u0434\u0435\u043D\u0435\u0433"), React.createElement("h1", null, "\u041F\u0440\u0438\u0432\u0435\u0442", userName ? ", " + userName : ""), React.createElement("div", {
    className: "sub"
  }, "\u0422\u0432\u043E\u0439 \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0448\u0430\u0433 \u0433\u043E\u0442\u043E\u0432. \u041E\u0434\u0438\u043D \u0434\u0435\u043D\u044C, \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043C\u0438\u043D\u0443\u0442.")), React.createElement("div", {
    className: "streak-pill",
    title: streak > 0 ? "Сколько дней подряд ты занимаешься без пропусков" : "Пройди первый день, чтобы начать серию"
  }, React.createElement("span", {
    className: "flame"
  }, "\uD83D\uDD25"), streak > 0 ? React.createElement("span", null, React.createElement("span", {
    className: "streak-lead"
  }, "\u0417\u0430\u043D\u0438\u043C\u0430\u0435\u0448\u044C\u0441\u044F "), React.createElement("span", {
    className: "num"
  }, streak), "\xA0", dayWord(streak), " \u043F\u043E\u0434\u0440\u044F\u0434") : React.createElement("span", null, "\u041D\u0430\u0447\u043D\u0438 \u043F\u0435\u0440\u0432\u044B\u0439 \u0434\u0435\u043D\u044C"))), React.createElement("div", {
    className: "dash"
  }, React.createElement("div", {
    className: "metal ring-card"
  }, React.createElement(Ring, {
    value: done,
    total: days.length
  }), React.createElement("div", {
    className: "ring-info"
  }, React.createElement("div", {
    className: "ttl muted"
  }, "\u041E\u0431\u0449\u0438\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441"), React.createElement("div", {
    className: "pct"
  }, "\u041F\u0440\u043E\u0439\u0434\u0435\u043D\u043E ", done, " \u0438\u0437 ", days.length), React.createElement("div", {
    className: "line"
  }, React.createElement("i", {
    style: {
      width: pct + "%"
    }
  })), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12.5,
      marginTop: 10
    }
  }, done < days.length ? React.createElement(React.Fragment, null, "\u0421\u0435\u0433\u043E\u0434\u043D\u044F \u0434\u0435\u043D\u044C ", today.id, " \xB7 ", pct, "% \u043F\u0443\u0442\u0438") : React.createElement(React.Fragment, null, "\u0412\u0441\u0435 \u0434\u043D\u0438 \u043F\u0440\u043E\u0439\u0434\u0435\u043D\u044B \xB7 100%")))), React.createElement("div", {
    className: "card today-card"
  }, React.createElement("div", {
    className: "today-top"
  }, React.createElement("div", {
    className: "today-num"
  }, today.id), React.createElement("div", {
    className: "meta"
  }, React.createElement("div", {
    className: "k"
  }, todayUnlocked ? "Сегодня" : "Скоро"), React.createElement("div", {
    className: "t"
  }, today.title))), React.createElement("div", {
    className: "lesson"
  }, today.lesson), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12.5,
      marginTop: 12
    }
  }, todayUnlocked ? React.createElement(React.Fragment, null, "\uD83C\uDFA7 ", durLabel(today.duration), " \xB7 ", today.tasks.length, " ", taskWord(today.tasks.length)) : unlockLabel(today.id)), todayUnlocked ? React.createElement("button", {
    className: "btn btn-primary",
    onClick: () => onOpenDay(currentIndex)
  }, "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0434\u0435\u043D\u044C ", React.createElement(Ico.chev, null)) : React.createElement("button", {
    className: "btn btn-ghost",
    disabled: true
  }, "\u0414\u0435\u043D\u044C \u0435\u0449\u0451 \u0437\u0430\u043A\u0440\u044B\u0442")), React.createElement("div", {
    className: "card span2 stage-card"
  }, React.createElement("div", {
    className: "eyebrow"
  }, "\u042D\u0442\u0430\u043F \u043F\u0443\u0442\u0438"), React.createElement("div", {
    className: "stage-title"
  }, "\u042D\u0442\u0430\u043F ", stageIdx + 1, " \u0438\u0437 ", STAGES.length, ": ", lower1(stage.name)), React.createElement("div", {
    className: "stage-steps"
  }, STAGES.map((s, i) => React.createElement("div", {
    key: i,
    className: "seg " + (i < stageIdx ? "done" : i === stageIdx ? "cur" : ""),
    title: s.name
  }))), React.createElement("div", {
    className: "stage-cap muted"
  }, stage.hint)), React.createElement(StateChart, {
    days: days
  }), React.createElement("div", {
    className: "card last-note span2" + (lastNote ? "" : " empty"),
    onClick: onGoDiary
  }, React.createElement("div", {
    className: "eyebrow"
  }, "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0437\u0430\u043C\u0435\u0442\u043A\u0430"), lastNote ? React.createElement(React.Fragment, null, React.createElement("div", {
    className: "nt"
  }, lastNote.note), React.createElement("div", {
    className: "src"
  }, React.createElement("span", {
    className: "src-ref"
  }, "\u0414\u0435\u043D\u044C ", lastNote.id, ": ", lastNote.title), React.createElement("span", {
    className: "go"
  }, "\u0432 \u0434\u043D\u0435\u0432\u043D\u0438\u043A"))) : React.createElement(React.Fragment, null, React.createElement("div", {
    className: "nt empty-txt"
  }, "\u0417\u0434\u0435\u0441\u044C \u0431\u0443\u0434\u0435\u0442 \u0442\u0432\u043E\u044F \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0437\u0430\u043C\u0435\u0442\u043A\u0430."), React.createElement("div", {
    className: "src"
  }, "\u0417\u0430\u0433\u043B\u044F\u043D\u0438 \u0432 \u0434\u0435\u043D\u044C \u0438 \u043E\u0441\u0442\u0430\u0432\u044C \u043A\u043E\u0440\u043E\u0442\u043A\u0443\u044E \u043C\u044B\u0441\u043B\u044C."))), React.createElement("div", {
    className: "card span2"
  }, React.createElement("div", {
    className: "stats"
  }, React.createElement("div", {
    className: "stat"
  }, React.createElement("div", {
    className: "v"
  }, done), React.createElement("div", {
    className: "k"
  }, "\u043F\u0440\u043E\u0439\u0434\u0435\u043D\u043E")), React.createElement("div", {
    className: "stat"
  }, React.createElement("div", {
    className: "v"
  }, days.length - done), React.createElement("div", {
    className: "k"
  }, "\u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C")), React.createElement("div", {
    className: "stat"
  }, React.createElement("div", {
    className: "v"
  }, tasksDone), React.createElement("div", {
    className: "k"
  }, "\u0437\u0430\u0434\u0430\u043D\u0438\u0439 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043E")))), React.createElement("div", {
    className: "span2"
  }, React.createElement("div", {
    className: "head-row",
    style: {
      marginBottom: 12
    }
  }, React.createElement("div", null, React.createElement("div", {
    className: "eyebrow"
  }, "\u041C\u0430\u0440\u0448\u0440\u0443\u0442"), React.createElement("h2", {
    style: {
      fontSize: 18,
      marginTop: 4
    }
  }, "\u0411\u043B\u0438\u0436\u0430\u0439\u0448\u0438\u0435 \u0434\u043D\u0438"))), React.createElement("div", {
    className: "upnext"
  }, upcoming.map(d => {
    const di = days.indexOf(d);
    const st = dayStatus(d, di, unlockedCount, currentIndex, isAdmin);
    const clickable = dayOpenable(st);
    const hidden = st === "hidden";
    const bg = st === "done" ? {
      background: "var(--good-soft)",
      color: "var(--good)"
    } : st === "today" ? {
      background: "#e7ebf1",
      color: "var(--steel)"
    } : st === "next" || st === "open" ? {
      background: "#eef1f5",
      color: "var(--steel-2)"
    } : {
      background: "#eef1f5",
      color: "var(--ink-faint)"
    };
    return React.createElement("div", {
      key: d.id,
      className: "card mini " + st,
      onClick: () => clickable && onOpenDay(di),
      style: {
        opacity: clickable ? 1 : .9
      }
    }, React.createElement("div", {
      className: "badge",
      style: bg
    }, st === "done" ? React.createElement(Ico.check, null) : clickable ? d.id : React.createElement(Ico.lock, {
      width: 19,
      height: 19
    })), React.createElement("div", {
      className: "nm"
    }, hidden ? "День " + d.id : d.title), React.createElement("div", {
      className: "du"
    }, hidden ? unlockLabel(d.id) : React.createElement(React.Fragment, null, "\uD83C\uDFA7 ", durLabel(d.duration))));
  })))), React.createElement("div", {
    className: "mobile-logout"
  }, React.createElement("button", {
    className: "ml-btn",
    onClick: onLogout
  }, React.createElement(Ico.out, null), " \u0412\u044B\u0439\u0442\u0438 \u0438\u0437 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430")));
}
function DayMap({
  days,
  currentIndex,
  unlockedCount,
  onOpenDay,
  isAdmin
}) {
  return React.createElement("div", {
    className: "page"
  }, React.createElement("div", {
    className: "head-row"
  }, React.createElement("div", null, React.createElement("div", {
    className: "eyebrow"
  }, "\u041C\u0430\u0440\u0448\u0440\u0443\u0442"), React.createElement("h1", null, "\u041A\u0430\u0440\u0442\u0430 17 \u0434\u043D\u0435\u0439"), React.createElement("div", {
    className: "sub"
  }, "\u041A\u043E\u0440\u043E\u0442\u043A\u0438\u0435 \u0448\u0430\u0433\u0438 \u0434\u043E \u043D\u043E\u0432\u044B\u0445 \u043E\u0442\u043D\u043E\u0448\u0435\u043D\u0438\u0439 \u0441 \u0434\u0435\u043D\u044C\u0433\u0430\u043C\u0438. \u041F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043D\u044B\u0439 \u0434\u0435\u043D\u044C \u0441\u043F\u043E\u043A\u043E\u0439\u043D\u043E \u0434\u043E\u0433\u043E\u043D\u044F\u0435\u0442\u0441\u044F."))), React.createElement("div", {
    className: "path"
  }, days.map((d, i) => {
    const status = dayStatus(d, i, unlockedCount, currentIndex, isAdmin);
    const clickable = dayOpenable(status);
    const showMeta = clickable || status === "next";
    const hidden = status === "hidden";
    return React.createElement("div", {
      key: d.id,
      className: "node " + status,
      onClick: () => clickable && onOpenDay(i)
    }, React.createElement("div", {
      className: "dot"
    }, status === "done" ? React.createElement(Ico.check, null) : clickable ? d.id : React.createElement(Ico.lock, {
      width: 23,
      height: 23
    })), React.createElement("div", {
      className: "body"
    }, React.createElement("div", {
      className: "t"
    }, hidden ? "День " + d.id : "День " + d.id + ": " + d.title), showMeta && React.createElement("div", {
      className: "s"
    }, "\uD83C\uDFA7 ", durLabel(d.duration), " \xB7 ", d.tasks.length, " ", taskWord(d.tasks.length)), !clickable && React.createElement("div", {
      className: "lockhint"
    }, React.createElement(Ico.lock, null), " ", lockLine(status, d, unlockedCount))), React.createElement("span", {
      className: "tag " + status
    }, STATUS_LABEL[status]));
  })));
}
const SPEED_KEY = "mp_audio_speed";
const SPEED_MIN = 0.8,
  SPEED_MAX = 2;
const SPEED_PRESETS = [1, 1.3, 1.5, 1.8];
const clampSpeed = v => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(v) || 1));
function loadSpeed() {
  try {
    return clampSpeed(parseFloat(localStorage.getItem(SPEED_KEY)));
  } catch (e) {
    return 1;
  }
}
const fmtSpeed = v => (Math.round(v * 100) / 100).toString().replace(".", ",") + "×";
function Player({
  day
}) {
  const audioRef = useRef(null);
  const barRef = useRef(null);
  const reqId = useRef(0);
  const recoverLeft = useRef(2);
  const resumeAt = useRef(0);
  const shouldResume = useRef(false);
  const [src, setSrc] = useState(undefined);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(day.duration || 0);
  const [speed, setSpeed] = useState(loadSpeed);
  const applySpeed = v => {
    const s = Math.round(clampSpeed(v) * 100) / 100;
    setSpeed(s);
    try {
      localStorage.setItem(SPEED_KEY, String(s));
    } catch (e) {}
  };
  useEffect(() => {
    const a = audioRef.current;
    if (a) {
      try {
        a.preservesPitch = true;
        a.playbackRate = speed;
      } catch (e) {}
    }
  }, [speed, src]);
  const loadSrc = resume => {
    const my = ++reqId.current;
    resumeAt.current = resume || 0;
    setSrc(undefined);
    signedAudioUrl(day.audioPath).then(u => {
      if (my === reqId.current) setSrc(u);
    }).catch(() => {
      if (my === reqId.current) setSrc("");
    });
  };
  useEffect(() => {
    setPlaying(false);
    setT(0);
    setDur(day.duration || 0);
    recoverLeft.current = 2;
    resumeAt.current = 0;
    shouldResume.current = false;
    if (!day.audioPath) {
      reqId.current++;
      setSrc(null);
      return;
    }
    loadSrc(0);
  }, [day.id, day.audioPath]);
  if (src === null || src === "") {
    const failed = src === "";
    return React.createElement("div", {
      className: "card"
    }, React.createElement("div", {
      className: "player"
    }, React.createElement("div", {
      className: "cover"
    }, React.createElement(Ico.wave, null)), React.createElement("div", {
      className: "pl-body"
    }, React.createElement("div", {
      className: "k"
    }, "\u0423\u0440\u043E\u043A \u0434\u043D\u044F"), React.createElement("div", {
      className: "t"
    }, day.title)), failed && React.createElement("button", {
      className: "play-btn",
      title: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C",
      onClick: () => {
        recoverLeft.current = 2;
        loadSrc(0);
      }
    }, React.createElement(Ico.play, null))), React.createElement("div", {
      className: "player-empty"
    }, failed ? "Аудио не открылось. Нажми кнопку справа, чтобы попробовать ещё раз." : "Аудио для этого дня пока не загружено."));
  }
  const loading = src === undefined;
  const onLoaded = () => {
    const a = audioRef.current;
    if (!a) return;
    try {
      a.preservesPitch = true;
      a.playbackRate = speed;
    } catch (e) {}
    if (isFinite(a.duration)) setDur(a.duration);
    if (resumeAt.current > 0) {
      try {
        a.currentTime = resumeAt.current;
      } catch (e) {}
      resumeAt.current = 0;
    }
    if (shouldResume.current) {
      shouldResume.current = false;
      a.play().catch(() => {});
    }
  };
  const onTime = () => {
    const a = audioRef.current;
    if (a) setT(a.currentTime);
  };
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
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setPlaying(false));else a.pause();
  };
  const seek = e => {
    const a = audioRef.current;
    if (!a || !dur) return;
    const rect = barRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const nt = Math.min(dur, Math.max(0, cx / rect.width * dur));
    a.currentTime = nt;
    setT(nt);
  };
  const pct = dur ? t / dur * 100 : 0;
  return React.createElement("div", {
    className: "card"
  }, !loading && React.createElement("audio", {
    ref: audioRef,
    src: src,
    preload: "metadata",
    onLoadedMetadata: onLoaded,
    onTimeUpdate: onTime,
    onError: onAudioError,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false)
  }), React.createElement("div", {
    className: "player"
  }, React.createElement("div", {
    className: "cover"
  }, React.createElement(Ico.wave, null)), React.createElement("div", {
    className: "pl-body"
  }, React.createElement("div", {
    className: "k"
  }, "\u0423\u0440\u043E\u043A \u0434\u043D\u044F"), React.createElement("div", {
    className: "t"
  }, day.title)), React.createElement("button", {
    className: "play-btn",
    onClick: toggle,
    disabled: loading
  }, playing ? React.createElement(Ico.pause, null) : React.createElement(Ico.play, null))), React.createElement("div", {
    className: "seek"
  }, React.createElement("div", {
    className: "seek-bar",
    ref: barRef,
    onClick: seek
  }, React.createElement("i", {
    style: {
      width: pct + "%"
    }
  }), React.createElement("b", {
    style: {
      left: pct + "%"
    }
  })), React.createElement("div", {
    className: "seek-time"
  }, React.createElement("span", null, loading ? "загрузка…" : fmt(t)), React.createElement("span", null, fmt(dur)))), React.createElement("div", {
    className: "speed-box"
  }, React.createElement("div", {
    className: "speed-head"
  }, React.createElement("span", {
    className: "speed-lbl"
  }, React.createElement(Ico.speed, null), " \u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C"), React.createElement("div", {
    className: "speed-chips"
  }, SPEED_PRESETS.map(p => React.createElement("button", {
    key: p,
    className: "speed-chip" + (Math.abs(speed - p) < 0.001 ? " sel" : ""),
    disabled: loading,
    onClick: () => applySpeed(p)
  }, fmtSpeed(p))))), React.createElement("input", {
    className: "speed-range",
    type: "range",
    min: SPEED_MIN,
    max: SPEED_MAX,
    step: "0.05",
    value: speed,
    disabled: loading,
    "aria-label": "\u0421\u043A\u043E\u0440\u043E\u0441\u0442\u044C \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u0435\u0434\u0435\u043D\u0438\u044F",
    onChange: e => applySpeed(e.target.value)
  })));
}
function TaskItem({
  task,
  num,
  just,
  onAnswer,
  onAnswerBlur,
  onConfirm,
  onEdit
}) {
  const filled = task.answer && task.answer.trim().length > 0;
  return React.createElement("div", {
    className: "qtask" + (task.done ? " done" : "") + (just ? " just-checked" : "")
  }, React.createElement("div", {
    className: "q-row"
  }, React.createElement("div", {
    className: "q-check"
  }, React.createElement("span", {
    className: "glow"
  }), React.createElement(Ico.check, null)), React.createElement("div", {
    className: "q-text"
  }, React.createElement("span", {
    className: "q-num"
  }, "\u0417\u0430\u0434\u0430\u043D\u0438\u0435 ", num), task.text)), task.done ? React.createElement("div", {
    className: "q-answer-view"
  }, React.createElement("div", {
    className: "q-answer-text"
  }, task.answer), React.createElement("button", {
    className: "q-edit",
    onClick: () => onEdit(task.id)
  }, "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C")) : React.createElement("div", {
    className: "q-edit-zone"
  }, React.createElement("textarea", {
    className: "q-input",
    placeholder: "\u0412\u043F\u0438\u0448\u0438 \u0441\u0432\u043E\u0439 \u043E\u0442\u0432\u0435\u0442",
    value: task.answer,
    onChange: e => onAnswer(task.id, e.target.value),
    onBlur: () => onAnswerBlur(task.id)
  }), React.createElement("button", {
    className: "btn btn-primary btn-sm q-confirm",
    disabled: !filled,
    onClick: () => filled && onConfirm(task.id)
  }, React.createElement(Ico.check, null), " \u0413\u043E\u0442\u043E\u0432\u043E")));
}
function StateSlider({
  value,
  onChange
}) {
  const [v, setV] = useState(value == null ? 5 : value);
  const [touched, setTouched] = useState(value != null);
  const [flash, setFlash] = useState(false);
  const commit = () => {
    setTouched(true);
    onChange(v);
    setFlash(true);
    setTimeout(() => setFlash(false), 1400);
  };
  return React.createElement("div", {
    className: "state-slider"
  }, React.createElement("div", {
    className: "state-val"
  }, touched ? React.createElement(React.Fragment, null, React.createElement("b", null, v), React.createElement("span", null, " \u0438\u0437 10")) : React.createElement("span", {
    className: "faint"
  }, "\u041F\u043E\u0434\u0432\u0438\u043D\u044C, \u043A\u0430\u043A \u0442\u0435\u0431\u0435 \u0441\u0435\u0439\u0447\u0430\u0441"), flash && React.createElement("span", {
    className: "saved-flash",
    style: {
      marginLeft: 10
    }
  }, "\u2713 \u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E")), React.createElement("input", {
    className: "state-range",
    type: "range",
    min: "0",
    max: "10",
    step: "1",
    value: v,
    style: {
      "--fill": v * 10 + "%"
    },
    onChange: e => setV(+e.target.value),
    onMouseUp: commit,
    onTouchEnd: commit,
    onKeyUp: commit
  }), React.createElement("div", {
    className: "state-ends"
  }, React.createElement("span", null, "\u0422\u0440\u0435\u0432\u043E\u0436\u043D\u043E"), React.createElement("span", null, "\u0421\u043F\u043E\u043A\u043E\u0439\u043D\u043E")));
}
function DayScreen({
  day,
  dayIndex,
  total,
  onBack,
  onGoMap,
  nextDay,
  nextReady,
  nextLabel,
  onOpenNext,
  onAnswer,
  onAnswerBlur,
  onConfirm,
  onEdit,
  onNote,
  onState
}) {
  const [flash, setFlash] = useState(false);
  const [justId, setJustId] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const prog = dayProgress(day);
  const allDone = prog === day.tasks.length;
  const confirm = id => {
    onConfirm(id);
    setJustId(id);
    setTimeout(() => setJustId(null), 700);
    const willAllBeDone = day.tasks.every(t => t.id === id ? true : t.done);
    if (willAllBeDone) {
      setShowDone(true);
      setTimeout(() => setShowDone(false), 2600);
    }
  };
  const saveNote = v => {
    onNote(v);
    setFlash(true);
    setTimeout(() => setFlash(false), 1400);
  };
  return React.createElement("div", {
    className: "page day-col"
  }, React.createElement("button", {
    className: "back",
    onClick: onBack
  }, React.createElement(Ico.back, null), " \u041D\u0430\u0437\u0430\u0434 \u043A \u043A\u0430\u0440\u0442\u0435"), React.createElement("div", {
    className: "day-head"
  }, React.createElement("div", {
    className: "eyebrow"
  }, "\u0414\u0435\u043D\u044C ", day.id, " \u0438\u0437 ", total), React.createElement("h1", null, day.title)), React.createElement("div", {
    className: "gap16"
  }), React.createElement(Player, {
    day: day
  }), React.createElement("div", {
    className: "card"
  }, React.createElement("p", {
    className: "muted",
    style: {
      margin: 0,
      fontSize: 14.5,
      lineHeight: 1.55
    }
  }, day.lesson)), React.createElement("div", {
    className: "card"
  }, React.createElement("div", {
    className: "tasks-head"
  }, React.createElement("div", {
    className: "eyebrow"
  }, "\u0417\u0430\u0434\u0430\u043D\u0438\u044F \u0434\u043D\u044F"), React.createElement("div", {
    className: "day-mini-prog"
  }, React.createElement("div", {
    className: "bar"
  }, React.createElement("i", {
    style: {
      width: prog / day.tasks.length * 100 + "%"
    }
  })), prog, "/", day.tasks.length)), React.createElement("div", {
    className: "q-list"
  }, day.tasks.map((t, i) => React.createElement(TaskItem, {
    key: t.id,
    task: t,
    num: i + 1,
    just: justId === t.id,
    onAnswer: onAnswer,
    onAnswerBlur: onAnswerBlur,
    onConfirm: confirm,
    onEdit: onEdit
  })))), React.createElement("div", {
    className: "card"
  }, React.createElement("div", {
    className: "eyebrow"
  }, "\u0417\u0430\u043C\u0435\u0442\u043A\u0430 \u0434\u043D\u044F"), React.createElement("div", {
    className: "note-hint"
  }, "\u0417\u0434\u0435\u0441\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0442\u0435\u0431\u044F. \u0417\u0430\u043F\u0438\u0448\u0438, \u0447\u0442\u043E \u043F\u043E\u0447\u0443\u0432\u0441\u0442\u0432\u043E\u0432\u0430\u043B \u0438 \u0447\u0442\u043E \u043F\u043E\u043D\u044F\u043B \u043D\u0430 \u044D\u0442\u043E\u043C \u0443\u0440\u043E\u043A\u0435. \u0411\u0435\u0437 \u043E\u0446\u0435\u043D\u043E\u043A \u0438 \u0431\u0435\u0437 \xAB\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u043E \u0438\u043B\u0438 \u043D\u0435\u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u043E\xBB."), React.createElement("textarea", {
    className: "note-area",
    placeholder: "\u041F\u0430\u0440\u0430 \u0441\u0442\u0440\u043E\u043A: \u0447\u0442\u043E \u043F\u043E\u0447\u0443\u0432\u0441\u0442\u0432\u043E\u0432\u0430\u043B, \u0447\u0442\u043E \u043F\u043E\u043D\u044F\u043B, \u0447\u0442\u043E \u0437\u0430\u0446\u0435\u043F\u0438\u043B\u043E",
    defaultValue: day.note,
    onBlur: e => saveNote(e.target.value)
  }), React.createElement("div", {
    className: "spacer"
  }), flash ? React.createElement("span", {
    className: "saved-flash"
  }, "\u2713 \u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E") : React.createElement("span", {
    className: "faint",
    style: {
      fontSize: 12.5
    }
  }, "\u0421\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442\u0441\u044F \u043F\u0440\u0438 \u0432\u044B\u0445\u043E\u0434\u0435 \u0438\u0437 \u043F\u043E\u043B\u044F")), React.createElement("div", {
    className: "card"
  }, React.createElement("div", {
    className: "eyebrow"
  }, "\u041A\u0430\u043A \u0442\u0435\u0431\u0435 \u0441 \u0434\u0435\u043D\u044C\u0433\u0430\u043C\u0438 \u0441\u0435\u0433\u043E\u0434\u043D\u044F"), React.createElement("div", {
    className: "note-hint"
  }, "\u041E\u0434\u0438\u043D \u0448\u0442\u0440\u0438\u0445 \u0432 \u043A\u043E\u043D\u0446\u0435 \u0434\u043D\u044F: \u0433\u0434\u0435 \u0442\u044B \u0441\u0435\u0439\u0447\u0430\u0441, \u043C\u0435\u0436\u0434\u0443 \u0442\u0440\u0435\u0432\u043E\u0433\u043E\u0439 \u0438 \u0441\u043F\u043E\u043A\u043E\u0439\u0441\u0442\u0432\u0438\u0435\u043C. \u042D\u0442\u043E \u043A\u043E\u043F\u0438\u0442\u0441\u044F \u0432 \u0442\u0432\u043E\u0439 \u0433\u0440\u0430\u0444\u0438\u043A \u043D\u0430 \xAB\u041C\u043E\u0451\u043C \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441\u0435\xBB."), React.createElement(StateSlider, {
    key: day.id,
    value: day.state,
    onChange: onState
  })), allDone ? React.createElement("div", {
    className: "card day-done-card" + (showDone ? " pop" : "")
  }, React.createElement("div", {
    className: "dd-check"
  }, React.createElement(Ico.check, null)), React.createElement("div", {
    style: {
      fontWeight: 800,
      marginTop: 10,
      fontSize: 17
    }
  }, "\u0414\u0435\u043D\u044C ", day.id, " \u043F\u0440\u043E\u0439\u0434\u0435\u043D"), !nextDay ? React.createElement(React.Fragment, null, React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 13.5,
      marginTop: 4,
      lineHeight: 1.5
    }
  }, "\u042D\u0442\u043E \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0434\u0435\u043D\u044C. \u0412\u044B \u043F\u0440\u043E\u0448\u043B\u0438 \u0432\u0435\u0441\u044C \u043F\u0440\u043E\u0442\u043E\u043A\u043E\u043B."), React.createElement("div", {
    className: "spacer"
  }), React.createElement("div", {
    className: "spacer"
  }), React.createElement("button", {
    className: "btn btn-primary",
    onClick: onGoMap
  }, "\u041D\u0430 \u043A\u0430\u0440\u0442\u0443 \u0434\u043D\u0435\u0439")) : nextReady ? React.createElement(React.Fragment, null, React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 13.5,
      marginTop: 4,
      lineHeight: 1.5
    }
  }, "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0434\u0435\u043D\u044C \u0443\u0436\u0435 \u043E\u0442\u043A\u0440\u044B\u0442."), React.createElement("div", {
    className: "spacer"
  }), React.createElement("div", {
    className: "spacer"
  }), React.createElement("button", {
    className: "btn btn-primary",
    onClick: onOpenNext
  }, "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0434\u0435\u043D\u044C ", day.id + 1, " ", React.createElement(Ico.chev, null)), React.createElement("button", {
    className: "btn btn-ghost",
    style: {
      marginTop: 10
    },
    onClick: onGoMap
  }, "\u041D\u0430 \u043A\u0430\u0440\u0442\u0443 \u0434\u043D\u0435\u0439")) : React.createElement(React.Fragment, null, React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 13.5,
      marginTop: 4,
      lineHeight: 1.5
    }
  }, "\u0421\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0439 \u0434\u0435\u043D\u044C \xAB", nextDay.title, "\xBB ", String(nextLabel || "откроется позже").toLowerCase(), " \u0432 5:00."), React.createElement("div", {
    className: "spacer"
  }), React.createElement("div", {
    className: "spacer"
  }), React.createElement("button", {
    className: "btn btn-primary",
    onClick: onGoMap
  }, "\u041D\u0430 \u043A\u0430\u0440\u0442\u0443 \u0434\u043D\u0435\u0439"))) : React.createElement(React.Fragment, null, React.createElement("button", {
    className: "btn btn-primary",
    onClick: onBack
  }, "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0438 \u0432\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F"), React.createElement("div", {
    className: "encourage"
  }, "\u041E\u0442\u0432\u0435\u0442\u044C \u043D\u0430 \u0437\u0430\u0434\u0430\u043D\u0438\u044F \u0438 \u043D\u0430\u0436\u043C\u0438 \xAB\u0413\u043E\u0442\u043E\u0432\u043E\xBB, \u0447\u0442\u043E\u0431\u044B \u0434\u0435\u043D\u044C \u0437\u0430\u0441\u0447\u0438\u0442\u0430\u043B\u0441\u044F.")));
}
function Diary({
  days,
  onOpenDay
}) {
  const filled = days.filter(d => isDayDone(d) || d.note.trim() || d.tasks.some(t => t.answer && t.answer.trim()));
  return React.createElement("div", {
    className: "page day-col"
  }, React.createElement("div", {
    className: "head-row"
  }, React.createElement("div", null, React.createElement("div", {
    className: "eyebrow"
  }, "\u041C\u043E\u0439 \u0434\u043D\u0435\u0432\u043D\u0438\u043A"), React.createElement("h1", null, "\u0414\u043D\u0435\u0432\u043D\u0438\u043A"), React.createElement("div", {
    className: "sub"
  }, "\u0412\u0441\u0451, \u0447\u0442\u043E \u0442\u044B \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0448\u044C \u0437\u0430 \u0434\u043D\u0438 \u043F\u0440\u043E\u0442\u043E\u043A\u043E\u043B\u0430, \u0441\u043E\u0431\u0440\u0430\u043D\u043E \u0432 \u043E\u0434\u043D\u043E\u043C \u043C\u0435\u0441\u0442\u0435."))), filled.length === 0 ? React.createElement("div", {
    className: "card center",
    style: {
      padding: 40
    }
  }, React.createElement("div", {
    style: {
      fontSize: 30
    }
  }, "\uD83D\uDCD6"), React.createElement("div", {
    style: {
      fontWeight: 700,
      marginTop: 8
    }
  }, "\u041F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E"), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 13.5,
      marginTop: 4
    }
  }, "\u041F\u0440\u043E\u0439\u0434\u0438 \u043F\u0435\u0440\u0432\u044B\u0439 \u0434\u0435\u043D\u044C, \u0438 \u0442\u0432\u043E\u0438 \u043E\u0442\u0432\u0435\u0442\u044B \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u0437\u0434\u0435\u0441\u044C.")) : filled.map(d => {
    const di = days.indexOf(d);
    return React.createElement("div", {
      key: d.id,
      className: "card diary-day"
    }, React.createElement("div", {
      className: "diary-head",
      onClick: () => onOpenDay(di)
    }, React.createElement("div", {
      className: "diary-num"
    }, d.id), React.createElement("div", {
      className: "diary-ttl"
    }, React.createElement("div", {
      className: "eyebrow"
    }, "\u0414\u0435\u043D\u044C ", d.id, isDayDone(d) ? " · пройден" : ""), React.createElement("div", {
      className: "t"
    }, d.title)), React.createElement(Ico.chev, {
      className: "chev"
    })), d.tasks.filter(t => t.answer && t.answer.trim()).map(t => React.createElement("div", {
      key: t.id,
      className: "diary-item"
    }, React.createElement("div", {
      className: "diary-q"
    }, t.text), React.createElement("div", {
      className: "diary-a"
    }, t.answer))), d.note && d.note.trim() && React.createElement("div", {
      className: "diary-item note"
    }, React.createElement("div", {
      className: "diary-q"
    }, "\u0417\u0430\u043C\u0435\u0442\u043A\u0430 \u0434\u043D\u044F"), React.createElement("div", {
      className: "diary-a"
    }, d.note)));
  }));
}
function mdBold(text) {
  return String(text).split("**").map((part, i) => i % 2 ? React.createElement("b", {
    key: i
  }, part) : part);
}
function GuideShot({
  src,
  cap
}) {
  const [failed, setFailed] = useState(false);
  return React.createElement("figure", {
    className: "gd-shot"
  }, failed ? React.createElement("div", {
    className: "gd-frame"
  }, "\u0421\u044E\u0434\u0430 \u0432\u0441\u0442\u0430\u0432\u0438\u0442\u0441\u044F \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0430 \u044D\u043A\u0440\u0430\u043D\u0430") : React.createElement("img", {
    src: src,
    alt: cap || "",
    loading: "lazy",
    onError: () => setFailed(true)
  }), cap && React.createElement("figcaption", null, cap));
}
const GUIDE_STEPS = [{
  icon: "login",
  title: "Как сюда войти",
  body: ["Вход по той же почте, по которой вам открыли доступ."],
  list: [["Впишите почту и пароль", ", нажмите **«Войти»**."], ["Заходить заново не нужно", ", программа вас запомнит. Закрыли, открыли, вы внутри."], ["Телефон или компьютер", ", без разницы. Прогресс общий, он привязан к почте."]]
}, {
  icon: "grid",
  title: "Меню и разделы",
  body: ["Внизу экрана полоска с кнопками, это меню. На компьютере оно слева. Разделов четыре:"],
  list: [["Мой прогресс.", " Главная. Сколько дней пройдено, какой день сегодня, и **график вашего спокойствия**."], ["Карта дней.", " Все 17 дней по порядку. Сегодня открыт, следующий виден названием, остальные под замком с датой."], ["Дневник.", " Сюда сами собираются все ваши ответы и заметки за все дни."], ["Инструкция.", " Эта страница. Возвращайтесь в любой момент, если что-то забылось."]],
  shot: {
    src: "guide-img/step-menu.png",
    cap: "Меню внизу экрана. Сейчас вы в «Инструкции»."
  }
}, {
  icon: "calday",
  title: "Откройте сегодняшний день",
  body: ["Зайдите в **«Мой прогресс»**. На карточке сегодняшнего дня нажмите **«Открыть день»**. Откроется страница урока, с неё и начинается ваш день."],
  shot: {
    src: "guide-img/step-open-day.png",
    cap: "Кнопка «Открыть день» на главной странице."
  }
}, {
  icon: "phones",
  title: "Послушайте аудио",
  body: ["Наверху страницы дня стоит проигрыватель."],
  list: [["Включить и пауза.", " Круглая кнопка с треугольником запускает аудио, она же ставит на паузу."], ["Скорость.", " Под полоской времени кнопки **1,3 / 1,5 / 1,8** и ползунок. Голос остаётся ровным, не пищит."], ["Не включилось?", " Обновите страницу (потяните пальцем сверху вниз) и нажмите снова."]],
  tip: "Слушать удобнее в наушниках или просто погромче.",
  shot: {
    src: "guide-img/step-audio.png",
    cap: "Круглая кнопка включает урок. Скорость меняется под полоской времени."
  }
}, {
  icon: "doc",
  title: "Прочитайте текст урока",
  body: ["Под проигрывателем идёт текст урока. Прочитайте спокойно, можно до аудио, можно после."]
}, {
  icon: "checksq",
  title: "Выполните задания",
  body: ["Под текстом идут задания дня, их немного."],
  list: [["Впишите ответ", " своими словами в поле под заданием."], ["Нажмите **«Готово»**", ", задание отметится зелёной галочкой."], ["Все задания отмечены", ", и день засчитан."], ["Хотите поправить?", " Нажмите **«Изменить»**. Ответ сохраняется сам."]],
  shot: {
    src: "guide-img/step-task.png",
    cap: "Впишите ответ и нажмите «Готово»."
  }
}, {
  icon: "pen",
  title: "Запишите мысль в дневник",
  body: ["В самом низу дня есть **«Заметка дня»**. Это место только для вас."],
  list: [["Запишите", ", что почувствовали и что поняли. Без оценок и без «правильно или неправильно»."], ["Сохраняется сама", ", как только нажмёте в другое место."], ["Всё собирается", " в разделе «Дневник»."]],
  shot: {
    src: "guide-img/step-diary.png",
    cap: "Так выглядит ваш дневник. Записи собираются сами."
  }
}, {
  icon: "chart",
  title: "Отметьте, как вам сейчас",
  body: ["В конце дня есть блок **«Как тебе с деньгами сегодня»**."],
  list: [["Подвиньте ползунок", " туда, где вы сейчас, между тревогой и спокойствием."], ["Сохраняется сам", ", пара секунд."], ["Растёт график", " вашего спокойствия на «Моём прогрессе». Видно, как отпускает."]]
}, {
  icon: "sunrise",
  title: "Завтра вернитесь за новым днём",
  body: ["Дни открываются по одному, каждое утро в **5:00 по Москве**."],
  list: [["Завтрашний день закрыт", ", на нём замочек и точная дата, например «Откроется 2 июля»."], ["Один спокойный шаг в день", ", без спешки и без соблазна забежать вперёд."], ["Пропустили день?", " Не страшно, он не пропадёт, вернётесь позже."]],
  shot: {
    src: "guide-img/step-map.png",
    cap: "Замочек значит, день ещё не открылся. Под ним дата открытия."
  }
}];
const GUIDE_FAQ = [{
  q: "Как поставить иконку на телефон",
  a: "В инструкции есть шаг «Поставьте иконку на телефон» с кнопкой. На Android телефон предложит установить сам. На айфоне нажмите Поделиться внизу Safari, затем пункт «На экран Домой» и «Добавить»."
}, {
  q: "День не открывается",
  a: "Дни открываются по одному, каждое утро в 5:00 по Москве. Если день закрыт, на нём замочек и дата открытия. Дождитесь этой даты и обновите страницу."
}, {
  q: "Как поменять скорость аудио",
  a: "Под полоской времени в проигрывателе есть кнопки 1,3, 1,5, 1,8 и ползунок. Нажмите нужную скорость, голос останется ровным."
}, {
  q: "Что за ползунок состояния",
  a: "Это короткая отметка в конце дня: где вы сейчас, между тревогой и спокойствием по деньгам, от 0 до 10. День за днём из этих отметок собирается график «От тревоги к спокойствию» на «Моём прогрессе»."
}, {
  q: "Аудио не играет",
  a: "Обновите страницу и нажмите кнопку снова. Проверьте, что звук на телефоне включён и громкость поднята. Чаще всего помогает именно обновление страницы."
}, {
  q: "Я вышел, как войти обратно",
  a: "Впишите свою почту и пароль и нажмите «Войти». Это та же почта, по которой вам открыли доступ."
}, {
  q: "Можно проходить с телефона и с компьютера",
  a: "Да. Программа работает и там, и там. Прогресс общий, он привязан к вашей почте, а не к устройству."
}, {
  q: "Я случайно отметил задание",
  a: "Ничего страшного. Нажмите «Изменить» под ответом, поправьте и снова нажмите «Готово»."
}];
function FaqItem({
  q,
  a,
  open,
  onToggle
}) {
  return React.createElement("div", {
    className: "gd-faq" + (open ? " open" : "")
  }, React.createElement("button", {
    className: "gd-faq-q",
    onClick: onToggle,
    "aria-expanded": open
  }, React.createElement("span", {
    className: "gd-faq-text"
  }, q), React.createElement("span", {
    className: "gd-faq-chev"
  }, React.createElement(Ico.chev, null))), React.createElement("div", {
    className: "gd-faq-wrap"
  }, React.createElement("div", {
    className: "gd-faq-a"
  }, mdBold(a))));
}
function Guide() {
  const [openFaq, setOpenFaq] = useState(0);
  return React.createElement("div", {
    className: "page guide-col"
  }, React.createElement("div", {
    className: "head-row"
  }, React.createElement("div", null, React.createElement("div", {
    className: "eyebrow"
  }, "\u041F\u043E\u043C\u043E\u0449\u044C"), React.createElement("h1", null, "\u0418\u043D\u0441\u0442\u0440\u0443\u043A\u0446\u0438\u044F"), React.createElement("div", {
    className: "sub"
  }, "\u041A\u0430\u043A \u0442\u0443\u0442 \u0432\u0441\u0451 \u0443\u0441\u0442\u0440\u043E\u0435\u043D\u043E \u0438 \u043A\u0430\u043A \u043F\u0440\u043E\u0445\u043E\u0434\u0438\u0442\u044C \u043A\u0443\u0440\u0441. \u0412\u0441\u0451 \u043F\u043E \u0448\u0430\u0433\u0430\u043C, \u043F\u0440\u043E\u0441\u0442\u044B\u043C\u0438 \u0441\u043B\u043E\u0432\u0430\u043C\u0438."))), React.createElement("div", {
    className: "card gd-lead"
  }, React.createElement("div", {
    className: "gd-lead-head"
  }, React.createElement("div", {
    className: "gd-ico"
  }, React.createElement(Ico.compass, null)), React.createElement("h2", {
    className: "gd-lead-title"
  }, "\u0421 \u0447\u0435\u0433\u043E \u043D\u0430\u0447\u0430\u0442\u044C")), React.createElement("div", {
    className: "gd-body"
  }, React.createElement("p", null, "\xAB\u041F\u0440\u043E\u0442\u043E\u043A\u043E\u043B \u0434\u0435\u043D\u0435\u0433\xBB \u044D\u0442\u043E \u0432\u0430\u0448\u0430 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0430 \u043D\u0430 17 \u0434\u043D\u0435\u0439. \u041A\u0430\u0436\u0434\u044B\u0439 \u0434\u0435\u043D\u044C \u043C\u044B \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u043C \u0434\u043B\u044F \u0432\u0430\u0441 \u043D\u043E\u0432\u044B\u0439 \u043D\u0435\u0431\u043E\u043B\u044C\u0448\u043E\u0439 \u0443\u0440\u043E\u043A."), React.createElement("p", null, "\u0412\u044B \u0441\u043B\u0443\u0448\u0430\u0435\u0442\u0435 \u043A\u043E\u0440\u043E\u0442\u043A\u043E\u0435 \u0430\u0443\u0434\u0438\u043E, \u0447\u0438\u0442\u0430\u0435\u0442\u0435 \u0442\u0435\u043A\u0441\u0442, \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0435 \u043F\u0440\u043E\u0441\u0442\u043E\u0435 \u0437\u0430\u0434\u0430\u043D\u0438\u0435 \u0438 \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442\u0435 \u043F\u0430\u0440\u0443 \u043C\u044B\u0441\u043B\u0435\u0439. \u0412\u0441\u0451 \u0437\u0430\u043D\u0438\u043C\u0430\u0435\u0442 \u043C\u0438\u043D\u0443\u0442 \u0434\u0432\u0430\u0434\u0446\u0430\u0442\u044C. \u0421\u043F\u0435\u0448\u0438\u0442\u044C \u043D\u0438\u043A\u0443\u0434\u0430 \u043D\u0435 \u043D\u0443\u0436\u043D\u043E."), React.createElement("p", null, "\u041D\u0438\u0436\u0435 \u0432\u0441\u0451 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043E \u043F\u043E \u0448\u0430\u0433\u0430\u043C, \u0441 \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0430\u043C\u0438. \u042D\u0442\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u0432\u0441\u0435\u0433\u0434\u0430 \u0442\u0443\u0442, \u0432 \u043B\u044E\u0431\u043E\u0439 \u043C\u043E\u043C\u0435\u043D\u0442 \u043C\u043E\u0436\u043D\u043E \u0432\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u0438 \u043F\u0435\u0440\u0435\u0447\u0438\u0442\u0430\u0442\u044C."))), GUIDE_STEPS.map((s, i) => {
    const Icon = Ico[s.icon];
    return React.createElement("div", {
      key: i,
      className: "card gd-step"
    }, React.createElement("div", {
      className: "gd-step-head"
    }, React.createElement("div", {
      className: "gd-num"
    }, i + 1), React.createElement("h2", {
      className: "gd-step-title"
    }, s.title), React.createElement("div", {
      className: "gd-ico"
    }, React.createElement(Icon, null))), React.createElement("div", {
      className: "gd-body"
    }, s.body.map((p, j) => React.createElement("p", {
      key: j
    }, mdBold(p))), s.list && React.createElement("ul", {
      className: "gd-list"
    }, s.list.map((li, j) => React.createElement("li", {
      key: j
    }, React.createElement("b", null, li[0]), mdBold(li[1])))), s.tip && React.createElement("div", {
      className: "gd-tip"
    }, React.createElement(Ico.info, null), React.createElement("span", null, mdBold(s.tip))), s.install && React.createElement("div", {
      className: "gd-install"
    }, React.createElement(InstallButton, {
      force: true
    }))), s.shot && React.createElement(GuideShot, {
      src: s.shot.src,
      cap: s.shot.cap
    }));
  }), React.createElement("div", {
    className: "card gd-calm"
  }, React.createElement("div", {
    className: "gd-lead-head"
  }, React.createElement("div", {
    className: "gd-ico gd-ico-good"
  }, React.createElement(Ico.shield, null)), React.createElement("h2", {
    className: "gd-lead-title"
  }, "\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043F\u043E\u0442\u0435\u0440\u044F\u0435\u0442\u0441\u044F")), React.createElement("div", {
    className: "gd-body"
  }, React.createElement("p", null, "\u0412\u0441\u0451, \u0447\u0442\u043E \u0432\u044B \u0434\u0435\u043B\u0430\u0435\u0442\u0435, \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442\u0441\u044F \u0441\u0430\u043C\u043E. \u041E\u0442\u0432\u0435\u0442\u044B, \u0437\u0430\u043C\u0435\u0442\u043A\u0438, \u043F\u0440\u043E\u0439\u0434\u0435\u043D\u043D\u044B\u0435 \u0434\u043D\u0438. \u041C\u043E\u0436\u043D\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443, \u0432\u044B\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0442\u0435\u043B\u0435\u0444\u043E\u043D, \u0432\u0435\u0440\u043D\u0443\u0442\u044C\u0441\u044F \u0447\u0435\u0440\u0435\u0437 \u0434\u0435\u043D\u044C. \u0412\u044B \u043E\u043A\u0430\u0436\u0435\u0442\u0435\u0441\u044C \u0442\u0430\u043C \u0436\u0435, \u0433\u0434\u0435 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0438\u0441\u044C."))), React.createElement("div", {
    className: "card gd-step"
  }, React.createElement("div", {
    className: "gd-step-head"
  }, React.createElement("div", {
    className: "gd-num"
  }, React.createElement(Ico.download, null)), React.createElement("h2", {
    className: "gd-step-title"
  }, "\u0418\u043A\u043E\u043D\u043A\u0430 \u043D\u0430 \u0442\u0435\u043B\u0435\u0444\u043E\u043D, \u043F\u043E \u0436\u0435\u043B\u0430\u043D\u0438\u044E")), React.createElement("div", {
    className: "gd-body"
  }, React.createElement("p", null, "\u042D\u0442\u043E \u043D\u0435 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E, \u043D\u043E \u0443\u0434\u043E\u0431\u043D\u043E. \u0415\u0441\u043B\u0438 \u043F\u0440\u043E\u0445\u043E\u0434\u0438\u0442\u0435 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0443 \u0441 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430, \u043F\u043E\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u0438\u043A\u043E\u043D\u043A\u0443 \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u044D\u043A\u0440\u0430\u043D. \u0422\u043E\u0433\u0434\u0430 \xAB\u041F\u0440\u043E\u0442\u043E\u043A\u043E\u043B \u0434\u0435\u043D\u0435\u0433\xBB \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0432 \u043E\u0434\u0438\u043D \u0442\u0430\u043F, \u043A\u0430\u043A \u043E\u0431\u044B\u0447\u043D\u043E\u0435 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435."), React.createElement("ul", {
    className: "gd-list"
  }, React.createElement("li", null, React.createElement("b", null, "Android, \u0432 \u043E\u0434\u0438\u043D \u0442\u0430\u043F."), " \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0441\u0438\u043D\u044E\u044E \u043A\u043D\u043E\u043F\u043A\u0443 \u043D\u0438\u0436\u0435, \u0442\u0435\u043B\u0435\u0444\u043E\u043D \u0441\u0430\u043C \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0438\u0442 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C, \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435. \u0418\u043A\u043E\u043D\u043A\u0430 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043D\u0430 \u044D\u043A\u0440\u0430\u043D\u0435."), React.createElement("li", null, React.createElement("b", null, "\u0410\u0439\u0444\u043E\u043D, Safari, \u0447\u0435\u0442\u044B\u0440\u0435 \u0448\u0430\u0433\u0430."), " 1) \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \xAB\u041F\u0440\u043E\u0442\u043E\u043A\u043E\u043B \u0434\u0435\u043D\u0435\u0433\xBB \u0432 Safari, 2) \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u2022\u2022\u2022\xBB (\u0442\u0440\u0438 \u0442\u043E\u0447\u043A\u0438) \u0441\u043F\u0440\u0430\u0432\u0430 \u0432\u043D\u0438\u0437\u0443, 3) \u043F\u0440\u043E\u043B\u0438\u0441\u0442\u0430\u0439\u0442\u0435 \u0432\u043D\u0438\u0437 \u0438 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \xAB\u041D\u0430 \u044D\u043A\u0440\u0430\u043D \u201E\u0414\u043E\u043C\u043E\u0439\u201C\xBB, 4) \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C\xBB \u0441\u043F\u0440\u0430\u0432\u0430 \u0441\u0432\u0435\u0440\u0445\u0443, \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0442\u0435\u043B\u044C \xAB\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043A\u0430\u043A \u0432\u0435\u0431-\u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435\xBB \u043E\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u0432\u043A\u043B\u044E\u0447\u0451\u043D\u043D\u044B\u043C.")), React.createElement("div", {
    className: "gd-tip"
  }, React.createElement(Ico.info, null), React.createElement("span", null, "\u041D\u0430 \u0441\u0442\u0430\u0440\u044B\u0445 \u0430\u0439\u0444\u043E\u043D\u0430\u0445 \u0432\u043C\u0435\u0441\u0442\u043E \xAB\u2022\u2022\u2022\xBB \u0432\u043D\u0438\u0437\u0443 \u0431\u044B\u0432\u0430\u0435\u0442 \u043A\u043D\u043E\u043F\u043A\u0430 \xAB\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F\xBB (\u043A\u0432\u0430\u0434\u0440\u0430\u0442 \u0441\u043E \u0441\u0442\u0440\u0435\u043B\u043A\u043E\u0439 \u0432\u0432\u0435\u0440\u0445). \u0412 \u0434\u0440\u0443\u0433\u043E\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435 (\u042F\u043D\u0434\u0435\u043A\u0441, Chrome) \u043F\u0443\u043D\u043A\u0442 \u043C\u043E\u0436\u0435\u0442 \u043D\u0430\u0437\u044B\u0432\u0430\u0442\u044C\u0441\u044F \xAB\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u044F\u0440\u043B\u044B\u043A \u043D\u0430 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\xBB. \u0414\u0430\u043B\u044C\u0448\u0435 \u0432\u0441\u0451 \u043E\u0434\u0438\u043D\u0430\u043A\u043E\u0432\u043E.")), React.createElement("div", {
    className: "gd-install"
  }, React.createElement(InstallButton, {
    force: true
  })), React.createElement("div", {
    className: "gd-film"
  }, React.createElement("div", {
    className: "it"
  }, React.createElement("img", {
    src: "guide-img/ios-1.jpg",
    alt: "\u0428\u0430\u0433 1",
    loading: "lazy"
  }), React.createElement("div", {
    className: "n"
  }, "1"), React.createElement("div", {
    className: "c"
  }, "\u041E\u0442\u043A\u0440\u043E\u0439 \u0432 Safari, \u043D\u0430\u0436\u043C\u0438 \xAB\u2022\u2022\u2022\xBB \u0432\u043D\u0438\u0437\u0443")), React.createElement("div", {
    className: "it"
  }, React.createElement("img", {
    src: "guide-img/ios-2.jpg",
    alt: "\u0428\u0430\u0433 2",
    loading: "lazy"
  }), React.createElement("div", {
    className: "n"
  }, "2"), React.createElement("div", {
    className: "c"
  }, "\u041E\u0442\u043A\u0440\u043E\u0435\u0442\u0441\u044F \u043C\u0435\u043D\u044E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439")), React.createElement("div", {
    className: "it"
  }, React.createElement("img", {
    src: "guide-img/ios-3.jpg",
    alt: "\u0428\u0430\u0433 3",
    loading: "lazy"
  }), React.createElement("div", {
    className: "n"
  }, "3"), React.createElement("div", {
    className: "c"
  }, "\u041F\u0440\u043E\u043B\u0438\u0441\u0442\u0430\u0439 \u0432\u043D\u0438\u0437, \xAB\u041D\u0430 \u044D\u043A\u0440\u0430\u043D \u201E\u0414\u043E\u043C\u043E\u0439\u201C\xBB")), React.createElement("div", {
    className: "it"
  }, React.createElement("img", {
    src: "guide-img/ios-4.jpg",
    alt: "\u0428\u0430\u0433 4",
    loading: "lazy"
  }), React.createElement("div", {
    className: "n"
  }, "4"), React.createElement("div", {
    className: "c"
  }, "\u041D\u0430\u0436\u043C\u0438 \xAB\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C\xBB \u0441\u043F\u0440\u0430\u0432\u0430 \u0441\u0432\u0435\u0440\u0445\u0443"))))), React.createElement("div", {
    className: "gd-faq-head"
  }, React.createElement("div", {
    className: "gd-ico"
  }, React.createElement(Ico.help, null)), React.createElement("div", null, React.createElement("div", {
    className: "eyebrow"
  }, "\u0415\u0441\u043B\u0438 \u0447\u0442\u043E-\u0442\u043E \u043D\u0435\u043F\u043E\u043D\u044F\u0442\u043D\u043E"), React.createElement("h2", null, "\u0427\u0430\u0441\u0442\u044B\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B"))), React.createElement("div", {
    className: "gd-faq-list"
  }, GUIDE_FAQ.map((it, i) => React.createElement(FaqItem, {
    key: i,
    q: it.q,
    a: it.a,
    open: openFaq === i,
    onToggle: () => setOpenFaq(cur => cur === i ? -1 : i)
  }))), React.createElement("div", {
    className: "gd-end"
  }, "\u0421\u043F\u043E\u043A\u043E\u0439\u043D\u043E \u0438\u0434\u0438\u0442\u0435 \u043F\u043E \u043E\u0434\u043D\u043E\u043C\u0443 \u0434\u043D\u044E. \u0423 \u0432\u0430\u0441 \u0432\u0441\u0451 \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0441\u044F."));
}
const emailValid = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
let accessCache = {
  list: null,
  admins: []
};
function AccessSection() {
  const [list, setList] = useState(accessCache.list);
  const [admins, setAdmins] = useState(accessCache.admins);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const load = async () => {
    const [aRes, lRes] = await Promise.all([sb.from("admins").select("email"), sb.from("allowed_emails").select("email, note, created_at").order("created_at", {
      ascending: true
    })]);
    if (!aRes.error) {
      const a = (aRes.data || []).map(r => (r.email || "").toLowerCase());
      accessCache.admins = a;
      setAdmins(a);
    }
    if (lRes.error) {
      if (accessCache.list === null) setList([]);
      setMsg({
        type: "err",
        text: "Не удалось обновить список: " + (lRes.error.message || "")
      });
      return;
    }
    accessCache.list = lRes.data || [];
    setList(accessCache.list);
  };
  useEffect(() => {
    load();
  }, []);
  const add = async () => {
    setMsg(null);
    const e = email.trim().toLowerCase();
    if (!emailValid(e)) {
      setMsg({
        type: "err",
        text: "Впиши корректный e-mail."
      });
      return;
    }
    if ((list || []).some(r => (r.email || "").toLowerCase() === e)) {
      setMsg({
        type: "err",
        text: "Уже в списке."
      });
      return;
    }
    setBusy(true);
    const {
      error
    } = await sb.from("allowed_emails").insert({
      email: e
    });
    setBusy(false);
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(error.message || "")) setMsg({
        type: "err",
        text: "Уже в списке."
      });else setMsg({
        type: "err",
        text: "Не получилось добавить: " + (error.message || "")
      });
      return;
    }
    setEmail("");
    setMsg({
      type: "ok",
      text: "Добавлен: " + e
    });
    load();
  };
  const remove = async e => {
    setMsg(null);
    setBusy(true);
    const {
      error
    } = await sb.from("allowed_emails").delete().eq("email", e);
    setBusy(false);
    setConfirm(null);
    if (error) {
      setMsg({
        type: "err",
        text: "Не получилось удалить: " + (error.message || "")
      });
      return;
    }
    setMsg({
      type: "ok",
      text: "Удалён: " + e
    });
    load();
  };
  return React.createElement("div", {
    className: "card access-card"
  }, React.createElement("div", {
    className: "eyebrow"
  }, "\u0414\u043E\u0441\u0442\u0443\u043F\u044B"), React.createElement("div", {
    className: "block-title"
  }, "\u041A\u0442\u043E \u0434\u043E\u043F\u0443\u0449\u0435\u043D \u0432 \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0443"), React.createElement("div", {
    className: "block-sub muted"
  }, "\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0439 e-mail \u043E\u043F\u043B\u0430\u0442\u0438\u0432\u0448\u0438\u0445. \u0420\u0435\u0433\u0438\u0441\u0442\u0440 \u043D\u0435 \u0432\u0430\u0436\u0435\u043D, \u0430\u0434\u0440\u0435\u0441 \u043F\u0440\u0438\u0432\u043E\u0434\u0438\u0442\u0441\u044F \u043A \u043D\u0438\u0436\u043D\u0435\u043C\u0443 \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0443."), React.createElement("div", {
    className: "access-add"
  }, React.createElement("input", {
    className: "adm-input",
    type: "email",
    inputMode: "email",
    autoCapitalize: "none",
    autoCorrect: "off",
    placeholder: "email@example.com",
    value: email,
    onChange: e => setEmail(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") add();
    }
  }), React.createElement("button", {
    className: "btn btn-primary btn-sm",
    onClick: add,
    disabled: busy
  }, "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C")), msg && React.createElement("div", {
    className: "access-msg " + msg.type
  }, msg.text), React.createElement("div", {
    className: "access-list"
  }, list === null ? React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 13,
      padding: "10px 0"
    }
  }, "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430...") : list.length === 0 ? React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 13,
      padding: "10px 0"
    }
  }, "\u041F\u043E\u043A\u0430 \u043D\u0438\u043A\u043E\u0433\u043E \u043D\u0435\u0442.") : list.map(r => {
    const e = (r.email || "").toLowerCase();
    const isAdminEmail = admins.indexOf(e) !== -1;
    return React.createElement("div", {
      key: r.email,
      className: "access-row"
    }, React.createElement("span", {
      className: "access-email"
    }, r.email, isAdminEmail && React.createElement("span", {
      className: "access-tag"
    }, "\u0430\u0434\u043C\u0438\u043D")), isAdminEmail ? React.createElement("span", {
      className: "faint",
      style: {
        fontSize: 11.5,
        flex: "none"
      }
    }, "\u0437\u0430\u0449\u0438\u0449\u0451\u043D") : confirm === r.email ? React.createElement("span", {
      className: "access-confirm"
    }, React.createElement("button", {
      className: "btn btn-sm access-del",
      onClick: () => remove(r.email),
      disabled: busy
    }, "\u0423\u0434\u0430\u043B\u0438\u0442\u044C"), React.createElement("button", {
      className: "btn btn-ghost btn-sm",
      onClick: () => setConfirm(null)
    }, "\u041E\u0442\u043C\u0435\u043D\u0430")) : React.createElement("button", {
      className: "icon-btn",
      title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
      onClick: () => setConfirm(r.email)
    }, "\xD7"));
  })));
}
const STUCK_AFTER_DAYS = 3;
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100,
    b = n % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};
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
  if (d < 31) {
    const w = Math.floor(d / 7);
    return w + " " + plural(w, "неделю", "недели", "недель") + " назад";
  }
  const mo = Math.floor(d / 30);
  return mo + " " + plural(mo, "месяц", "месяца", "месяцев") + " назад";
}
const ST_STATUS = {
  passed: {
    label: "Прошёл",
    cls: "passed"
  },
  active: {
    label: "Активен",
    cls: "active"
  },
  stuck: {
    label: "Застрял",
    cls: "stuck"
  },
  none: {
    label: "Не начал",
    cls: "none"
  }
};
let statsCache = null;
function StatsSection({
  totalDays
}) {
  const [rows, setRows] = useState(statsCache);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState("progress");
  const load = async () => {
    setErr("");
    if (statsCache === null) setRows(null);
    const [pr, gr, ad] = await Promise.all([sb.from("profiles").select("id,name,email"), sb.from("progress").select("user_id,completed,completed_at"), sb.from("admins").select("email")]);
    if (pr.error || gr.error) {
      const e = pr.error || gr.error;
      if (statsCache === null) setRows([]);
      setErr("Не удалось загрузить данные. Запусти SQL для доступа админа (supabase/admin_stats.sql), затем обнови. " + (e && e.message || ""));
      return;
    }
    const adminSet = new Set((ad.data || []).map(r => (r.email || "").toLowerCase()));
    const byUser = {};
    (pr.data || []).forEach(p => {
      const email = (p.email || "").toLowerCase();
      if (adminSet.has(email)) return;
      byUser[p.id] = {
        id: p.id,
        name: (p.name || "").trim(),
        email: p.email || "",
        completed: 0,
        last: null
      };
    });
    (gr.data || []).forEach(r => {
      const u = byUser[r.user_id];
      if (!u || !r.completed) return;
      u.completed += 1;
      if (r.completed_at) {
        const t = new Date(r.completed_at).getTime();
        if (!u.last || t > u.last) u.last = t;
      }
    });
    const now = Date.now();
    const list = Object.values(byUser).map(u => {
      const daysSince = u.last ? Math.floor((now - u.last) / 86400000) : null;
      let status;
      if (u.completed >= totalDays) status = "passed";else if (u.completed === 0) status = "none";else if (daysSince === null || daysSince >= STUCK_AFTER_DAYS) status = "stuck";else status = "active";
      const curDay = u.completed === 0 ? 0 : Math.min(u.completed + 1, totalDays);
      const stageIdx = u.completed === 0 ? -1 : stageOf(curDay);
      return {
        ...u,
        status,
        daysSince,
        curDay,
        stageIdx
      };
    });
    statsCache = list;
    setRows(list);
  };
  useEffect(() => {
    load();
  }, []);
  const summary = useMemo(() => {
    if (!rows) return null;
    const total = rows.length;
    const passed = rows.filter(r => r.status === "passed").length;
    const active = rows.filter(r => r.status === "active").length;
    const stuck = rows.filter(r => r.status === "stuck").length;
    const avg = total ? Math.round(rows.reduce((s, r) => s + r.completed, 0) / (total * totalDays) * 100) : 0;
    const dist = [0, 0, 0, 0, 0, 0];
    rows.forEach(r => {
      if (r.stageIdx === -1) dist[0] += 1;else dist[r.stageIdx + 1] += 1;
    });
    return {
      total,
      passed,
      active,
      stuck,
      avg,
      dist
    };
  }, [rows, totalDays]);
  const sorted = useMemo(() => {
    if (!rows) return [];
    const arr = rows.slice();
    if (sort === "progress") arr.sort((a, b) => b.completed - a.completed || (b.last || 0) - (a.last || 0));else arr.sort((a, b) => (b.last || 0) - (a.last || 0) || b.completed - a.completed);
    return arr;
  }, [rows, sort]);
  const distRows = [{
    name: "Ещё не начали",
    range: ""
  }, ...STAGES.map(s => ({
    name: s.name,
    range: "Дни " + s.from + "-" + s.to
  }))];
  const now = Date.now();
  return React.createElement("div", {
    className: "page"
  }, React.createElement("div", {
    className: "head-row"
  }, React.createElement("div", null, React.createElement("div", {
    className: "eyebrow"
  }, "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435"), React.createElement("h1", null, "\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432"), React.createElement("div", {
    className: "sub"
  }, "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441 \u0438 \u0441\u0442\u0430\u0442\u0443\u0441 \u043A\u0430\u0436\u0434\u043E\u0433\u043E. \u041B\u0438\u0447\u043D\u044B\u0435 \u043E\u0442\u0432\u0435\u0442\u044B \u0438 \u0437\u0430\u043C\u0435\u0442\u043A\u0438 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u043E\u0441\u0442\u0430\u044E\u0442\u0441\u044F \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u044B\u043C\u0438."))), err && React.createElement("div", {
    className: "access-msg err",
    style: {
      marginBottom: 16
    }
  }, err), rows === null ? React.createElement("div", {
    className: "card center",
    style: {
      padding: 40
    }
  }, React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 14
    }
  }, "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0443\u2026")) : summary.total === 0 && !err ? React.createElement("div", {
    className: "card center",
    style: {
      padding: 40
    }
  }, React.createElement("div", {
    style: {
      fontSize: 30
    }
  }, "\uD83D\uDCCA"), React.createElement("div", {
    style: {
      fontWeight: 700,
      marginTop: 8
    }
  }, "\u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432"), React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 13.5,
      marginTop: 4
    }
  }, "\u041A\u0430\u043A \u0442\u043E\u043B\u044C\u043A\u043E \u043B\u044E\u0434\u0438 \u043D\u0430\u0447\u043D\u0443\u0442 \u043F\u0440\u043E\u0445\u043E\u0434\u0438\u0442\u044C \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0443, \u0437\u0434\u0435\u0441\u044C \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u0438\u0445 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441.")) : summary.total > 0 ? React.createElement(React.Fragment, null, React.createElement("div", {
    className: "st-cards"
  }, React.createElement("div", {
    className: "st-kpi"
  }, React.createElement("div", {
    className: "v"
  }, summary.total), React.createElement("div", {
    className: "k"
  }, "\u0432\u0441\u0435\u0433\u043E \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432")), React.createElement("div", {
    className: "st-kpi"
  }, React.createElement("div", {
    className: "v"
  }, summary.active), React.createElement("div", {
    className: "k"
  }, "\u0430\u043A\u0442\u0438\u0432\u043D\u044B \u0441\u0435\u0439\u0447\u0430\u0441")), React.createElement("div", {
    className: "st-kpi" + (summary.stuck > 0 ? " stuck-on" : "")
  }, React.createElement("div", {
    className: "v"
  }, summary.stuck), React.createElement("div", {
    className: "k"
  }, "\u0437\u0430\u0441\u0442\u0440\u044F\u043B\u0438")), React.createElement("div", {
    className: "st-kpi"
  }, React.createElement("div", {
    className: "v"
  }, summary.passed), React.createElement("div", {
    className: "k"
  }, "\u043F\u0440\u043E\u0448\u043B\u0438 \u0432\u0441\u044E \u043F\u0440\u043E\u0433\u0440\u0430\u043C\u043C\u0443")), React.createElement("div", {
    className: "st-kpi st-kpi-accent"
  }, React.createElement("div", {
    className: "v"
  }, summary.avg, "%"), React.createElement("div", {
    className: "k"
  }, "\u0441\u0440\u0435\u0434\u043D\u0438\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441"), React.createElement("div", {
    className: "st-kpi-bar"
  }, React.createElement("i", {
    style: {
      width: summary.avg + "%"
    }
  })))), React.createElement("div", {
    className: "card st-dist"
  }, React.createElement("div", {
    className: "eyebrow"
  }, "\u0420\u0430\u0441\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u0435"), React.createElement("div", {
    className: "block-title"
  }, "\u0413\u0434\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438"), React.createElement("div", {
    className: "st-bars"
  }, distRows.map((d, i) => {
    const count = summary.dist[i];
    const w = summary.total ? Math.round(count / summary.total * 100) : 0;
    return React.createElement("div", {
      key: i,
      className: "st-bar-row"
    }, React.createElement("div", {
      className: "st-bar-label"
    }, React.createElement("span", {
      className: "nm"
    }, d.name), d.range && React.createElement("span", {
      className: "rg muted"
    }, d.range)), React.createElement("div", {
      className: "st-bar-num"
    }, count), React.createElement("div", {
      className: "st-bar-track"
    }, React.createElement("i", {
      className: "st-bar-fill s" + i,
      style: {
        width: w + "%"
      }
    })));
  }))), React.createElement("div", {
    className: "st-toolbar"
  }, React.createElement("h2", {
    style: {
      fontSize: 18
    }
  }, "\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 ", React.createElement("span", {
    className: "faint",
    style: {
      fontWeight: 700,
      fontSize: 14
    }
  }, "\xB7 ", summary.total)), React.createElement("div", {
    className: "st-sort"
  }, React.createElement("button", {
    className: sort === "progress" ? "active" : "",
    onClick: () => setSort("progress")
  }, "\u041F\u043E \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441\u0443"), React.createElement("button", {
    className: sort === "activity" ? "active" : "",
    onClick: () => setSort("activity")
  }, "\u041F\u043E \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u0438"))), React.createElement("div", {
    className: "st-table"
  }, React.createElement("div", {
    className: "st-thead"
  }, React.createElement("div", null, "\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A"), React.createElement("div", null, "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441"), React.createElement("div", null, "\u042D\u0442\u0430\u043F"), React.createElement("div", null, "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C"), React.createElement("div", null, "\u0421\u0442\u0430\u0442\u0443\u0441")), sorted.map(r => {
    const pct = Math.round(r.completed / totalDays * 100);
    const initial = ((r.name || r.email || "?").trim().charAt(0) || "?").toUpperCase();
    const st = ST_STATUS[r.status];
    const sCell = r.status === "none" ? {
      nm: "Ещё не начал",
      sub: ""
    } : r.status === "passed" ? {
      nm: "Пройдено",
      sub: "все " + totalDays + " дней"
    } : {
      nm: STAGES[r.stageIdx].name,
      sub: "идёт день " + r.curDay
    };
    return React.createElement("div", {
      key: r.id,
      className: "st-row " + st.cls
    }, React.createElement("div", {
      className: "st-c st-who"
    }, React.createElement("div", {
      className: "st-ava"
    }, initial), React.createElement("div", {
      className: "st-id"
    }, React.createElement("div", {
      className: "nm"
    }, r.name || r.email), r.name && r.email ? React.createElement("div", {
      className: "em"
    }, r.email) : null)), React.createElement("div", {
      className: "st-c st-prog"
    }, React.createElement("span", {
      className: "st-k"
    }, "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441"), React.createElement("div", {
      className: "st-prog-top"
    }, React.createElement("span", {
      className: "num"
    }, r.completed, "/", totalDays), React.createElement("span", {
      className: "pct muted"
    }, pct, "%")), React.createElement("div", {
      className: "st-prog-bar"
    }, React.createElement("i", {
      style: {
        width: pct + "%"
      }
    }))), React.createElement("div", {
      className: "st-c st-stage"
    }, React.createElement("span", {
      className: "st-k"
    }, "\u042D\u0442\u0430\u043F"), React.createElement("div", {
      className: "st-stage-v"
    }, React.createElement("span", {
      className: "nm"
    }, sCell.nm), sCell.sub && React.createElement("span", {
      className: "sub"
    }, sCell.sub))), React.createElement("div", {
      className: "st-c st-act"
    }, React.createElement("span", {
      className: "st-k"
    }, "\u0410\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C"), React.createElement("span", {
      className: "val"
    }, timeAgo(r.last, now))), React.createElement("div", {
      className: "st-c st-stat"
    }, React.createElement("span", {
      className: "st-chip " + st.cls
    }, st.label)));
  }))) : null);
}
const DayCard = memo(function DayCard({
  day,
  di,
  status,
  onTitle,
  onLesson,
  onTaskText,
  onTaskRemove,
  onTaskAdd,
  onPickAudio,
  onSaveDay
}) {
  const s = status || {};
  return React.createElement("div", {
    className: "card adm-day"
  }, React.createElement("div", {
    className: "head"
  }, React.createElement("div", {
    className: "n"
  }, day.id), React.createElement("input", {
    className: "adm-input",
    value: day.title,
    onChange: e => onTitle(di, e.target.value)
  })), React.createElement("div", {
    className: "adm-label"
  }, "\u0422\u0435\u043A\u0441\u0442 \u0443\u0440\u043E\u043A\u0430"), React.createElement("textarea", {
    className: "adm-input",
    value: day.lesson,
    onChange: e => onLesson(di, e.target.value)
  }), React.createElement("div", {
    className: "adm-label"
  }, "\u0410\u0443\u0434\u0438\u043E \u0443\u0440\u043E\u043A\u0430"), React.createElement("div", {
    className: "uploader"
  }, React.createElement("label", {
    className: "btn btn-ghost btn-sm",
    style: {
      cursor: "pointer"
    }
  }, React.createElement(Ico.upload, null), " \u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0430\u0443\u0434\u0438\u043E", React.createElement("input", {
    type: "file",
    accept: ".mp3,.m4a,.wav,.ogg,audio/*",
    style: {
      display: "none"
    },
    onChange: e => {
      const f = e.target.files[0];
      e.target.value = "";
      onPickAudio(di, f);
    }
  })), React.createElement("span", {
    className: "file-name" + (day.audioName ? "" : " empty")
  }, day.audioName || "файл не выбран")), s.up === "uploading" && React.createElement("div", {
    className: "up-status"
  }, React.createElement("div", {
    className: "up-bar"
  }, React.createElement("i", {
    style: {
      width: (s.progress || 0) + "%"
    }
  })), React.createElement("div", {
    className: "up-line muted"
  }, "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442\u0441\u044F\u2026 ", s.progress || 0, "%")), s.up === "done" && React.createElement("div", {
    className: "up-status"
  }, React.createElement("div", {
    className: "up-line ok"
  }, React.createElement("span", {
    className: "ok-tick"
  }, "\u2713"), " \u0417\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043E: ", s.msg), s.preview && React.createElement("audio", {
    className: "up-preview",
    controls: true,
    preload: "metadata",
    src: s.preview
  })), s.up === "error" && React.createElement("div", {
    className: "up-line err"
  }, s.msg), React.createElement("div", {
    className: "adm-label"
  }, "\u0417\u0430\u0434\u0430\u043D\u0438\u044F"), day.tasks.map((t, ti) => React.createElement("div", {
    key: t.id,
    className: "adm-task"
  }, React.createElement("input", {
    className: "adm-input",
    value: t.text,
    onChange: e => onTaskText(di, ti, e.target.value)
  }), React.createElement("button", {
    className: "icon-btn",
    title: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
    onClick: () => onTaskRemove(di, ti)
  }, "\xD7"))), React.createElement("button", {
    className: "btn btn-ghost btn-sm adm-add",
    onClick: () => onTaskAdd(di)
  }, "+ \u0417\u0430\u0434\u0430\u043D\u0438\u0435"), React.createElement("div", {
    className: "adm-save"
  }, React.createElement("button", {
    className: "btn btn-primary btn-sm",
    disabled: s.save === "saving",
    onClick: () => onSaveDay(di)
  }, s.save === "saving" ? "Сохраняю…" : "Сохранить день"), s.save === "saved" && React.createElement("span", {
    className: "save-ok"
  }, React.createElement("span", {
    className: "ok-tick"
  }, "\u2713"), " ", s.saveMsg), s.save === "error" && React.createElement("span", {
    className: "save-err"
  }, s.saveMsg)));
});
function Admin({
  days,
  setDays,
  onReload
}) {
  const [stMap, setStMap] = useState({});
  const daysRef = useRef(days);
  daysRef.current = days;
  const setSt = useCallback((id, patch) => setStMap(s => ({
    ...s,
    [id]: {
      ...(s[id] || {}),
      ...patch
    }
  })), []);
  const patchDay = useCallback((di, patch) => {
    setDays(ds => ds.map((d, i) => i === di ? {
      ...d,
      ...(typeof patch === "function" ? patch(d) : patch)
    } : d));
  }, [setDays]);
  const onTitle = useCallback((di, v) => patchDay(di, {
    title: v
  }), [patchDay]);
  const onLesson = useCallback((di, v) => patchDay(di, {
    lesson: v
  }), [patchDay]);
  const onTaskText = useCallback((di, ti, v) => patchDay(di, x => ({
    ...x,
    tasks: x.tasks.map((tt, j) => j === ti ? {
      ...tt,
      text: v
    } : tt)
  })), [patchDay]);
  const onTaskRemove = useCallback((di, ti) => patchDay(di, x => ({
    ...x,
    tasks: x.tasks.filter((_, j) => j !== ti)
  })), [patchDay]);
  const onTaskAdd = useCallback(di => patchDay(di, x => ({
    ...x,
    tasks: [...x.tasks, {
      id: "new-" + Date.now(),
      text: "Новое задание",
      done: false,
      answer: ""
    }]
  })), [patchDay]);
  const addDay = useCallback(() => setDays(ds => [...ds, {
    id: (ds.length ? ds[ds.length - 1].id : 0) + 1,
    title: "Новый день",
    lesson: "Текст урока.",
    duration: 420,
    audioPath: "",
    audioName: "",
    note: "",
    tasks: [{
      id: "new-" + Date.now(),
      text: "Новое задание",
      done: false,
      answer: ""
    }]
  }]), [setDays]);
  const onPickAudio = useCallback(async (di, file) => {
    const d = daysRef.current[di];
    if (!file) return;
    const ext = extOf(file.name);
    if (!AUDIO_EXT.includes(ext)) {
      setSt(d.id, {
        up: "error",
        msg: "Формат «." + ext + "» не поддержан. Нужен mp3, m4a, wav или ogg. Для веба надёжнее mp3 и m4a.",
        preview: null
      });
      return;
    }
    const mb = file.size / 1024 / 1024;
    if (mb > MAX_AUDIO_MB) {
      setSt(d.id, {
        up: "error",
        msg: "Файл весит " + mb.toFixed(1) + " МБ, это больше лимита " + MAX_AUDIO_MB + " МБ. Сожми его или сохрани как mp3.",
        preview: null
      });
      return;
    }
    setSt(d.id, {
      up: "uploading",
      progress: 0,
      msg: "",
      preview: null
    });
    try {
      const dur = await readAudioDuration(file);
      const path = "day-" + d.id + "/" + Date.now() + "-" + slugFile(file.name);
      await uploadAudioFile(path, file, p => setSt(d.id, {
        up: "uploading",
        progress: p
      }));
      const preview = await signedAudioUrl(path);
      const durSec = dur ? Math.round(dur) : d.duration;
      patchDay(di, x => ({
        ...x,
        audioPath: path,
        audioName: file.name,
        duration: durSec
      }));
      const cur = daysRef.current[di];
      const {
        error
      } = await sb.from("days").upsert({
        day_number: d.id,
        title: cur.title,
        lesson: cur.lesson,
        audio_url: path,
        audio_name: file.name,
        duration_min: durSec / 60
      }, {
        onConflict: "day_number"
      });
      if (error) throw error;
      setSt(d.id, {
        up: "done",
        progress: 100,
        msg: file.name,
        preview
      });
    } catch (e) {
      setSt(d.id, {
        up: "error",
        msg: e && e.message || "Не удалось загрузить файл.",
        preview: null
      });
    }
  }, [patchDay, setSt]);
  const onSaveDay = useCallback(async di => {
    const d = daysRef.current[di];
    setSt(d.id, {
      save: "saving",
      saveMsg: ""
    });
    try {
      const {
        error: de
      } = await sb.from("days").upsert({
        day_number: d.id,
        title: d.title,
        lesson: d.lesson,
        audio_url: d.audioPath || null,
        audio_name: d.audioName || null,
        duration_min: (Number(d.duration) || 0) / 60
      }, {
        onConflict: "day_number"
      });
      if (de) throw de;
      const {
        data: existing,
        error: ee
      } = await sb.from("tasks").select("id,position").eq("day_number", d.id);
      if (ee) throw ee;
      const keepIds = d.tasks.filter(t => isUuid(t.id)).map(t => t.id);
      const toDelete = (existing || []).filter(r => !keepIds.includes(r.id)).map(r => r.id);
      if (toDelete.length) {
        const {
          error
        } = await sb.from("tasks").delete().in("id", toDelete);
        if (error) throw error;
      }
      let maxPos = (existing || []).reduce((m, r) => Math.max(m, r.position || 0), 0);
      const remap = [];
      for (let i = 0; i < d.tasks.length; i++) {
        const t = d.tasks[i];
        const text = (t.text || "").trim();
        if (!text) continue;
        if (isUuid(t.id)) {
          const {
            error
          } = await sb.from("tasks").update({
            text
          }).eq("id", t.id);
          if (error) throw error;
        } else {
          maxPos += 1;
          const {
            data,
            error
          } = await sb.from("tasks").insert({
            day_number: d.id,
            position: maxPos,
            text
          }).select("id").single();
          if (error) throw error;
          remap.push({
            idx: i,
            id: data.id
          });
        }
      }
      if (remap.length) {
        setDays(ds => ds.map((x, ix) => ix !== di ? x : {
          ...x,
          tasks: x.tasks.map((t, j) => {
            const f = remap.find(r => r.idx === j);
            return f ? {
              ...t,
              id: f.id
            } : t;
          })
        }));
      }
      setSt(d.id, {
        save: "saved",
        saveMsg: "Сохранено"
      });
      setTimeout(() => setSt(d.id, {
        save: "idle",
        saveMsg: ""
      }), 3500);
    } catch (e) {
      setSt(d.id, {
        save: "error",
        saveMsg: e && e.message || "Не удалось сохранить."
      });
    }
  }, [setDays, setSt]);
  return React.createElement("div", {
    className: "page"
  }, React.createElement("div", {
    className: "head-row"
  }, React.createElement("div", null, React.createElement("div", {
    className: "eyebrow"
  }, "\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435"), React.createElement("h1", null, "\u0410\u0434\u043C\u0438\u043D"), React.createElement("div", {
    className: "sub"
  }, "\u0414\u043E\u0441\u0442\u0443\u043F\u044B \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u0438 \u043A\u043E\u043D\u0442\u0435\u043D\u0442 \u0434\u043D\u0435\u0439."))), React.createElement(AccessSection, null), React.createElement("div", {
    className: "eyebrow",
    style: {
      margin: "26px 0 14px"
    }
  }, "\u0414\u043D\u0438 \u0438 \u0443\u0440\u043E\u043A\u0438"), React.createElement("div", {
    className: "block-sub muted",
    style: {
      marginTop: -8,
      marginBottom: 14
    }
  }, "\u041C\u0435\u043D\u044F\u0439 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F, \u0442\u0435\u043A\u0441\u0442\u044B \u0443\u0440\u043E\u043A\u043E\u0432, \u0430\u0443\u0434\u0438\u043E \u0438 \u0437\u0430\u0434\u0430\u043D\u0438\u044F. \u0417\u0430\u0433\u0440\u0443\u0437\u0438 \u0444\u0430\u0439\u043B, \u043F\u043E\u0442\u043E\u043C \u043D\u0430\u0436\u043C\u0438 \xAB\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0434\u0435\u043D\u044C\xBB, \u0438 \u043F\u0440\u0430\u0432\u043A\u0438 \u0443\u0439\u0434\u0443\u0442 \u0432 \u0431\u0430\u0437\u0443, \u043E\u0441\u0442\u0430\u043D\u0443\u0442\u0441\u044F \u043D\u0430\u0432\u0441\u0435\u0433\u0434\u0430 \u0438 \u043F\u043E\u043A\u0430\u0436\u0443\u0442\u0441\u044F \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0430\u043C."), React.createElement("div", {
    className: "adm-actions"
  }, React.createElement("button", {
    className: "btn btn-primary btn-sm",
    onClick: addDay
  }, "+ \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0434\u0435\u043D\u044C"), React.createElement("button", {
    className: "btn btn-ghost btn-sm",
    onClick: onReload
  }, "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0438\u0437 \u0431\u0430\u0437\u044B")), React.createElement("div", {
    className: "adm-list"
  }, days.map((d, di) => React.createElement(DayCard, {
    key: d.id,
    day: d,
    di: di,
    status: stMap[d.id],
    onTitle: onTitle,
    onLesson: onLesson,
    onTaskText: onTaskText,
    onTaskRemove: onTaskRemove,
    onTaskAdd: onTaskAdd,
    onPickAudio: onPickAudio,
    onSaveDay: onSaveDay
  }))));
}
const NAV = [{
  k: "dashboard",
  label: "Мой прогресс",
  short: "Прогресс",
  icon: Ico.home
}, {
  k: "map",
  label: "Карта дней",
  short: "Карта",
  icon: Ico.map
}, {
  k: "diary",
  label: "Дневник",
  short: "Дневник",
  icon: Ico.book
}, {
  k: "guide",
  label: "Инструкция",
  short: "Инструкция",
  icon: Ico.info
}, {
  k: "stats",
  label: "Статистика",
  short: "Сводка",
  icon: Ico.chart,
  adminOnly: true
}, {
  k: "admin",
  label: "Админ",
  short: "Админ",
  icon: Ico.cog,
  adminOnly: true
}];
const navItems = isAdmin => NAV.filter(it => !it.adminOnly || isAdmin);
function InstallButton({
  force
}) {
  const [show, setShow] = useState(!!force);
  const [ios, setIos] = useState(false);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent || ""));
    if (force) {
      setShow(true);
      return;
    }
    const standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (standalone) return;
    setShow(true);
  }, [force]);
  if (!show) return null;
  const click = async () => {
    if (window.__bip) {
      window.__bip.prompt();
      try {
        await window.__bip.userChoice;
      } catch (e) {}
      window.__bip = null;
      setShow(false);
    } else {
      setSheet(true);
    }
  };
  return React.createElement(React.Fragment, null, React.createElement("button", {
    className: "install-btn",
    onClick: click
  }, React.createElement(Ico.download, null), " \u0418\u043A\u043E\u043D\u043A\u0430 \u043D\u0430 \u044D\u043A\u0440\u0430\u043D \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430"), sheet && React.createElement(InstallSheet, {
    ios: ios,
    onClose: () => setSheet(false)
  }));
}
function InstallSheet({
  ios,
  onClose
}) {
  return React.createElement("div", {
    className: "sheet-scrim",
    onClick: onClose
  }, React.createElement("div", {
    className: "sheet",
    onClick: e => e.stopPropagation()
  }, React.createElement("div", {
    className: "sheet-grip"
  }), React.createElement("div", {
    className: "sheet-title"
  }, "\u0418\u043A\u043E\u043D\u043A\u0430 \u043D\u0430 \u044D\u043A\u0440\u0430\u043D \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430"), ios ? React.createElement("ol", {
    className: "sheet-steps"
  }, React.createElement("li", null, "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 ", React.createElement("b", null, "\u043C\u0435\u043D\u044E \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430"), " (\u043A\u043D\u043E\u043F\u043A\u0430 ", React.createElement("b", null, "\u2261"), ", \u043B\u0438\u0431\u043E ", React.createElement("b", null, "\u041F\u043E\u0434\u0435\u043B\u0438\u0442\u044C\u0441\u044F"), " ", React.createElement("span", {
    className: "sheet-ic"
  }, React.createElement(Ico.share, null)), ")."), React.createElement("li", null, "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 ", React.createElement("b", null, "\xAB\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u044F\u0440\u043B\u044B\u043A \u043D\u0430 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\xBB"), " (\u042F\u043D\u0434\u0435\u043A\u0441) \u0438\u043B\u0438 ", React.createElement("b", null, "\xAB\u041D\u0430 \u044D\u043A\u0440\u0430\u043D \u0414\u043E\u043C\u043E\u0439\xBB"), " (Safari)."), React.createElement("li", null, "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 ", React.createElement("b", null, "\xAB\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C\xBB"), " \u0441\u043F\u0440\u0430\u0432\u0430 \u0441\u0432\u0435\u0440\u0445\u0443.")) : React.createElement("ol", {
    className: "sheet-steps"
  }, React.createElement("li", null, "\u041E\u0442\u043A\u0440\u043E\u0439 \u043C\u0435\u043D\u044E \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430 ", React.createElement("b", null, "\u22EE"), "."), React.createElement("li", null, "\u0412\u044B\u0431\u0435\u0440\u0438 ", React.createElement("b", null, "\xAB\u0423\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435\xBB"), " \u0438\u043B\u0438 ", React.createElement("b", null, "\xAB\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u044B\u0439 \u044D\u043A\u0440\u0430\u043D\xBB"), "."), React.createElement("li", null, "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438, \u0438\u043A\u043E\u043D\u043A\u0430 \u043F\u043E\u044F\u0432\u0438\u0442\u0441\u044F \u043D\u0430 \u044D\u043A\u0440\u0430\u043D\u0435.")), React.createElement("button", {
    className: "btn btn-primary",
    onClick: onClose
  }, "\u041F\u043E\u043D\u044F\u0442\u043D\u043E")));
}
function Sidebar({
  tab,
  setTab,
  onLogout,
  profile,
  isAdmin
}) {
  const name = profile && profile.name || "Профиль";
  const email = profile && profile.email || "";
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();
  return React.createElement("aside", {
    className: "sidebar"
  }, React.createElement("div", {
    className: "sb-brand"
  }, React.createElement("div", {
    className: "sb-mark"
  }, "\u20BD"), React.createElement("div", null, React.createElement("div", {
    className: "nm"
  }, "\u041F\u0440\u043E\u0442\u043E\u043A\u043E\u043B \u0434\u0435\u043D\u0435\u0433"), React.createElement("div", {
    className: "sub"
  }, "17 \u0434\u043D\u0435\u0439"))), React.createElement("nav", {
    className: "sb-nav"
  }, navItems(isAdmin).map(it => React.createElement("button", {
    key: it.k,
    className: tab === it.k ? "active" : "",
    onClick: () => setTab(it.k)
  }, React.createElement(it.icon, null), " ", it.label))), React.createElement("div", {
    className: "sb-foot"
  }, React.createElement("div", {
    className: "sb-user"
  }, React.createElement("div", {
    className: "sb-ava"
  }, initial), React.createElement("div", {
    className: "who"
  }, React.createElement("div", {
    className: "n"
  }, name), React.createElement("div", {
    className: "e"
  }, email)), React.createElement("button", {
    className: "sb-logout",
    title: "\u0412\u044B\u0439\u0442\u0438",
    onClick: onLogout
  }, React.createElement(Ico.out, null)))));
}
function BottomNav({
  tab,
  setTab,
  isAdmin
}) {
  return React.createElement("nav", {
    className: "bottomnav"
  }, navItems(isAdmin).map(it => React.createElement("button", {
    key: it.k,
    className: tab === it.k ? "active" : "",
    onClick: () => setTab(it.k)
  }, React.createElement(it.icon, null), " ", it.short)));
}
function Splash({
  text,
  sub,
  onLogout
}) {
  return React.createElement("div", {
    className: "auth-wrap"
  }, React.createElement("div", {
    className: "auth-box"
  }, React.createElement("div", {
    className: "brand"
  }, React.createElement("div", {
    className: "mark"
  }, "\u20BD")), React.createElement("div", {
    className: "card center"
  }, React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 16,
      lineHeight: 1.4
    }
  }, text), sub && React.createElement("div", {
    className: "muted",
    style: {
      fontSize: 12.5,
      marginTop: 10,
      wordBreak: "break-word",
      lineHeight: 1.5
    }
  }, sub), onLogout && React.createElement(React.Fragment, null, React.createElement("div", {
    className: "spacer"
  }), React.createElement("div", {
    className: "spacer"
  }), React.createElement("button", {
    className: "btn btn-ghost",
    onClick: onLogout
  }, "\u0412\u044B\u0439\u0442\u0438")))));
}
function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [days, setDays] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [openDay, setOpenDay] = useState(null);
  const loadedUid = useRef(null);
  useEffect(() => {
    if (!sb) {
      setSession(null);
      return;
    }
    const applySession = s => setSession(prev => {
      const next = s || null;
      if (prev && next && prev.user && next.user && prev.user.id === next.user.id && prev.access_token === next.access_token) return prev;
      if (prev === null && next === null) return prev;
      return next;
    });
    sb.auth.getSession().then(({
      data
    }) => applySession(data.session));
    const {
      data: sub
    } = sb.auth.onAuthStateChange((_e, s) => applySession(s));
    return () => {
      if (sub && sub.subscription) sub.subscription.unsubscribe();
    };
  }, []);
  const reload = async () => {
    try {
      const d = await loadDaysFromDb();
      setDays(d);
      setLoadErr("");
    } catch (e) {
      setDays(cur => cur && cur.length ? cur : []);
      setLoadErr(e && e.message || "Не удалось загрузить данные.");
    }
  };
  useEffect(() => {
    if (session) {
      const uid = session.user.id;
      if (loadedUid.current === uid) return;
      loadedUid.current = uid;
      const cached = readDaysCache(uid);
      if (cached) setDays(cached);
      reload();
      sb.from("profiles").select("name,email").eq("id", uid).maybeSingle().then(({
        data
      }) => setProfile(data || {
        name: session.user.user_metadata && session.user.user_metadata.name || "",
        email: session.user.email
      }));
      sb.rpc("is_admin").then(({
        data
      }) => setIsAdmin(!!data)).catch(() => setIsAdmin(false));
    } else {
      loadedUid.current = null;
      setDays(null);
      setProfile(null);
      setOpenDay(null);
      setTab("dashboard");
      setIsAdmin(false);
    }
  }, [session]);
  const unlockedCount = useMemo(() => days ? unlockedCountNow(days.length) : 0, [days]);
  const currentIndex = useMemo(() => {
    if (!days || !days.length) return 0;
    return computeCurrentIndex(days, unlockedCount);
  }, [days, unlockedCount]);
  useEffect(() => {
    const m = document.querySelector(".main");
    if (m) m.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [openDay, tab]);
  useEffect(() => {
    if (session && days && days.length) writeDaysCache(session.user.id, days);
  }, [days, session]);
  if (!sb) return React.createElement(Splash, {
    text: "\u041D\u0435\u0442 \u043A\u043B\u044E\u0447\u0435\u0439 Supabase",
    sub: "\u0421\u043E\u0437\u0434\u0430\u0439 config.js \u0438\u0437 config.example.js \u0438 \u043E\u0431\u043D\u043E\u0432\u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443."
  });
  if (session === undefined) return React.createElement(Splash, {
    text: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026"
  });
  if (!session) return React.createElement(Auth, null);
  if (days === null) return React.createElement(Splash, {
    text: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044E \u043A\u0443\u0440\u0441\u2026"
  });
  if (loadErr && (!days || !days.length)) return React.createElement(Splash, {
    text: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0434\u043D\u0438",
    sub: "Запусти SQL-скрипт supabase/schema.sql в Supabase, затем обнови страницу. Подробности: " + loadErr,
    onLogout: () => sb.auth.signOut()
  });
  if (!days.length) return React.createElement(Splash, {
    text: "\u0412 \u0431\u0430\u0437\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u0434\u043D\u0435\u0439",
    sub: "\u0417\u0430\u043F\u0443\u0441\u0442\u0438 \u0440\u0430\u0437\u0434\u0435\u043B \u043D\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u0432 supabase/schema.sql, \u0437\u0430\u0442\u0435\u043C \u043E\u0431\u043D\u043E\u0432\u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443.",
    onLogout: () => sb.auth.signOut()
  });
  const uid = session.user.id;
  const setLocalTask = (di, tid, patch) => setDays(ds => ds.map((d, i) => i !== di ? d : {
    ...d,
    tasks: d.tasks.map(t => t.id === tid ? {
      ...t,
      ...patch
    } : t)
  }));
  const persist = async (builder, what) => {
    try {
      const {
        error
      } = await builder;
      if (error) throw error;
      return true;
    } catch (e) {
      console.error("Ошибка сохранения (" + what + "):", e);
      setSaveErr("Не удалось сохранить " + what + ". " + (e && e.message || ""));
      setTimeout(() => setSaveErr(""), 6000);
      return false;
    }
  };
  const saveAnswer = (tid, answer, done) => persist(sb.from("task_answers").upsert({
    user_id: uid,
    task_id: tid,
    answer: answer,
    done: done,
    updated_at: nowISO()
  }, {
    onConflict: "user_id,task_id"
  }), "ответ");
  const saveProgress = (dayNumber, completed) => persist(sb.from("progress").upsert({
    user_id: uid,
    day_number: dayNumber,
    completed: completed,
    completed_at: completed ? nowISO() : null
  }, {
    onConflict: "user_id,day_number"
  }), "прогресс");
  const onAnswer = (di, tid, v) => setLocalTask(di, tid, {
    answer: v
  });
  const onAnswerBlur = (di, tid) => {
    const t = days[di].tasks.find(x => x.id === tid);
    if (t && t.answer && t.answer.trim()) saveAnswer(tid, t.answer, t.done);
  };
  const onConfirm = (di, tid) => {
    setLocalTask(di, tid, {
      done: true
    });
    const day = days[di];
    const t = day.tasks.find(x => x.id === tid);
    saveAnswer(tid, t ? t.answer : "", true);
    saveProgress(day.id, day.tasks.every(x => x.id === tid ? true : x.done));
  };
  const onEdit = (di, tid) => {
    setLocalTask(di, tid, {
      done: false
    });
    const t = days[di].tasks.find(x => x.id === tid);
    saveAnswer(tid, t ? t.answer : "", false);
    saveProgress(days[di].id, false);
  };
  const onNote = (di, v) => {
    setDays(ds => ds.map((d, i) => i !== di ? d : {
      ...d,
      note: v
    }));
    persist(sb.from("notes").upsert({
      user_id: uid,
      day_number: days[di].id,
      text: v,
      updated_at: nowISO()
    }, {
      onConflict: "user_id,day_number"
    }), "заметку");
  };
  const onState = (di, value) => {
    setDays(ds => ds.map((d, i) => i !== di ? d : {
      ...d,
      state: value
    }));
    if (cfg().CHECKINS_READY) {
      try {
        sb.from("checkins").upsert({
          user_id: uid,
          day_number: days[di].id,
          value: value,
          updated_at: nowISO()
        }, {
          onConflict: "user_id,day_number"
        }).then(() => {}, () => {});
      } catch (e) {}
    }
  };
  const goTab = t => {
    setOpenDay(null);
    setTab(t);
  };
  const logout = () => sb.auth.signOut();
  const openDayGuarded = i => {
    if (i == null || !days[i]) {
      setOpenDay(null);
      return;
    }
    if (isAdmin || dayOpenable(dayStatus(days[i], i, unlockedCount, currentIndex))) setOpenDay(i);
  };
  let content;
  if (openDay !== null) {
    const ni = openDay + 1;
    const nextDay = days[ni] || null;
    const nextReady = !!nextDay && (isAdmin || dayOpenable(dayStatus(nextDay, ni, unlockedCount, currentIndex)));
    content = React.createElement(DayScreen, {
      day: days[openDay],
      dayIndex: openDay,
      total: days.length,
      onBack: () => setOpenDay(null),
      onGoMap: () => goTab("map"),
      nextDay: nextDay,
      nextReady: nextReady,
      nextLabel: nextDay ? unlockLabel(nextDay.id) : "",
      onOpenNext: () => openDayGuarded(ni),
      onAnswer: (tid, v) => onAnswer(openDay, tid, v),
      onAnswerBlur: tid => onAnswerBlur(openDay, tid),
      onConfirm: tid => onConfirm(openDay, tid),
      onEdit: tid => onEdit(openDay, tid),
      onNote: v => onNote(openDay, v),
      onState: v => onState(openDay, v)
    });
  } else if (tab === "dashboard") {
    content = React.createElement(Dashboard, {
      days: days,
      currentIndex: currentIndex,
      unlockedCount: unlockedCount,
      onOpenDay: openDayGuarded,
      onGoDiary: () => goTab("diary"),
      userName: profile && profile.name && profile.name.trim() || "",
      isAdmin: isAdmin,
      onLogout: logout
    });
  } else if (tab === "map") {
    content = React.createElement(DayMap, {
      days: days,
      currentIndex: currentIndex,
      unlockedCount: unlockedCount,
      onOpenDay: openDayGuarded,
      isAdmin: isAdmin
    });
  } else if (tab === "diary") {
    content = React.createElement(Diary, {
      days: days,
      onOpenDay: openDayGuarded
    });
  } else if (tab === "guide") {
    content = React.createElement(Guide, null);
  } else if (tab === "stats" && isAdmin) {
    content = React.createElement(StatsSection, {
      totalDays: days.length
    });
  } else if (tab === "admin" && isAdmin) {
    content = React.createElement(Admin, {
      days: days,
      setDays: setDays,
      onReload: reload
    });
  } else {
    content = React.createElement(Dashboard, {
      days: days,
      currentIndex: currentIndex,
      unlockedCount: unlockedCount,
      onOpenDay: openDayGuarded,
      onGoDiary: () => goTab("diary"),
      userName: profile && profile.name && profile.name.trim() || "",
      isAdmin: isAdmin,
      onLogout: logout
    });
  }
  return React.createElement("div", {
    className: "layout"
  }, saveErr && React.createElement("div", {
    className: "save-banner"
  }, saveErr), React.createElement(Sidebar, {
    tab: tab,
    setTab: goTab,
    onLogout: logout,
    profile: profile,
    isAdmin: isAdmin
  }), React.createElement("main", {
    className: "main"
  }, React.createElement("div", {
    className: "content"
  }, content)), React.createElement(BottomNav, {
    tab: tab,
    setTab: goTab,
    isAdmin: isAdmin
  }));
}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App, null));