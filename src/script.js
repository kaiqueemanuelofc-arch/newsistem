/* FreeFlow frontend
   Edit only the WEBHOOK_INGEST_URL and PUBLIC_REPORT_URL constants */
const WEBHOOK_INGEST_URL = "https://myworkflow.tk/webhook/ultra";
const PUBLIC_REPORT_URL  = "https://myworkflow.tk/webhook/ultra-report";

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const finalizeBtn = document.getElementById('finalizeBtn');
const transcriptEl = document.getElementById('transcript');
const statusEl = document.getElementById('status');
const sessionEl = document.getElementById('sessionId');
const reportPreview = document.getElementById('reportPreview');
const reportActions = document.getElementById('reportActions');
const downloadJsonBtn = document.getElementById('downloadJson');
const downloadPdfBtn = document.getElementById('downloadPdf');
const openFullBtn = document.getElementById('openFull');

let recognition=null, mediaRecorder=null, audioChunks=[], running=false;
let sessionId = 'ff_'+Math.random().toString(36).slice(2,9);
sessionEl.textContent = sessionId;

// Função para inicializar a API de reconhecimento de fala
function initRecognition(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR) return null;
  const r = new SR();
  r.lang='pt-BR';
  r.interimResults=true;
  r.continuous=true;
  // Concatena a transcrição em tempo real
  r.onresult = (e)=>{ let txt=''; for(let i=e.resultIndex;i<e.results.length;i++) txt+=e.results[i][0].transcript+' '; transcriptEl.value = (transcriptEl.value+' '+txt).trim(); };
  // Reinicia a gravação se ela parar inesperadamente
  r.onend = ()=>{ if(running) r.start(); };
  return r;
}

// Função para inicializar o gravador de mídia e esperar pela permissão
async function initMedia(){
  try {
    // Solicita permissão do usuário para usar o microfone
    const s = await navigator.mediaDevices.getUserMedia({audio:true});
    const mr = new MediaRecorder(s);
    // Coleta os pedaços de áudio
    mr.ondataavailable = e=>{ if(e.data && e.data.size) audioChunks.push(e.data); };
    return mr;
  } catch(e) {
    // Se a permissão for negada, exibe uma mensagem de erro na interface e no console
    statusEl.textContent = 'Erro: Permissão de microfone negada.';
    console.error('Microphone permission denied.', e);
    return null; // Retorna null para indicar falha
  }
}

// Evento de clique no botão 'Iniciar'
startBtn.addEventListener('click', async ()=>{
  if(running) return;

  // Reseta o estado
  audioChunks = [];
  transcriptEl.value = '';

  // Espera pela inicialização do gravador de mídia
  mediaRecorder = await initMedia();
  if (!mediaRecorder) {
    return; // Sai da função se a inicialização falhar
  }

  // Inicializa o reconhecimento de fala
  recognition = initRecognition();

  // Inicia a gravação e a transcrição
  if(recognition) recognition.start();
  mediaRecorder.start(1000);
  running = true;
  statusEl.textContent = 'Gravando e transcrevendo...';
});

// Evento de clique no botão 'Pausar'
pauseBtn.addEventListener('click', ()=>{
  if(!running) return;
  running=false;
  if(recognition) recognition.stop();
  if(mediaRecorder && mediaRecorder.state!=='inactive') mediaRecorder.stop();
  statusEl.textContent='Pausado';
});

// Evento de clique no botão 'Finalizar & Gerar Relatório'
finalizeBtn.addEventListener('click', async ()=>{
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    statusEl.textContent = 'Gerando relatório localmente...';
    await processFinalReport();
    return;
  }

  running = false;
  if (recognition) recognition.stop();

  // Cria uma promessa para esperar o evento 'onstop'
  const finalReportPromise = new Promise(resolve => {
    mediaRecorder.onstop = async () => {
      await processFinalReport();
      resolve();
    };
  });

  mediaRecorder.stop();
  statusEl.textContent = 'Finalizando gravação...';

  await finalReportPromise;
});

// A lógica de finalização foi movida para esta função para ser chamada após a gravação parar
const processFinalReport = async () => {
  const transcript = transcriptEl.value.trim();
  let audioBlob = null;
  if(audioChunks.length) audioBlob = new Blob(audioChunks, {type:'audio/webm'});

  let backendReport = null;
  try{
    const form = new FormData();
    form.append('sessionId', sessionId);
    form.append('transcript', transcript);
    if(audioBlob) form.append('audio', audioBlob, sessionId+'.webm');

    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 10000);
    const resp = await fetch(WEBHOOK_INGEST_URL, {method:'POST', body:form, signal:ctrl.signal});
    clearTimeout(t);
    if(resp.ok){
      const j = await resp.json();
      backendReport = j.report || j;
    }
  }catch(e){
    console.warn('backend failed', e);
  }
  const finalReport = backendReport || generateLocalReport(transcript);
  showReport(finalReport, Boolean(backendReport));
};

function generateLocalReport(transcript){
  const name = (transcript.match(/nome[:\s]+([A-ZÀ-Ý][a-z]+(?:\s+[A-Z][a-z]+)*)/i)||[])[1]||'—';
  const age = (transcript.match(/(\d{1,3})\s*(anos|ano)/i)||[])[1]||'—';
  const mm = Array.from(transcript.matchAll(/(\d+(?:[.,]\d+)?)\s*mm/gi)).map(m=>m[1]);
  const measurements = mm.length? { lesions: mm.map((v,i)=>({location:'lesão '+(i+1), size_mm:v, characteristics:'—'})) } : {};
  return {
    patient:{name, age, sex:'—'},
    exam:{type:'Ultrassom', datetime:new Date().toLocaleString()},
    findings: transcript || '—',
    measurements,
    impression:'—',
    plan:'—'
  };
}

function showReport(report, isBackend){
  reportPreview.innerHTML = `<div class="p-3 bg-slate-50 rounded-xl"><strong>Paciente:</strong> ${report.patient?.name||'—'} • ${report.patient?.age||'—'}</div>
  <pre style="white-space:pre-wrap;margin-top:8px">${report.findings||'—'}</pre>`;
  reportActions.classList.remove('hidden');
  window._lastFreeflowReport = report;
  downloadJsonBtn.onclick = ()=>{ const b=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=sessionId+'-report.json'; a.click(); URL.revokeObjectURL(u); };
  downloadPdfBtn.onclick = ()=> downloadPDF(report);
  openFullBtn.onclick = ()=> openFullReport(report);
  statusEl.textContent = isBackend? 'Relatório do backend' : 'Relatório gerado localmente';
}

function openFullReport(report){
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório</title>
  <style>body{font-family:Arial;padding:20px;color:#0f172a}.card{background:#f8fafc;padding:12px;border-radius:10px;margin-bottom:12px}pre{white-space:pre-wrap;background:#fff;padding:12px;border-radius:8px}</style></head><body>
  <h1>Relatório Clínico</h1><div class="card"><strong>Paciente:</strong> ${escapeHtml(report.patient?.name||'—')}<br><strong>Idade:</strong> ${escapeHtml(report.patient?.age||'—')}</div>
  <h3>Achados</h3><pre>${escapeHtml(report.findings||'—')}</pre>
  <h3>Medições</h3><pre>${escapeHtml(JSON.stringify(report.measurements||{},null,2))}</pre>
  </body></html>`;
  const w = window.open('','_blank'); w.document.write(html); w.document.close();
}

function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function downloadPDF(report){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'pt',format:'a4'});
  const margin=40; doc.setFontSize(16); doc.text('Relatório Clínico - FreeFlow', margin,60); doc.setFontSize(12);
  const lines = [`Paciente: ${report.patient?.name||'—'}`, `Idade: ${report.patient?.age||'—'}`, '', 'Achados:'].concat(wrapText(report.findings||'—',90)).concat(['','Medições:']).concat(wrapText(JSON.stringify(report.measurements||{},null,2),90));
  let y=90; for(const ln of lines){ if(y>750){ doc.addPage(); y=60 } doc.text(String(ln), margin, y); y+=14; } doc.save(sessionId+'_relatorio_ultrassom.pdf');
}

function wrapText(text, c){ const words=String(text).split(/\s+/); const lines=[]; let cur=''; for(const w of words){ if((cur+' '+w).trim().length>c){ lines.push(cur.trim()); cur=w; } else cur+= ' '+w; } if(cur.trim()) lines.push(cur.trim()); return lines; }

window._freeflow = { generateLocalReport };
