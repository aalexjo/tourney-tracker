import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(express.json())

const pub = path.join(__dirname, '..', 'public')
app.use(express.static(pub))

const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ players:{}, matches:[], settings:{ method:'PAIRWISE', k:32, theme:'light' } }, null, 2))

app.get('/api/state', (req,res)=>{
  try { const raw = fs.readFileSync(DB_FILE, 'utf-8'); res.json(JSON.parse(raw)) }
  catch(e){ res.status(500).json({ error:String(e) }) }
})
app.post('/api/state', (req,res)=>{
  try { const tmp = DB_FILE+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(req.body, null, 2)); fs.renameSync(tmp, DB_FILE); res.json({ ok:true }) }
  catch(e){ res.status(500).json({ error:String(e) }) }
})

app.get('*', (_,res)=> res.sendFile(path.join(pub,'index.html')))

const port = process.env.PORT || 5174
app.listen(port, ()=> console.log('Server http://localhost:'+port))
