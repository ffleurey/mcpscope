#!/usr/bin/env node
// plot.js - generate an HTML context-size plot from a chat export JSON
// Usage: node plot.js <export-file.json> [output.html]
// Works with both v1 and v2 exports.

import { readFileSync, writeFileSync } from 'fs'

const file = process.argv[2]
const outFile = process.argv[3] ?? file.replace(/\.json$/, '-plot.html')
if (!file) { console.error('Usage: node plot.js <export.json> [output.html]'); process.exit(1) }
const data = JSON.parse(readFileSync(file, 'utf8'))
const { session, contextSegments, messages } = data

const isV2 = data.version === 2
const sysTokens = isV2 ? session.tokenEstimates?.systemPrompt : session.systemPromptTokens
const toolDefsTokens = isV2 ? session.tokenEstimates?.toolDefinitions : session.toolDefinitionsTokens
const ctx = session.loadedContextLength

function getMsgBase(msgId) {
  const m = msgId.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)
  return m ? m[1] : msgId
}

let staticSum = contextSegments.filter(s => s.msgId === 'system' || s.msgId === 'tool-defs').reduce((a,s)=>a+s.tokens,0)
let cumSegSum = staticSum

const points = []
let turnIdx = 0

for (const msg of messages) {
  if (msg.role === 'user') {
    turnIdx++
    const userSegs = contextSegments.filter(s => getMsgBase(s.msgId) === getMsgBase(msg.id) && s.type === 'user')
    cumSegSum += userSegs.reduce((a,s)=>a+s.tokens,0)
  } else if (msg.role === 'assistant') {
    const trs = msg.toolRounds || []
    if (trs.length === 0) {
      const actual = msg.usage?.promptTokens
      points.push({ label: `T${turnIdx}`, actual, ourSum: cumSegSum, isFinal: true, isCapped: actual >= (ctx ?? 999999) - 500 })
    } else {
      let withinExtra = 0
      for (let i = 0; i < trs.length; i++) {
        const r = trs[i]
        const isFinal = r.toolCallIds.length === 0
        const isCapped = r.promptTokens >= (ctx ?? 999999) - 500
        points.push({ label: `T${turnIdx}_R${i}`, actual: r.promptTokens, ourSum: cumSegSum + withinExtra, isFinal, isCapped })
        if (!isFinal) {
          const next = trs[i+1]
          const delta = next.promptTokens - r.promptTokens
          withinExtra += isCapped ? r.reasoningTokens : Math.max(0, delta)
        }
      }
    }
    const asstSegs = contextSegments.filter(s => getMsgBase(s.msgId) === getMsgBase(msg.id))
    cumSegSum += asstSegs.reduce((a,s)=>a+s.tokens,0)
  }
}

const realPoints = points.filter(p => !p.isCapped)
const maxErr = realPoints.length ? Math.max(...realPoints.map(p => Math.abs(p.ourSum - p.actual))) : 0
const actualCap = Math.max(...points.map(p => p.actual))

const html = `<!DOCTYPE html>
<html>
<head>
<title>Context Plot: ${session.title ?? 'Chat'}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
<style>
body{font-family:monospace;background:#1a1a2e;color:#eee;padding:20px}
h1{color:#a78bfa}h2{color:#60a5fa;margin-top:28px}
.box{background:#16213e;border-radius:8px;padding:18px;margin:18px 0}
.find{background:#0f3460;border-radius:8px;padding:16px;margin:14px 0}
.f{margin:8px 0}.ok{color:#34d399}.bad{color:#f87171}.warn{color:#fbbf24}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #334;padding:5px 9px;text-align:right;font-size:12px}
th{background:#1e3a5f;color:#93c5fd}tr:nth-child(even){background:#1a2a3a}
.cap{color:#64748b;font-style:italic}.ep{color:#f87171}.en{color:#34d399}
</style>
</head>
<body>
<h1>📊 Context Analysis — ${session.title ?? 'Chat'}</h1>
<p>Export v${data.version ?? 1} | ${messages.length} messages | ${points.length} LLM API calls | Context limit: ${ctx ?? '?'} | Actual cap observed: ${actualCap}</p>

<div class="find">
<h2>Key Findings</h2>
<div class="f ${realPoints.length > 0 ? 'warn' : 'bad'}">Real (non-capped) data points: ${realPoints.length} of ${points.length} total rounds</div>
<div class="f ${maxErr < 100 ? 'ok' : 'bad'}">Max estimation error on real points: ${maxErr} tokens ${maxErr < 100 ? '✓' : '⚠'}</div>
<div class="f bad">Context filled: turn 1 contains the first capped round</div>
<div class="f warn">base estimate (system+tool-defs): ${staticSum} tokens | actual round-0: ${points[0]?.actual ?? '?'} tokens | error: ${staticSum - (points[0]?.actual ?? 0)}</div>
</div>

<div class="box"><canvas id="chart" height="100"></canvas></div>

<div class="box">
<h2>All Rounds</h2>
<table>
<tr><th>Round</th><th>Our Estimate</th><th>Actual PT</th><th>Error</th><th>Note</th></tr>
${points.map(p=>{
  const e=p.ourSum-p.actual
  const ec=e>100?'ep':e<-100?'en':''
  const note=p.isCapped?'<span class="cap">capped</span>':'<span class="ok">real</span>'
  return `<tr class="${p.isCapped?'cap':''}"><td>${p.label}</td><td>${p.ourSum}</td><td>${p.actual}</td><td class="${ec}">${e>=0?'+':''}${e}</td><td>${note}</td></tr>`
}).join('\n')}
</table>
</div>

<script>
new Chart(document.getElementById('chart').getContext('2d'),{
  type:'line',
  data:{
    labels:${JSON.stringify(points.map(p=>p.label))},
    datasets:[
      {label:'Actual promptTokens (API)',data:${JSON.stringify(points.map(p=>p.actual))},borderColor:'#34d399',pointRadius:3,borderWidth:2},
      {label:'Our segment sum (bar estimate)',data:${JSON.stringify(points.map(p=>p.ourSum))},borderColor:'#f87171',borderDash:[5,3],pointRadius:3,borderWidth:2},
      {label:'Observed cap (${actualCap})',data:new Array(${points.length}).fill(${actualCap}),borderColor:'#fbbf24',borderDash:[8,5],borderWidth:1,pointRadius:0},
      ${ctx ? `{label:'Loaded ctx (${ctx})',data:new Array(${points.length}).fill(${ctx}),borderColor:'#475569',borderDash:[3,3],borderWidth:1,pointRadius:0},` : ''}
    ]
  },
  options:{
    responsive:true,
    plugins:{
      title:{display:true,text:'Context: Our Estimate vs API Ground Truth',color:'#a78bfa',font:{size:15}},
      legend:{labels:{color:'#ccc'}},
      tooltip:{callbacks:{footer:items=>{const i=items[0].dataIndex;return ${JSON.stringify(points.map(p=>p.isCapped))}[i]?'⚠ Capped — comparison unreliable':'✓ Real data'}}}
    },
    scales:{x:{ticks:{color:'#888',maxRotation:90},grid:{color:'#334'}},y:{ticks:{color:'#888'},grid:{color:'#334'}}}
  }
});
<\/script>
</body>
</html>`

writeFileSync(outFile, html)
console.log(`Plot written to: ${outFile}`)
