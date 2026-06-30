// Edge Function: письмо при регистрации в «Протоколе денег».
// Подтверждение почты НЕ требуется, это просто уведомление о доступе.
// Безопасно: шлём только залогиненному пользователю и только на ЕГО почту (берём из токена).
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supa.auth.getUser();
    if (!user || !user.email) {
      return new Response(JSON.stringify({ error: "not_authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const body = await req.json().catch(() => ({}));
    const rawName = (body?.name ?? user.user_metadata?.name ?? "").toString().trim();
    const name = rawName ? rawName.split(/\s+/)[0] : "";
    const email = user.email;
    const sender = Deno.env.get("GMAIL_SENDER")!;
    const pass = Deno.env.get("GMAIL_APP_PASSWORD")!;

    const greet = name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
    const text =
`${greet}

Доступ к программе «Протокол денег» открыт. Заходить можно с телефона или с компьютера.

Ваш вход:
- Ссылка: https://thebodymindcode.github.io/moneyprogram
- Логин: ${email}
- Пароль: тот, что вы придумали при регистрации (сохраните его, чтобы потом войти)

Старт 1 июля. Первый урок откроется в 5:00 по Москве, дальше каждый день новый.
Если что-то со входом, напишите в поддержку: @TheBodyMindCode_support

До встречи на первом уроке.`;

    const html =
`<!doctype html><html><body style="margin:0;background:#eef2f6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0d1622">
<div style="max-width:520px;margin:0 auto;padding:28px 20px">
  <div style="background:#fff;border:1px solid #e7ebf1;border-radius:18px;padding:28px 26px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div style="width:38px;height:38px;border-radius:11px;background:#1d2733;color:#fff;font-weight:800;font-size:20px;text-align:center;line-height:38px">&#8381;</div>
      <div style="font-weight:800;font-size:15px">Протокол денег</div>
    </div>
    <div style="font-size:18px;font-weight:800;margin-bottom:10px">${greet}</div>
    <p style="font-size:15px;line-height:1.6;color:#46535f;margin:0 0 16px">Доступ к программе «Протокол денег» открыт. Заходить можно с телефона или с компьютера.</p>
    <div style="background:#f7f9fc;border:1px solid #e7ebf1;border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.7;color:#0d1622">
      <div><b>Ссылка:</b> <a href="https://thebodymindcode.github.io/moneyprogram" style="color:#0a59bf">thebodymindcode.github.io/moneyprogram</a></div>
      <div><b>Логин:</b> ${email}</div>
      <div><b>Пароль:</b> тот, что вы придумали при регистрации</div>
    </div>
    <p style="font-size:14.5px;line-height:1.6;color:#46535f;margin:16px 0 0">Старт 1 июля. Первый урок откроется в 5:00 по Москве, дальше каждый день новый.</p>
    <p style="font-size:14.5px;line-height:1.6;color:#46535f;margin:10px 0 0">Если что-то со входом, напишите в поддержку: <b>@TheBodyMindCode_support</b></p>
    <p style="font-size:15px;font-weight:700;margin:18px 0 0">До встречи на первом уроке.</p>
  </div>
</div></body></html>`;

    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: sender, password: pass } },
    });
    await client.send({
      from: `Протокол денег <${sender}>`,
      to: email,
      subject: "Вы зарегистрировались в «Протоколе денег»",
      content: text,
      html,
    });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
