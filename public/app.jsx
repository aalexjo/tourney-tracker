const {useState, useEffect, useMemo, useRef} = React

const DEFAULT_SETTINGS = { method:'PAIRWISE', k:32, theme:'light' }
const STORAGE_KEY = 'tourney-state-v1'
const uid = () => Math.random().toString(36).slice(2,10)
const avg = (a)=> a.length? a.reduce((x,y)=>x+y,0)/a.length : 0
const clamp = (n,min,max)=> Math.max(min, Math.min(max,n))
const expScore = (a,b)=> 1/(1+10**((b-a)/400))
const PALETTE = ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf','#393b79','#637939','#8c6d31','#843c39','#7b4173']
const colorFor = (id)=>{ let h=0; for(let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))>>>0; return PALETTE[h%PALETTE.length] }

async function loadState(){
  try{ const r = await fetch('/api/state'); if(r.ok) return await r.json() }catch{}
  try{ const raw = localStorage.getItem(STORAGE_KEY); return raw? JSON.parse(raw): null }catch{}
  return null
}
async function saveState(state){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  try{ await fetch('/api/state', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(state)}) }catch{}
}

function computeDeltas(players, match, settings){
  const teamR = {}; match.teams.forEach(t=> teamR[t.id] = avg(t.members.map(id => (players[id]?.rating ?? 1000))))
  const ord = [...match.teams].sort((a,b)=>a.placement-b.placement)
  const n = ord.length
  const teamDelta = Object.fromEntries(ord.map(t=>[t.id,0]))
  if (settings.method==='PAIRWISE'){
    const k = settings.k/Math.max(1,n-1)
    for (let i=0;i<ord.length;i++) for (let j=i+1;j<ord.length;j++){
      const A=ord[i], B=ord[j]; const ea=expScore(teamR[A.id], teamR[B.id]); const g=k*(1-ea)
      teamDelta[A.id]+=g; teamDelta[B.id]-=g
    }
  } else {
    const scores = Object.fromEntries(ord.map(t=>[t.id,(n-t.placement)/Math.max(1,n-1)]))
    const ex = {}; ord.forEach(ti=>{ let s=0; ord.forEach(tj=>{ if(ti.id!==tj.id) s+=expScore(teamR[ti.id],teamR[tj.id])}); ex[ti.id]= s/Math.max(1,n-1)})
    ord.forEach(t=>{ const diff = scores[t.id]-ex[t.id]; teamDelta[t.id]+= settings.k*diff })
  }
  const pd = {}; match.teams.forEach(t=>{ const per = teamDelta[t.id]/Math.max(1,t.members.length); t.members.forEach(id=> pd[id]=(pd[id]??0)+per) })
  return pd
}

function LineChartCanvas({ series, domain }){
  const ref = useRef(null)
  useEffect(()=>{
    const c = ref.current; if(!c) return
    const ctx = c.getContext('2d')
    const W = c.width = c.clientWidth * devicePixelRatio
    const H = c.height = c.clientHeight * devicePixelRatio
    ctx.scale(devicePixelRatio, devicePixelRatio)
    ctx.clearRect(0,0,W,H)
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(40,10); ctx.lineTo(40,H/ devicePixelRatio - 30); ctx.lineTo(W/ devicePixelRatio - 10, H/ devicePixelRatio - 30); ctx.stroke()
    const left = 50, right = W/ devicePixelRatio - 20, top = 10, bottom = H/ devicePixelRatio - 30
    const n = Math.max(0, ...series.map(s=>s.values.length))
    const [ymin,ymax] = domain
    function x(i){ return left + (right-left) * (i/(Math.max(1,n-1))) }
    function y(v){ return bottom - (bottom-top) * ((v - ymin) / Math.max(1, ymax - ymin)) }
    ctx.strokeStyle='#f1f5f9'
    for(let g=0; g<5; g++){ const yy = top + (bottom-top)*g/4; ctx.beginPath(); ctx.moveTo(left,yy); ctx.lineTo(right,yy); ctx.stroke() }
    series.forEach(s=>{
      if(s.values.length===0) return
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath()
      ctx.moveTo(x(0), y(s.values[0]))
      for(let i=1;i<s.values.length;i++){ ctx.lineTo(x(i), y(s.values[i])) }
      ctx.stroke()
    })
    let lx = left, ly = 12
    series.slice(0,8).forEach(s=>{ ctx.fillStyle = s.color; ctx.fillRect(lx, ly-8, 12, 4); ctx.fillStyle = '#64748b'; ctx.fillText(' '+s.name, lx+14, ly); lx += ctx.measureText(' '+s.name).width + 60 })
  }, [series, domain])
  return <canvas ref={ref}></canvas>
}

function App(){
  const [roster,setRoster] = useState({})
  const [matches,setMatches] = useState([])
  const [settings,setSettings] = useState(DEFAULT_SETTINGS)
  const [players,setPlayers] = useState({})
  const [tab,setTab] = useState('players')
  const [yMode,setYMode] = useState('tight')
  const [yMin,setYMin] = useState(900), [yMax,setYMax] = useState(1200)
  const [selected,setSelected] = useState([])

  useEffect(()=>{ (async()=>{ const st = await loadState(); if(st){ setRoster(st.players||{}); setMatches(st.matches||[]); setSettings(st.settings||DEFAULT_SETTINGS) } })() },[])

  useEffect(()=>{
    const d = {}
    Object.values(roster).forEach(p=> d[p.id]={ id:p.id, name:p.name, rating:1000, history:[1000]})
    matches.forEach(m=>{
      m.teams.forEach(t=>t.members.forEach(id=>{ if(!d[id]) d[id]={ id, name: roster[id]?.name||('P-'+id.slice(0,4)), rating:1000, history:[1000]} }))
      const dd = computeDeltas(d,m,settings)
      Object.values(d).forEach(p=>{ const inc = dd[p.id]??0; const nr=clamp(p.rating+inc,0,4000); p.rating=nr; p.history=[...p.history,nr] })
    })
    const L = Math.max(1, ...Object.values(d).map(p=>p.history.length)); Object.values(d).forEach(p=>{ while(p.history.length<L) p.history.push(p.history[p.history.length-1]) })
    setPlayers(d)
  }, [roster,matches,settings])

  useEffect(()=>{ saveState({ players: roster, matches, settings }) }, [roster,matches,settings])

  const leaderboard = useMemo(()=> Object.values(players).sort((a,b)=>b.rating-a.rating).map((p,i)=>({...p, rank:i+1})), [players])

  const list = Object.values(players).sort((a,b)=>b.rating-a.rating)
  useEffect(()=>{ if(selected.length===0) setSelected(list.slice(0, Math.min(5,list.length)).map(p=>p.id)) }, [matches.length])
  const series = list.filter(p=>selected.includes(p.id)).map(p=>({ name:p.name, color:colorFor(p.id), values:p.history }))
  const domain = useMemo(()=>{
    if (yMode==='manual') return [Math.min(yMin,yMax), Math.max(yMin,yMax)]
    if (yMode==='wide') return [600,1600]
    const sel = list.filter(p=> selected.includes(p.id))
    let min=Infinity, max=-Infinity; sel.forEach(p=>p.history.forEach(v=>{ if(v<min)min=v; if(v>max)max=v }))
    if (!isFinite(min)||!isFinite(max)) return [800, 1200]
    const pad = Math.max(10,(max-min)*0.1); return [Math.floor(min-pad), Math.ceil(max+pad)]
  }, [yMode,yMin,yMax,selected,players])

  function addPlayer(name){ const id=uid(); setRoster(r=>({...r,[id]:{id,name}})) }
  function removePlayer(id){
    setRoster(r=>{ const cp={...r}; delete cp[id]; return cp })
    setMatches(prev => prev.map(m=>({...m,teams:m.teams.map(t=>({...t,members:t.members.filter(x=>x!==id)})).filter(t=>t.members.length>0)})).filter(m=>m.teams.length>=2))
  }

  return <div className="container">
    <div className="header">
      <h1>Tournament Rating App</h1>
      <div style={{display:'grid',gridAutoFlow:'column',gap:'8px'}}>
        <button className="btn" onClick={()=>saveState({ players: roster, matches, settings })}>Save</button>
        <button className="btn danger" onClick={()=>{ if(confirm('Reset all players and matches?')){ setRoster({}); setMatches([]); setSettings(DEFAULT_SETTINGS); localStorage.removeItem(STORAGE_KEY) }}}>Reset</button>
      </div>
    </div>

    <div className="tabs">{['players','new','matches','leaderboard','history','settings','theme'].map(v=>
      <button key={v} className={`tab ${v===tab?'active':''}`} onClick={()=>setTab(v)}>{v[0].toUpperCase()+v.slice(1)}</button>
    )}</div>

    {tab==='players' && <div className="card">
      <h2>Players</h2>
      <div className="row" style={{alignItems:'end'}}>
        <div>
          <div className="muted">Add player</div>
          <input className="input" placeholder="e.g., Alice" onKeyDown={(e)=>{ if(e.key==='Enter'&&e.target.value.trim()){ addPlayer(e.target.value.trim()); e.target.value='' } }}/>
        </div>
      </div>
      <table><thead><tr><th>#</th><th>Name</th><th/></tr></thead>
        <tbody>
          {Object.values(roster).length===0 && <tr><td colSpan="3" className="muted" style={{textAlign:'center'}}>No players yet.</td></tr>}
          {Object.values(roster).sort((a,b)=>a.name.localeCompare(b.name)).map((p,i)=>(<tr key={p.id}><td>{i+1}</td><td><b>{p.name}</b></td><td className="text-right"><button className="btn ghost" onClick={()=>removePlayer(p.id)}>Remove</button></td></tr>))}
        </tbody>
      </table>
    </div>}

    {tab==='new' && <>
      <AddMatch roster={roster} onAdd={(m)=> setMatches(prev=>[...prev,{...m, id:uid(), date:new Date().toISOString()}]) }/>
      <Recent matches={matches} />
    </>}

    {tab==='matches' && <MatchTable matches={matches} />}

    {tab==='leaderboard' && <div className="card">
      <h2>Leaderboard</h2>
      <table><thead><tr><th>Rank</th><th>Player</th><th className="text-right">Rating</th><th className="text-right">Δ (last)</th></tr></thead>
        <tbody>{leaderboard.map(p=>{ const d=p.history.length>=2? p.history.at(-1)-p.history.at(-2):0; return <tr key={p.id}><td><b>{p.rank}</b></td><td>{p.name}</td><td className="text-right">{Math.round(p.rating)}</td><td className="text-right" style={{color:d>=0?'#059669':'#dc2626'}}>{d>=0?'+':''}{Math.round(d)}</td></tr>})}</tbody></table>
    </div>}

    {tab==='history' && <div className="card">
      <h2>Rating History</h2>
      <div className="row">
        <div>
          <div className="muted">Y-axis</div>
          <select className="input" value={yMode} onChange={e=>setYMode(e.target.value)}>
            <option value="tight">Tight (selected)</option><option value="wide">Wide (600–1600)</option><option value="manual">Manual</option>
          </select>
        </div>
        {yMode==='manual' && <>
          <div><div className="muted">Min</div><input className="input" type="number" value={yMin} onChange={e=>setYMin(Number(e.target.value))}/></div>
          <div><div className="muted">Max</div><input className="input" type="number" value={yMax} onChange={e=>setYMax(Number(e.target.value))}/></div>
        </>}
        <div style={{gridColumn:'1/-1'}}>
          <div className="muted">Players</div>
          <div style={{maxHeight:200, overflow:'auto', border:'1px solid var(--line)', borderRadius:12}}>
            {Object.values(players).map(p=> <label key={p.id} style={{display:'flex',alignItems:'center',gap:8,padding:8,borderBottom:'1px solid var(--line)'}}><input type="checkbox" checked={selected.includes(p.id)} onChange={()=> setSelected(prev=> prev.includes(p.id)? prev.filter(x=>x!==p.id): [...prev,p.id]) }/>{p.name}</label>)}
          </div>
        </div>
      </div>
      <div style={{height:320}}>
        <LineChartCanvas series={series} domain={domain}/>
      </div>
    </div>}

    {tab==='settings' && <div className="card">
      <h2>Rating Settings</h2>
      <div className="row">
        <div><div className="muted">Method</div>
          <select className="input" value={settings.method} onChange={e=>setSettings(s=>({...s, method:e.target.value}))}>
            <option value="PAIRWISE">Pairwise Elo (Plackett–Luce)</option>
            <option value="FIELD">Field-based Elo (placement vs expected)</option>
          </select>
        </div>
        <div><div className="muted">K-factor</div><input className="input" type="number" min="1" max="128" value={settings.k} onChange={e=> setSettings(s=>({...s, k: Math.max(1, Math.min(128, Math.round(Number(e.target.value)||32))) })) }/></div>
      </div>
      <p className="muted">Changing method or K recalculates all past matches.</p>
    </div>}
  </div>
}

function Recent({matches}){
  const recent = [...matches].sort((a,b)=> +new Date(b.date) - +new Date(a.date)).slice(0,10)
  return <div className="card">
    <h3>Recent Matches</h3>
    <table><thead><tr><th>Date</th><th>Name</th><th>Mode</th><th>Result</th></tr></thead>
      <tbody>
        {recent.length===0 && <tr><td colSpan="4" className="muted" style={{textAlign:'center'}}>No matches yet.</td></tr>}
        {recent.map(m=>(<tr key={m.id}><td>{new Date(m.date).toLocaleString()}</td><td>{m.name||'—'}</td><td>{m.mode}</td><td>{m.teams.sort((a,b)=>a.placement-b.placement).map(t=><span key={t.id} className="badge" style={{marginRight:6}}>{(t.name||'Team')} ({t.placement})</span>)}</td></tr>))}
      </tbody></table>
  </div>
}

function MatchTable({matches}){
  return <div className="card">
    <h2>Match History</h2>
    <table><thead><tr><th>Date</th><th>Name</th><th>Mode</th><th>Result</th></tr></thead>
      <tbody>{matches.map(m=>(<tr key={m.id}><td>{new Date(m.date).toLocaleString()}</td><td>{m.name||'—'}</td><td>{m.mode}</td><td>{m.teams.sort((a,b)=>a.placement-b.placement).map(t=><span key={t.id} className="badge" style={{marginRight:6}}>{(t.name||'Team')} ({t.placement})</span>)}</td></tr>))}</tbody>
    </table>
  </div>
}

function MultiSelect({ options, value, onChange, limit, exclude }){
  const chosen = new Set(value||[]); const excl = new Set(exclude||[]); const opts = options.filter(o=>!excl.has(o.value))
  function toggle(v){ const n=new Set(value||[]); if(n.has(v)) n.delete(v); else { if(limit && n.size>=limit) return; n.add(v) } onChange(Array.from(n)) }
  return <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))'}}>
    {opts.map(o=> <button key={o.value} type="button" onClick={()=>toggle(o.value)} className="btn" style={{textAlign:'left', background: chosen.has(o.value)? 'rgba(37,99,235,0.1)' : ''}}>{o.label}</button>)}
  </div>
}

function AddMatch({ roster, onAdd }){
  const [mode,setMode] = React.useState('1v1')
  const [name,setName] = React.useState('')
  const players = Object.values(roster)
  const [p1,setP1]=React.useState(''), [p2,setP2]=React.useState(''), [p1wins,setP1wins]=React.useState(true)
  const [tA,setTA]=React.useState([]), [tB,setTB]=React.useState([]), [teamAFirst,setTeamAFirst]=React.useState(true)
  const [ffaSel,setFfaSel]=React.useState([]), [ffaPl,setFfaPl]=React.useState({})
  const [custom,setCustom]=React.useState([{id:uid(),name:'Team 1',members:[],placement:1},{id:uid(),name:'Team 2',members:[],placement:2}])

  function submit(){
    let teams=[]
    if (mode==='1v1'){ if(!p1||!p2||p1===p2) return alert('Pick two different players'); teams=[{id:uid(),name:'A',members:[p1],placement:p1wins?1:2},{id:uid(),name:'B',members:[p2],placement:p1wins?2:1}] }
    else if (mode==='2v2'){ if(tA.length!==2||tB.length!==2) return alert('2 players per team'); if(new Set([...tA,...tB]).size!==4) return alert('Players must be unique'); const a=teamAFirst?1:2, b=teamAFirst?2:1; teams=[{id:uid(),name:'Team A',members:tA,placement:a},{id:uid(),name:'Team B',members:tB,placement:b}] }
    else if (mode==='FFA'){ if(ffaSel.length<2) return alert('Pick at least two players'); const N=ffaSel.length; const placements=ffaSel.map(id=>ffaPl[id]); const uniq=new Set(placements); if(placements.some(p=>!p||p<1||p>N)||uniq.size!==N) return alert('Unique placement 1..N each'); teams=ffaSel.map(id=>({id:uid(),name:roster[id]?.name||'',members:[id],placement:ffaPl[id]})).sort((a,b)=>a.placement-b.placement) }
    else { const used=new Set(); for(const t of custom){ for(const m of t.members){ if(used.has(m)) return alert('A player can only appear in one team'); used.add(m) } } const nonEmpty=custom.filter(t=>t.members.length>0); if(nonEmpty.length<2) return alert('At least two teams'); const N=nonEmpty.length; const placements=nonEmpty.map(t=>t.placement); const uniq=new Set(placements); if(placements.some(p=>!p||p<1||p>N)||uniq.size!==N) return alert('Placements must be unique 1..N'); teams=[...nonEmpty].sort((a,b)=>a.placement-b.placement) }
    onAdd({ name: name.trim()||undefined, mode, teams }); setName('')
  }

  return <div className="card">
    <h2>Add Match</h2>
    <div className="row">
      <div><div className="muted">Match name (optional)</div><input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g., Semi-final 2"/></div>
      <div><div className="muted">Mode</div>
        <select className="input" value={mode} onChange={e=>setMode(e.target.value)}>
          <option value="1v1">1v1</option><option value="2v2">2v2</option><option value="FFA">Free-for-all</option><option value="CUSTOM">Custom</option>
        </select>
      </div>
    </div>

    {mode==='1v1' && <div className="row">
      <div><div className="muted">Player A</div><select className="input" value={p1} onChange={e=>setP1(e.target.value)}>{['',...players.map(p=>p.id)].map(id=><option key={id} value={id}>{id?roster[id].name:'-- choose --'}</option>)}</select></div>
      <div><div className="muted">Player B</div><select className="input" value={p2} onChange={e=>setP2(e.target.value)}>{['',...players.filter(p=>p.id!==p1).map(p=>p.id)].map(id=><option key={id} value={id}>{id?roster[id].name:'-- choose --'}</option>)}</select></div>
      <div style={{gridColumn:'1/-1'}}><label><input type="checkbox" checked={p1wins} onChange={e=>setP1wins(e.target.checked)}/> Player A wins</label></div>
    </div>}

    {mode==='2v2' && <div className="row">
      <div><div className="muted">Team A (2)</div><MultiSelect options={players.map(p=>({value:p.id,label:p.name}))} value={tA} onChange={setTA} limit={2} exclude={tB}/></div>
      <div><div className="muted">Team B (2)</div><MultiSelect options={players.map(p=>({value:p.id,label:p.name}))} value={tB} onChange={setTB} limit={2} exclude={tA}/></div>
      <div style={{gridColumn:'1/-1'}}><div className="muted">Result</div><select className="input" value={teamAFirst?'1':'2'} onChange={e=>setTeamAFirst(e.target.value==='1')}><option value="1">Team A wins</option><option value="2">Team B wins</option></select></div>
    </div>}

    {mode==='FFA' && <div className="grid">
      <div><div className="muted">Select players</div><MultiSelect options={players.map(p=>({value:p.id,label:p.name}))} value={ffaSel} onChange={(v)=>{ setFfaSel(v); setFfaPl(prev=>{ const n={}; v.forEach(id=>{ if(prev[id]) n[id]=prev[id] }); return n }) }}/></div>
      {ffaSel.length>0 && <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))'}}>
        {ffaSel.map(id=>(<div key={id} className="card" style={{display:'flex',alignItems:'center',gap:8}}><span className="badge" style={{minWidth:96,textAlign:'center'}}>{roster[id].name}</span><input className="input" type="number" min={1} max={ffaSel.length} value={ffaPl[id]??''} onChange={e=>setFfaPl({...ffaPl,[id]:Number(e.target.value)})}/></div>))}
      </div>}
    </div>}

    {mode==='CUSTOM' && <div className="grid">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div className="muted">Teams & Placements</div><button className="btn" onClick={()=>setCustom(c=>[...c,{id:uid(),name:`Team ${c.length+1}`,members:[],placement:c.length+1}])}>Add Team</button></div>
      <div className="grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))'}}>
        {custom.map(t=>(<div key={t.id} className="card">
          <div style={{display:'flex',gap:8}}><input className="input" value={t.name} onChange={e=>setCustom(all=>all.map(x=>x.id===t.id?{...x,name:e.target.value}:x))}/><button className="btn ghost" onClick={()=>setCustom(all=>all.filter(x=>x.id!==t.id))}>✕</button></div>
          <MultiSelect options={players.map(p=>({value:p.id,label:p.name}))} value={t.members} onChange={(v)=>setCustom(all=>all.map(x=>x.id===t.id?{...x,members:v}:x))} exclude={custom.filter(x=>x.id!==t.id).flatMap(x=>x.members)} />
          <div><div className="muted">Placement</div><input className="input" type="number" min={1} max={custom.length} value={t.placement} onChange={e=>setCustom(all=>all.map(x=>x.id===t.id?{...x,placement:Number(e.target.value)}:x))}/></div>
        </div>))}
      </div>
    </div>}

    <div style={{textAlign:'right'}}><button className="btn primary" onClick={submit}>Record Match</button></div>
  </div>
}

function AppRoot(){ return <App/> }
ReactDOM.createRoot(document.getElementById('root')).render(<AppRoot/>)
