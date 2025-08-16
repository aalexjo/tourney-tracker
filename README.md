# Tournament Rating App (no-build version)

Features:
- Players, 1v1 / 2v2 / FFA / Custom matches
- Pairwise/Field rating methods + K-factor
- Rating history chart with adjustable Y-axis
- Recent matches inline + full history
- Theme tokens present (light / dark / gradient) — easy to extend
- Persistence:
  - Local/Docker: `data/db.json` via Express API
  - Vercel: `/api/state` serverless + optional Supabase table

## Run locally
```bash
npm install
npm start
# open http://localhost:5174
```

## Run with Docker
```bash
docker compose up --build
# open http://localhost:5174
# data persists in ./data/db.json
```

## Deploy to Vercel (optional Supabase persistence)
1. Push this folder to GitHub, import into Vercel.
2. In Vercel → Settings → Environment Variables, add:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE` (recommended) or `SUPABASE_ANON_KEY`
3. Create table in Supabase:
```sql
create table if not exists public.tourney_state (
  id int primary key,
  payload jsonb not null
);
insert into public.tourney_state (id, payload) values (1, '{}'::jsonb)
  on conflict (id) do nothing;
```
4. Deploy. The client will use `/api/state` when env vars exist; otherwise it falls back to localStorage.

## Note
- Changing method or K recalculates all past matches (replay from the beginning).
