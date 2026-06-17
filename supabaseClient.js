/* Единый клиент Supabase для всего приложения.
   window.supabase приходит из CDN-сборки supabase-js (подключена в index.html).
   Ключи берутся из config.js (window.SUPABASE_URL / window.SUPABASE_ANON_KEY). */
(function () {
  if (!window.supabase || !window.supabase.createClient) {
    console.error("supabase-js не загрузился. Проверь подключение скрипта в index.html.");
    return;
  }
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.error("Нет ключей Supabase. Создай config.js из config.example.js.");
    return;
  }
  window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,      // сессия хранится между перезагрузками
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
})();
