import { createClient } from "@supabase/supabase-js";

const table = "tourney_state";

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (req.method === "GET") return res.status(200).json(null); // client falls back to localStorage
    return res
      .status(400)
      .json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE (or ANON) env vars." });
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  if (req.method === "GET") {
    const { data, error } = await sb
      .from(table)
      .select("payload")
      .eq("id", 1)
      .maybeSingle();
    if (error) return res.status(500).json({ error: String(error.message) });
    return res.json(data?.payload ?? null);
  }

  if (req.method === "POST") {
    const payload = req.body;
    const { error } = await sb.from(table).upsert({ id: 1, payload });
    if (error) return res.status(500).json({ error: String(error.message) });
    return res.json({ ok: true });
  }

  res.status(405).json({ error: "Method not allowed" });
}
