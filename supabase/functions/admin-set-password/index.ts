// Edge Function: админ выдаёт/сбрасывает пароль участнику.
// Безопасно: вызвать может ТОЛЬКО админ (проверяем по его токену через is_admin).
// Если аккаунта нет, создаём его сразу с готовым паролем. Почту добавляем в список доступа.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

// пароль без похожих символов (0/O, 1/l), легко вписать: 1 заглавная + 1 цифра + ещё 8
function genPwd(): string {
  const low = "abcdefghjkmnpqrstuvwxyz", up = "ABCDEFGHJKMNPQRSTUVWXYZ", dig = "23456789";
  const all = low + up + dig;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let p = pick(up) + pick(dig);
  for (let i = 0; i < 8; i++) p += pick(all);
  return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);
    const { data: isAdmin } = await userClient.rpc("is_admin");
    if (!isAdmin) return json({ error: "not_admin" }, 403);

    const body = await req.json().catch(() => ({}));
    const email = (body?.email ?? "").toString().trim().toLowerCase();
    if (!email || !email.includes("@")) return json({ error: "bad_email" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
    await admin.from("allowed_emails").upsert({ email }, { onConflict: "email", ignoreDuplicates: true });

    const pwd = genPwd();
    const { data: uid } = await admin.rpc("auth_user_id_by_email", { p_email: email });
    if (uid) {
      const { error } = await admin.auth.admin.updateUserById(uid as string, { password: pwd, email_confirm: true });
      if (error) throw error;
      return json({ email, password: pwd, created: false });
    } else {
      const { error } = await admin.auth.admin.createUser({ email, password: pwd, email_confirm: true });
      if (error) throw error;
      return json({ email, password: pwd, created: true });
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
