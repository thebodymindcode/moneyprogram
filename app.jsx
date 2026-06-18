const { useState, useEffect, useMemo, useRef } = React;

/* ========================= helpers ========================= */
const sb = window.sb; // единый клиент Supabase (создан в supabaseClient.js)
const nowISO = () => new Date().toISOString();

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
    audioName: d.audio_url || "",
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
// статус дня: пройден, сегодня, доступен (открыт, но не сделан и не текущий), закрыт
function dayStatus(d, i, unlockedCount, currentIndex) {
  if (isDayDone(d)) return "done";
  if (i + 1 > unlockedCount) return "locked";
  if (i === currentIndex) return "today";
  return "open";
}
const STATUS_LABEL = { done: "Пройден", today: "Сегодня", open: "Доступен", locked: "Закрыт" };

/* ========================= icons ========================= */
const Ico = {
  check: (p) => <svg viewBox="0 0 24 24" width="15" height="15" {...p}><path d="M5 13l4 4L19 7" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  chev: (p) => <svg viewBox="0 0 24 24" width="20" height="20" {...p}><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  back: (p) => <svg viewBox="0 0 24 24" width="17" height="17" {...p}><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  home: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>,
  map: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="6" cy="7" r="2.2"/><circle cx="18" cy="17" r="2.2"/><path d="M6 9.2v3.3a3 3 0 003 3h6"/></svg>,
  cog: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.6 1.6 0 00.3 1.7l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H3a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.7.3 1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.7-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.7V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/></svg>,
  lock: (p) => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>,
  play: (p) => <svg viewBox="0 0 24 24" width="22" height="22" {...p}><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>,
  pause: (p) => <svg viewBox="0 0 24 24" width="22" height="22" {...p}><rect x="7" y="5" width="3.4" height="14" rx="1.2" fill="currentColor"/><rect x="13.6" y="5" width="3.4" height="14" rx="1.2" fill="currentColor"/></svg>,
  wave: (p) => <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M4 12h2M9 8v8M14 5v14M19 9v6"/></svg>,
  upload: (p) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 16V5M8 9l4-4 4 4"/><path d="M5 19h14"/></svg>,
  out: (p) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 7V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2h6a2 2 0 002-2v-2"/><path d="M18 15l3-3-3-3M21 12H9"/></svg>,
  book: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 4h11a2 2 0 012 2v14H7a2 2 0 01-2-2z"/><path d="M5 4a2 2 0 00-2 2v12a2 2 0 002 2"/><path d="M9 8h6M9 12h6"/></svg>,
  mind: (p) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 4.5a3 3 0 00-3 3v9a3 3 0 003 3"/><path d="M12 4.5a3 3 0 013 3v9a3 3 0 01-3 3"/><path d="M9 8.5H7.5a2 2 0 000 4H9M15 8.5h1.5a2 2 0 010 4H15"/></svg>,
  layers: (p) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>,
  body: (p) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="6" r="3"/><path d="M5 21c0-4 3.1-7 7-7s7 3 7 7"/></svg>,
  drop: (p) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3.2s6 5.7 6 9.8a6 6 0 01-12 0c0-4.1 6-9.8 6-9.8z"/></svg>,
  chart: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 21h18"/><rect x="5" y="11" width="3.2" height="7" rx="1"/><rect x="10.4" y="6.5" width="3.2" height="11.5" rx="1"/><rect x="15.8" y="13.5" width="3.2" height="4.5" rx="1"/></svg>,
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
function Dashboard({ days, currentIndex, unlockedCount, onOpenDay, onGoDiary, userName }) {
  const done = days.filter(isDayDone).length;
  const streak = (() => { let s = 0; for (const d of days) { if (isDayDone(d)) s++; else break; } return s; })();
  const pct = Math.round((done / days.length) * 100);
  const today = days[currentIndex];
  const todayUnlocked = currentIndex + 1 <= unlockedCount;
  const upcoming = days.slice(currentIndex, currentIndex + 5);

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
              const st = dayStatus(d, di, unlockedCount, currentIndex);
              const bg = st === "done" ? { background: "var(--good-soft)", color: "var(--good)" }
                : (st === "today" || st === "open") ? { background: "#e7ebf1", color: "var(--steel)" }
                : { background: "#eef1f5", color: "var(--ink-faint)" };
              const clickable = st !== "locked";
              return (
                <div key={d.id} className="card mini" onClick={() => clickable && onOpenDay(di)} style={{ opacity: clickable ? 1 : .85 }}>
                  <div className="badge" style={bg}>{st === "done" ? <Ico.check /> : st === "locked" ? <Ico.lock /> : d.id}</div>
                  <div className="nm">{d.title}</div>
                  <div className="du">{st === "locked" ? unlockLabel(d.id) : <>🎧 {durLabel(d.duration)}</>}</div>
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
function DayMap({ days, currentIndex, unlockedCount, onOpenDay }) {
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
          const status = dayStatus(d, i, unlockedCount, currentIndex);
          const clickable = status !== "locked";
          return (
            <div key={d.id} className={"node " + status} onClick={() => clickable && onOpenDay(i)}>
              <div className="dot">{status === "done" ? <Ico.check /> : status === "locked" ? <Ico.lock /> : d.id}</div>
              <div className="body">
                <div className="t">День {d.id}: {d.title}</div>
                <div className="s">{status === "locked" ? unlockLabel(d.id) : <>🎧 {durLabel(d.duration)} · {d.tasks.length} {taskWord(d.tasks.length)}</>}</div>
              </div>
              <span className={"tag " + status}>{STATUS_LABEL[status]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ========================= Audio player (демо) ========================= */
function Player({ day }) {
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const barRef = useRef(null);
  const dur = day.duration;

  useEffect(() => { setPlaying(false); setT(0); }, [day.id]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((x) => { if (x + 1 >= dur) { setPlaying(false); return dur; } return x + 1; });
    }, 1000);
    return () => clearInterval(id);
  }, [playing, dur]);

  const seek = (e) => {
    const rect = barRef.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    setT(Math.min(dur, Math.max(0, Math.round((cx / rect.width) * dur))));
  };
  const pct = (t / dur) * 100;

  return (
    <div className="card">
      <div className="player">
        <div className="cover"><Ico.wave /></div>
        <div className="pl-body">
          <div className="k">Урок дня</div>
          <div className="t">{day.title}</div>
        </div>
        <button className="play-btn" onClick={() => { if (t >= dur) setT(0); setPlaying((p) => !p); }}>
          {playing ? <Ico.pause /> : <Ico.play />}
        </button>
      </div>
      <div className="seek">
        <div className="seek-bar" ref={barRef} onClick={seek}>
          <i style={{ width: pct + "%" }} />
          <b style={{ left: pct + "%" }} />
        </div>
        <div className="seek-time"><span>{fmt(t)}</span><span>{fmt(dur)}</span></div>
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

/* ========================= Управление доступом ========================= */
const emailValid = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function AccessSection() {
  const [list, setList] = useState(null);     // null = загрузка
  const [admins, setAdmins] = useState([]);   // e-mail админов (их нельзя убрать)
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState(null);       // {type:"ok"|"err", text}
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    const a = await sb.from("admins").select("email");
    setAdmins(((a.data) || []).map((r) => (r.email || "").toLowerCase()));
    const { data, error } = await sb.from("allowed_emails").select("email, note, created_at").order("created_at", { ascending: true });
    if (error) { setList([]); setMsg({ type: "err", text: "Не удалось загрузить список: " + (error.message || "") }); return; }
    setList(data || []);
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

function StatsSection({ totalDays }) {
  const [rows, setRows] = useState(null);   // null = загрузка
  const [err, setErr] = useState("");
  const [sort, setSort] = useState("progress"); // progress | activity

  const load = async () => {
    setErr(""); setRows(null);
    // только прогресс и профиль, без личных ответов и заметок (приватность)
    const [pr, gr, ad] = await Promise.all([
      sb.from("profiles").select("id,name,email"),
      sb.from("progress").select("user_id,completed,completed_at"),
      sb.from("admins").select("email"),
    ]);
    if (pr.error || gr.error) {
      const e = pr.error || gr.error;
      setRows([]);
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
    setRows(list);
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
function Admin({ days, setDays, onReload }) {
  const upd = (di, fn) => setDays(days.map((d, i) => (i === di ? fn({ ...d }) : d)));
  const addDay = () => setDays([...days, {
    id: (days.length ? days[days.length - 1].id : 0) + 1, title: "Новый день", lesson: "Текст урока.", duration: 420, audioName: "", note: "",
    tasks: [{ id: "new-" + Date.now(), text: "Новое задание", done: false, answer: "" }],
  }]);

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
      <div className="block-sub muted" style={{ marginTop: -8, marginBottom: 14 }}>Меняй названия, тексты уроков, аудио и задания. Сохранение правок в базу подключим позже, пока изменения видны до перезагрузки.</div>
      <div className="adm-actions">
        <button className="btn btn-primary btn-sm" onClick={addDay}>+ Добавить день</button>
        <button className="btn btn-ghost btn-sm" onClick={onReload}>Обновить из базы</button>
      </div>

      <div className="adm-list">
        {days.map((d, di) => (
          <div key={d.id} className="card adm-day">
            <div className="head">
              <div className="n">{d.id}</div>
              <input className="adm-input" value={d.title} onChange={(e) => upd(di, (x) => ({ ...x, title: e.target.value }))} />
            </div>

            <div className="adm-label">Текст урока</div>
            <textarea className="adm-input" value={d.lesson} onChange={(e) => upd(di, (x) => ({ ...x, lesson: e.target.value }))} />

            <div className="adm-label">Аудио урока</div>
            <div className="uploader">
              <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer" }}>
                <Ico.upload /> Загрузить аудио
                <input type="file" accept="audio/*" style={{ display: "none" }}
                  onChange={(e) => { const f = e.target.files[0]; if (f) upd(di, (x) => ({ ...x, audioName: f.name })); }} />
              </label>
              <span className={"file-name" + (d.audioName ? "" : " empty")}>{d.audioName || "файл не выбран"}</span>
            </div>

            <div className="adm-label">Задания</div>
            {d.tasks.map((t, ti) => (
              <div key={t.id} className="adm-task">
                <input className="adm-input" value={t.text}
                  onChange={(e) => upd(di, (x) => ({ ...x, tasks: x.tasks.map((tt, j) => (j === ti ? { ...tt, text: e.target.value } : tt)) }))} />
                <button className="icon-btn" title="Удалить"
                  onClick={() => upd(di, (x) => ({ ...x, tasks: x.tasks.filter((_, j) => j !== ti) }))}>×</button>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm adm-add"
              onClick={() => upd(di, (x) => ({ ...x, tasks: [...x.tasks, { id: Date.now(), text: "Новое задание", done: false, answer: "" }] }))}>
              + Задание
            </button>
          </div>
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
    sb.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s || null));
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

  let content;
  if (openDay !== null) {
    content = <DayScreen day={days[openDay]} dayIndex={openDay} total={days.length} onBack={() => setOpenDay(null)}
      onAnswer={(tid, v) => onAnswer(openDay, tid, v)}
      onAnswerBlur={(tid) => onAnswerBlur(openDay, tid)}
      onConfirm={(tid) => onConfirm(openDay, tid)}
      onEdit={(tid) => onEdit(openDay, tid)}
      onNote={(v) => onNote(openDay, v)} />;
  } else if (tab === "dashboard") {
    content = <Dashboard days={days} currentIndex={currentIndex} unlockedCount={unlockedCount} onOpenDay={(i) => setOpenDay(i)} onGoDiary={() => goTab("diary")} userName={(profile && profile.name && profile.name.trim()) || ""} />;
  } else if (tab === "map") {
    content = <DayMap days={days} currentIndex={currentIndex} unlockedCount={unlockedCount} onOpenDay={(i) => setOpenDay(i)} />;
  } else if (tab === "diary") {
    content = <Diary days={days} onOpenDay={(i) => setOpenDay(i)} />;
  } else if (tab === "stats" && isAdmin) {
    content = <StatsSection totalDays={days.length} />;
  } else if (tab === "admin" && isAdmin) {
    content = <Admin days={days} setDays={setDays} onReload={reload} />;
  } else {
    content = <Dashboard days={days} currentIndex={currentIndex} unlockedCount={unlockedCount} onOpenDay={(i) => setOpenDay(i)} onGoDiary={() => goTab("diary")} userName={(profile && profile.name && profile.name.trim()) || ""} />;
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
