// public/app.jsx
const { useState, useEffect, useMemo, useRef } = React;

const DEFAULT_SETTINGS = { method: "PAIRWISE", k: 32, theme: "light" };
const STORAGE_KEY = "tourney-state-v1";
const uid = () => Math.random().toString(36).slice(2, 10);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const expScore = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
const PALETTE = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
  "#393b79",
  "#637939",
  "#8c6d31",
  "#843c39",
  "#7b4173",
];
const colorFor = (id) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

// ---------- Cloud persistence with optimistic concurrency ----------
async function cloudGet() {
  try {
    const r = await fetch("/api/state");
    if (!r.ok) return { payload: null, rev: 0 };
    const data = await r.json();
    // Expected shape: { payload, rev }
    return typeof data?.rev === "number" ? data : { payload: null, rev: 0 };
  } catch {
    return { payload: null, rev: 0 };
  }
}
async function cloudPost(payload, rev) {
  try {
    const r = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, rev }),
    });
    if (r.status === 409) {
      const j = await r.json(); // { conflict:true, latest:{payload,rev} }
      return { conflict: true, latest: j.latest };
    }
    if (!r.ok) {
      return { ok: false, error: await r.text() };
    }
    const j = await r.json(); // { ok:true, rev }
    return { ok: true, rev: j.rev };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---------- Minimal canvas line chart ----------
function LineChartCanvas({ series, domain }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const W = (c.width = c.clientWidth * devicePixelRatio);
    const H = (c.height = c.clientHeight * devicePixelRatio);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, W, H);

    const left = 50,
      top = 10,
      right = W / devicePixelRatio - 20,
      bottom = H / devicePixelRatio - 30;

    // Axes
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left - 10, top);
    ctx.lineTo(left - 10, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    const n = Math.max(0, ...series.map((s) => s.values.length));
    const [ymin, ymax] = domain;
    const x = (i) => left + ((right - left) * i) / Math.max(1, n - 1);
    const y = (v) =>
      bottom - ((bottom - top) * (v - ymin)) / Math.max(1, ymax - ymin);

    // Grid
    ctx.strokeStyle = "#f1f5f9";
    for (let g = 0; g < 5; g++) {
      const yy = top + ((bottom - top) * g) / 4;
      ctx.beginPath();
      ctx.moveTo(left - 10, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
    }

    // Lines
    series.forEach((s) => {
      if (s.values.length === 0) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x(0), y(s.values[0]));
      for (let i = 1; i < s.values.length; i++) ctx.lineTo(x(i), y(s.values[i]));
      ctx.stroke();
    });

    // Legend
    let lx = left,
      ly = 14;
    series.slice(0, 8).forEach((s) => {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, ly - 8, 12, 4);
      ctx.fillStyle = "#475569";
      ctx.fillText(" " + s.name, lx + 14, ly);
      lx += ctx.measureText(" " + s.name).width + 60;
    });
  }, [series, domain]);
  return <canvas ref={ref} style={{ width: "100%", height: 320 }} />;
}

// ---------- App ----------
function App() {
  const [roster, setRoster] = useState({});
  const [matches, setMatches] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [tab, setTab] = useState("players");
  const [yMode, setYMode] = useState("tight");
  const [yMin, setYMin] = useState(900),
    [yMax, setYMax] = useState(1200);
  const [selected, setSelected] = useState([]);
  const cloudRevRef = useRef(0); // tracks current server revision
  const [syncState, setSyncState] = useState("idle"); // idle | saving | conflict | error

  // Load from cloud (or localStorage fallback)
  useEffect(() => {
    (async () => {
      // 1) Try cloud
      const { payload, rev } = await cloudGet();
      if (payload) {
        cloudRevRef.current = rev ?? 0;
        setRoster(payload.players || {});
        setMatches(payload.matches || []);
        setSettings(payload.settings || DEFAULT_SETTINGS);
        return;
      }
      // 2) Fallback to localStorage
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          setRoster(s.players || {});
          setMatches(s.matches || []);
          setSettings(s.settings || DEFAULT_SETTINGS);
        }
      } catch { }
    })();
  }, []);

  // Derived ratings
  const [players, setPlayers] = useState({});
  useEffect(() => {
    const d = {};
    Object.values(roster).forEach(
      (p) => (d[p.id] = { id: p.id, name: p.name, rating: 1000, history: [1000] })
    );
    matches.forEach((m) => {
      m.teams.forEach((t) =>
        t.members.forEach((id) => {
          if (!d[id])
            d[id] = {
              id,
              name: roster[id]?.name || "P-" + id.slice(0, 4),
              rating: 1000,
              history: [1000],
            };
        })
      );
      const dd = computeDeltas(d, m, settings);
      Object.values(d).forEach((p) => {
        const inc = dd[p.id] ?? 0;
        const nr = clamp(p.rating + inc, 0, 4000);
        p.rating = nr;
        p.history = [...p.history, nr];
      });
    });
    const L = Math.max(1, ...Object.values(d).map((p) => p.history.length));
    Object.values(d).forEach((p) => {
      while (p.history.length < L) p.history.push(p.history[p.history.length - 1]);
    });
    setPlayers(d);
  }, [roster, matches, settings]);

  // Save to both localStorage and cloud (optimistic + conflict handling)
  useEffect(() => {
    const payload = { players: roster, matches, settings };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { }

    (async () => {
      setSyncState("saving");
      const res = await cloudPost(payload, cloudRevRef.current);
      if (res?.conflict) {
        setSyncState("conflict");
        // Basic strategy: accept server truth, then reapply local change manually if needed
        const latest = res.latest || { payload: null, rev: cloudRevRef.current };
        if (latest.payload) {
          cloudRevRef.current = latest.rev ?? cloudRevRef.current;
          setRoster(latest.payload.players || {});
          setMatches(latest.payload.matches || []);
          setSettings(latest.payload.settings || DEFAULT_SETTINGS);
        }
        // You can show a toast here or add a "Retry save" button if desired.
        return;
      }
      if (res?.ok) {
        cloudRevRef.current = res.rev ?? cloudRevRef.current + 1;
        setSyncState("idle");
      } else if (res?.error) {
        setSyncState("error");
        // silent fail → clients still have localStorage
      } else {
        setSyncState("idle");
      }
    })();
  }, [roster, matches, settings]);

  const leaderboard = useMemo(
    () =>
      Object.values(players)
        .sort((a, b) => b.rating - a.rating)
        .map((p, i) => ({ ...p, rank: i + 1 })),
    [players]
  );

  const list = Object.values(players).sort((a, b) => b.rating - a.rating);
  useEffect(() => {
    if (selected.length === 0)
      setSelected(list.slice(0, Math.min(5, list.length)).map((p) => p.id));
  }, [matches.length]);

  const series = list
    .filter((p) => selected.includes(p.id))
    .map((p) => ({ name: p.name, color: colorFor(p.id), values: p.history }));

  const domain = useMemo(() => {
    if (yMode === "manual") return [Math.min(yMin, yMax), Math.max(yMin, yMax)];
    if (yMode === "wide") return [600, 1600];
    const sel = list.filter((p) => selected.includes(p.id));
    let min = Infinity,
      max = -Infinity;
    sel.forEach((p) =>
      p.history.forEach((v) => {
        if (v < min) min = v;
        if (v > max) max = v;
      })
    );
    if (!isFinite(min) || !isFinite(max)) return [800, 1200];
    const pad = Math.max(10, (max - min) * 0.1);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [yMode, yMin, yMax, selected, players]);

  function addPlayer(name) {
    const id = uid();
    setRoster((r) => ({ ...r, [id]: { id, name } }));
  }
  function removePlayer(id) {
    setRoster((r) => {
      const cp = { ...r };
      delete cp[id];
      return cp;
    });
    setMatches((prev) =>
      prev
        .map((m) => ({
          ...m,
          teams: m.teams
            .map((t) => ({ ...t, members: t.members.filter((x) => x !== id) }))
            .filter((t) => t.members.length > 0),
        }))
        .filter((m) => m.teams.length >= 2)
    );
  }

  return (
    <div className="container">
      <div className="header">
        <h1>Tournament Rating App</h1>
        <div style={{ display: "grid", gridAutoFlow: "column", gap: "8px" }}>
          <button
            className="btn"
            title={
              syncState === "saving"
                ? "Saving to cloud…"
                : syncState === "conflict"
                  ? "Conflict detected – refreshed from cloud"
                  : syncState === "error"
                    ? "Cloud save failed (local only)"
                    : "Saved"
            }
          >
            {syncState === "saving"
              ? "Saving…"
              : syncState === "conflict"
                ? "Conflict – reloaded"
                : syncState === "error"
                  ? "Cloud error"
                  : "Saved"}
          </button>
          <button
            className="btn danger"
            onClick={() => {
              if (confirm("Reset all players and matches?")) {
                setRoster({});
                setMatches([]);
                setSettings(DEFAULT_SETTINGS);
                localStorage.removeItem(STORAGE_KEY);
              }
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <Tabs tab={tab} setTab={setTab} />

      {tab === "players" && (
        <div className="card">
          <h2>Players</h2>
          <div className="row" style={{ alignItems: "end" }}>
            <div>
              <div className="muted">Add player</div>
              <input
                className="input"
                placeholder="e.g., Alice"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target.value.trim()) {
                    addPlayer(e.target.value.trim());
                    e.target.value = "";
                  }
                }}
              />
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.values(roster).length === 0 && (
                <tr>
                  <td colSpan="3" className="muted" style={{ textAlign: "center" }}>
                    No players yet.
                  </td>
                </tr>
              )}
              {Object.values(roster)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p, i) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td>
                      <b>{p.name}</b>
                    </td>
                    <td className="text-right">
                      <button className="btn ghost" onClick={() => removePlayer(p.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "new" && (
        <>
          <AddMatch
            roster={roster}
            onAdd={(m) =>
              setMatches((prev) => [
                ...prev,
                { ...m, id: uid(), date: new Date().toISOString() },
              ])
            }
          />
          <Recent matches={matches} />
        </>
      )}

      {tab === "matches" && <MatchTable matches={matches} />}

      {tab === "leaderboard" && (
        <div className="card">
          <h2>Leaderboard</h2>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th className="text-right">Rating</th>
                <th className="text-right">Δ (last)</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((p) => {
                const d =
                  p.history.length >= 2 ? p.history.at(-1) - p.history.at(-2) : 0;
                return (
                  <tr key={p.id}>
                    <td>
                      <b>{p.rank}</b>
                    </td>
                    <td>{p.name}</td>
                    <td className="text-right">{Math.round(p.rating)}</td>
                    <td
                      className="text-right"
                      style={{ color: d >= 0 ? "#059669" : "#dc2626" }}
                    >
                      {d >= 0 ? "+" : ""}
                      {Math.round(d)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "history" && (
        <History
          players={players}
          matches={matches}
          yMode={yMode}
          setYMode={setYMode}
          yMin={yMin}
          setYMin={setYMin}
          yMax={yMax}
          setYMax={setYMax}
          selected={selected}
          setSelected={setSelected}
          series={series}
          domain={domain}
        />
      )}

      {tab === "settings" && (
        <div className="card">
          <h2>Rating Settings</h2>
          <div className="row">
            <div>
              <div className="muted">Method</div>
              <select
                className="input"
                value={settings.method}
                onChange={(e) => setSettings((s) => ({ ...s, method: e.target.value }))}
              >
                <option value="PAIRWISE">Pairwise Elo (Plackett–Luce)</option>
                <option value="FIELD">Field-based Elo (placement vs expected)</option>
              </select>
            </div>
            <div>
              <div className="muted">K-factor</div>
              <input
                className="input"
                type="number"
                min="1"
                max="128"
                value={settings.k}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    k: Math.max(1, Math.min(128, Math.round(Number(e.target.value) || 32))),
                  }))
                }
              />
            </div>
          </div>
          <p className="muted">
            Changing method or K recalculates all past matches (replay from start).
          </p>
        </div>
      )}
    </div>
  );
}

// --- small helpers/components below (unchanged behavior) ---

function Tabs({ tab, setTab }) {
  return (
    <div className="tabs">
      {["players", "new", "matches", "leaderboard", "history", "settings"].map(
        (v) => (
          <button
            key={v}
            className={`tab ${v === tab ? "active" : ""}`}
            onClick={() => setTab(v)}
          >
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        )
      )}
    </div>
  );
}

function Recent({ matches }) {
  const recent = [...matches]
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    .slice(0, 10);
  return (
    <div className="card">
      <h3>Recent Matches</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Name</th>
            <th>Mode</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {recent.length === 0 && (
            <tr>
              <td colSpan="4" className="muted" style={{ textAlign: "center" }}>
                No matches yet.
              </td>
            </tr>
          )}
          {recent.map((m) => (
            <tr key={m.id}>
              <td>{new Date(m.date).toLocaleString()}</td>
              <td>{m.name || "—"}</td>
              <td>{m.mode}</td>
              <td>
                {m.teams
                  .sort((a, b) => a.placement - b.placement)
                  .map((t) => (
                    <span key={t.id} className="badge" style={{ marginRight: 6 }}>
                      {(t.name || "Team")} ({t.placement})
                    </span>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchTable({ matches }) {
  return (
    <div className="card">
      <h2>Match History</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Name</th>
            <th>Mode</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => (
            <tr key={m.id}>
              <td>{new Date(m.date).toLocaleString()}</td>
              <td>{m.name || "—"}</td>
              <td>{m.mode}</td>
              <td>
                {m.teams
                  .sort((a, b) => a.placement - b.placement)
                  .map((t) => (
                    <span key={t.id} className="badge" style={{ marginRight: 6 }}>
                      {(t.name || "Team")} ({t.placement})
                    </span>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({
  players,
  yMode,
  setYMode,
  yMin,
  setYMin,
  yMax,
  setYMax,
  selected,
  setSelected,
  series,
  domain,
}) {
  return (
    <div className="card">
      <h2>Rating History</h2>
      <div className="row">
        <div>
          <div className="muted">Y-axis</div>
          <select className="input" value={yMode} onChange={(e) => setYMode(e.target.value)}>
            <option value="tight">Tight (selected)</option>
            <option value="wide">Wide (600–1600)</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        {yMode === "manual" && (
          <>
            <div>
              <div className="muted">Min</div>
              <input
                className="input"
                type="number"
                value={yMin}
                onChange={(e) => setYMin(Number(e.target.value))}
              />
            </div>
            <div>
              <div className="muted">Max</div>
              <input
                className="input"
                type="number"
                value={yMax}
                onChange={(e) => setYMax(Number(e.target.value))}
              />
            </div>
          </>
        )}
        <div style={{ gridColumn: "1/-1" }}>
          <div className="muted">Players</div>
          <div
            style={{
              maxHeight: 200,
              overflow: "auto",
              border: "1px solid var(--line)",
              borderRadius: 12,
            }}
          >
            {Object.values(players).map((p) => (
              <label
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 8,
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={() =>
                    setSelected((prev) =>
                      prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div style={{ height: 320 }}>
        <LineChartCanvas series={series} domain={domain} />
      </div>
    </div>
  );
}

function computeDeltas(players, match, settings) {
  const teamR = {};
  match.teams.forEach(
    (t) => (teamR[t.id] = avg(t.members.map((id) => players[id]?.rating ?? 1000)))
  );
  const ord = [...match.teams].sort((a, b) => a.placement - b.placement);
  const n = ord.length;
  const teamDelta = Object.fromEntries(ord.map((t) => [t.id, 0]));
  if (settings.method === "PAIRWISE") {
    const k = settings.k / Math.max(1, n - 1);
    for (let i = 0; i < ord.length; i++)
      for (let j = i + 1; j < ord.length; j++) {
        const A = ord[i],
          B = ord[j];
        const ea = expScore(teamR[A.id], teamR[B.id]);
        const g = k * (1 - ea);
        teamDelta[A.id] += g;
        teamDelta[B.id] -= g;
      }
  } else {
    const scores = Object.fromEntries(
      ord.map((t) => [t.id, (n - t.placement) / Math.max(1, n - 1)])
    );
    const ex = {};
    ord.forEach((ti) => {
      let s = 0;
      ord.forEach((tj) => {
        if (ti.id !== tj.id) s += expScore(teamR[ti.id], teamR[tj.id]);
      });
      ex[ti.id] = s / Math.max(1, n - 1);
    });
    ord.forEach((t) => {
      const diff = scores[t.id] - ex[t.id];
      teamDelta[t.id] += settings.k * diff;
    });
  }
  const pd = {};
  match.teams.forEach((t) => {
    const per = teamDelta[t.id] / Math.max(1, t.members.length);
    t.members.forEach((id) => (pd[id] = (pd[id] ?? 0) + per));
  });
  return pd;
}

// Mount app
function AppRoot() {
  return <App />;
}
ReactDOM.createRoot(document.getElementById("root")).render(<AppRoot />);
