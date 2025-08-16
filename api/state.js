import { createClient } from "@supabase/supabase-js";

const table = "tourney_state";
const ROW_ID = 1;

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (req.method === "GET") return res.status(200).json(null);
    return res
      .status(400)
      .json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE (or ANON) env vars." });
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });

  if (req.method === "GET") {
    const { data, error } = await sb
      .from(table)
      .select("payload, rev")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (error) return res.status(500).json({ error: String(error.message) });
    return res.json(data ?? { payload: null, rev: 0 });
  }

  if (req.method === "POST") {
    const { payload, rev } = req.body ?? {};
    if (typeof rev !== "number" || payload === undefined) {
      return res.status(400).json({ error: "POST body must include { payload, rev }" });
    }

// Update onl
