// Copyright (C) 2026 Dev Maniac's
// SPDX-License-Identifier: AGPL-3.0-or-later
// Apenas dados fictícios; iniciado por checar_visitas.py.
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const [base, convite] = process.argv.slice(2);
const aguarde = ms => new Promise(r => setTimeout(r, ms));
const perfil = mkdtempSync(join(tmpdir(), 'senku46-cdp-'));
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--remote-debugging-port=0', '--user-data-dir=' + perfil, 'about:blank'], {stdio:'ignore'});
let porta;
const conexoes = [];
try {
  for (let i=0; i<100 && !porta; i++) {
    await aguarde(100);
    try { porta=readFileSync(join(perfil,'DevToolsActivePort'),'utf8').split('\n')[0]; } catch {}
  }
  if (!porta) throw new Error('Navegador não iniciou');
  async function salvar(aba, arquivo) { const {data}=await aba.cdp('Page.captureScreenshot',{format:'png'}); writeFileSync(arquivo, Buffer.from(data,'base64')); }
  async function novaAba(caminho = '/visita.html#' + convite, pronta = 'document.getElementById("estado")?.textContent === "Conectado à sala."') {
    const alvo = await (await fetch(`http://127.0.0.1:${porta}/json/new?about:blank`, {method:'PUT'})).json();
    const ws = new WebSocket(alvo.webSocketDebuggerUrl);
    await new Promise((ok,erro) => {ws.addEventListener('open',ok,{once:true}); ws.addEventListener('error',erro,{once:true});});
    conexoes.push(ws);
    let id=0; const pendentes=new Map();
    ws.addEventListener('message', ev => {const msg=JSON.parse(ev.data); if (!pendentes.has(msg.id)) return; const p=pendentes.get(msg.id); pendentes.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);});
    const cdp=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pendentes.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
    async function avaliar(expression) { const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if (r.exceptionDetails) throw new Error('Falha em JavaScript da página'); return r.result.value; }
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Page.navigate',{url:base+caminho});
    for(let i=0;i<100;i++){await aguarde(100);try{if(await avaliar(pronta)) return {avaliar,cdp};}catch{}}
    throw new Error('A visita não conectou');
  }
  // bairro: de noite e com neve (simulados), a porta do chalé leva à recepção pública
  const mundo=await novaAba('/mundo.html?hora=21&clima=neve', 'document.getElementById("mundo-estado")?.textContent.includes("neve")');
  if (process.argv[4]) await aguarde(1500), await salvar(mundo, process.argv[4].replace(/\.png$/, '-mundo.png'));
  await mundo.avaliar(`(() => { const c=document.getElementById('mundo'), r=c.getBoundingClientRect(), p=Mundo.porta(Mundo.CHALES.find(c=>!c.vizinho));
    c.dispatchEvent(new MouseEvent('click',{clientX:r.left+(p.x+p.w/2)*r.width/320, clientY:r.top+(p.y+p.h/2)*r.height/180, bubbles:true})); })()`);
  for(let i=0;i<50;i++){await aguarde(100); try{ if(await mundo.avaliar('location.pathname==="/visita.html" && document.getElementById("mapa-estado")?.textContent.includes("apagadas")')) break; }catch{} if(i===49) throw new Error('A porta do chalé não levou à recepção');}
  console.log('O bairro abriu de noite com neve e a porta do chalé levou à recepção pública.');
  // sem convite: só a recepção acesa, o resto do prédio escurecido e a conversa travada
  const publica=await novaAba('/visita.html','document.getElementById("mapa-estado")?.textContent.includes("apagadas exigem convite")');
  const escuro=await publica.avaliar(`(() => { const c=document.getElementById('cena'), d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let escuros=0, claros=0; for(let i=0;i<d.length;i+=4){ const l=(d[i]+d[i+1]+d[i+2])/3; if(d[i+3]&&l<45) escuros++; else if(l>90) claros++; }
    return {escuros, claros, total:d.length/4, travado:document.getElementById('texto').disabled}; })()`);
  if (!escuro.travado || escuro.escuros < escuro.total*0.4 || escuro.claros < 200) throw new Error('Recepção pública sem salas apagadas: '+JSON.stringify(escuro));
  if (process.argv[4]) await salvar(publica, process.argv[4]);
  console.log('Sem convite, só a recepção ficou acesa e a conversa ficou travada.');
  const visitante=await novaAba(), equipe=await novaAba();
  await visitante.avaliar(`document.getElementById('texto').value='olá da visita'; document.getElementById('formulario').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
  let recebeu=false;
  for(let i=0;i<60 && !recebeu;i++){await aguarde(100); recebeu=await equipe.avaliar(`document.getElementById('mensagens').textContent.includes('olá da visita')`);}
  if (!recebeu) throw new Error('Mensagem não chegou à segunda aba');
  await visitante.avaliar(`document.getElementById('sair').click()`);
  const saida=await visitante.avaliar(`document.getElementById('estado').textContent`);
  if (saida !== 'Você saiu da sala.') throw new Error('Saída não foi confirmada');
  console.log('Duas abas conectaram, trocaram mensagem e a visita encerrou a sessão.');
} finally {
  for(const ws of conexoes) ws.close();
  chrome.kill('SIGTERM');
  await Promise.race([new Promise(r=>chrome.once('exit',r)),aguarde(3000)]);
  rmSync(perfil,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
