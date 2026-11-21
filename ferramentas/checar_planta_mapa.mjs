// Aceite do modo construção no mapa.js (Mapa.montarPredio com a planta), num Chrome ou Edge headless sobre a prévia:
//   1. planta vazia, ausente ou null: o prédio (objetos, vagas, pegadas pelo livre, janelas, quadros, portas, animados, salas,
//      ringue e o fundo pixel a pixel) é idêntico ao do mapa.js de referência (git show <ref>:static/mapa.js), com 1, 6, 12 e
//      20 times e o grande (14 times vazios a mais), em várias marcas (a marca sorteia os cantinhos da sala comunal);
//   2. plantas de exemplo (pintar, tirar, espelhar, mover e pôr): ids estáveis, todos os assentos com passagem
//      (Planta.semPassagem), ringue com plateia de pelo menos 8 e nada movido ou posto encavalado;
//   3. plantas adulteradas (__proto__, constructor, x enorme, sala que não existe, tipos trocados): o prédio monta sem exceção.
// Com --prints, salva o prédio com a planta de exemplo em .previa/telas/construcao-mapa-<cena>.png.
// Uso (com a prévia no ar: python ferramentas/previa.py ferramentas/previa.exemplo.json):
//   node ferramentas/checar_planta_mapa.mjs [url] [--ref main] [--prints]
// Sai com 0 sem achados, 1 com algum achado e 2 se não conseguir rodar.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opcao = nome => { const i = args.indexOf(nome); return i < 0 ? null : args.splice(i, 2)[1] ?? ""; };
const flag = nome => { const i = args.indexOf(nome); return i >= 0 && !!args.splice(i, 1); };
const REF = opcao("--ref") || "main", PRINTS = flag("--prints");
const URL_PAGINA = args[0] || "http://127.0.0.1:7372/?hora=10.5";
const RAIZ = fileURLToPath(new URL("..", import.meta.url)), TELAS = join(RAIZ, ".previa", "telas");
const espera = ms => new Promise(r => setTimeout(r, ms));
let nav, perfil, ws;
const sair = async (codigo, msg) => {
  if (msg) console.error(msg);
  try { ws && ws.close(); } catch {}
  if (nav && nav.exitCode === null) { const fim = new Promise(r => nav.once("exit", r)); nav.kill(); await Promise.race([fim, espera(5000)]); }
  if (perfil) try { rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {}
  process.exit(codigo);
};
process.on("exit", () => { try { nav && nav.exitCode === null && nav.kill(); } catch {} });

let mapaRef;
try { mapaRef = execFileSync("git", ["show", `${REF}:static/mapa.js`], { cwd: RAIZ, encoding: "utf8", maxBuffer: 1 << 24 }); } catch { await sair(2, `não li o static/mapa.js de ${REF}`); }
// única diferença aceita em relação ao main: a mesa de pingue-pongue subiu 12 px (o jogador de baixo ficava sem passagem
// em todo prédio com ela, e o Salvar do editor nunca liberava). Sem esse trecho no ref, a comparação não roda.
const PINGPONG = ['obj("pingpong", zx + 3 * T, fim - 10)', 'obj("pingpong", zx + 3 * T, fim - 22)'];
if (mapaRef.includes(PINGPONG[0])) mapaRef = mapaRef.replace(PINGPONG[0], PINGPONG[1]);
else if (!mapaRef.includes(PINGPONG[1])) await sair(2, `o mapa.js de ${REF} não tem a mesa de pingue-pongue esperada`);
try { await (await fetch(URL_PAGINA)).arrayBuffer(); } catch { await sair(2, `prévia fora do ar em ${URL_PAGINA}`); }
const NAVEGADOR = [process.env.NAVEGADOR, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"].find(c => c && existsSync(c));
if (!NAVEGADOR) await sair(2, "Chrome ou Edge não encontrado (defina NAVEGADOR)");
perfil = mkdtempSync(join(tmpdir(), "checar-planta-"));
nav = spawn(NAVEGADOR, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${perfil}`, "--no-first-run", "--no-default-browser-check",
  "--window-size=1440,900", "about:blank"], { stdio: "ignore" });
let alvo;
for (let i = 0; i < 75 && !alvo; i++) {
  await espera(200);
  try { const porta = readFileSync(join(perfil, "DevToolsActivePort"), "utf8").split("\n")[0].trim();
    alvo = (await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json()).find(t => t.type === "page"); } catch {}
}
if (!alvo) await sair(2, `o navegador não abriu o DevTools (${NAVEGADOR})`);
ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
let seq = 0; const pend = new Map(), consoleMsgs = [];
ws.addEventListener("message", ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { const { r, j } = pend.get(m.id); pend.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") consoleMsgs.push("exceção: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && /error|warn/.test(m.params.type)) consoleMsgs.push(`console.${m.params.type}: ` + m.params.args.map(a => a.value ?? a.description).join(" "));
  if (m.method === "Log.entryAdded" && m.params.entry.level !== "verbose") consoleMsgs.push(`log.${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url || ""}`);
});
const cdp = (method, params = {}) => new Promise((r, j) => { const id = ++seq; pend.set(id, { r, j }); ws.send(JSON.stringify({ id, method, params })); });
const js = async expr => { const x = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (x.exceptionDetails) throw new Error(x.exceptionDetails.exception?.description || expr); return x.result.value; };
await cdp("Runtime.enable"); await cdp("Log.enable"); await cdp("Page.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp("Page.navigate", { url: URL_PAGINA });
let pronto = false;
for (let i = 0; i < 60 && !pronto; i++) { await espera(500); try { pronto = await js("typeof mundo !== 'undefined' && !!mundo && !!atlas"); } catch {} }
if (!pronto) await sair(2, `a página não montou o escritório em ${URL_PAGINA}\n${consoleMsgs.join("\n")}`);
// a página principal ainda não carrega o planta.js (v1.1): o Planta.grupos e o Planta.semPassagem vêm dele
if (!await js(`typeof Planta !== "undefined" || new Promise(r => { const s = document.createElement("script"); s.src = "planta.js"; s.onload = () => r(true); s.onerror = () => r(false); document.head.append(s); })`))
  await sair(2, "não carreguei o planta.js na página");
const consoleAntes = consoleMsgs.length;

// ---- no navegador: o mapa.js de referência ao lado do novo e as funções de comparação
await js(`(() => {
  window.MapaRef = new Function(${JSON.stringify(mapaRef.replace("window.Mapa = Mapa;", ""))} + "\\nreturn Mapa;")();
  const nomeSala = s => (s ? s.nome + "@" + s.tx : null);
  const pega = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  const MESA = ["x", "topo", "pe", "saida", "corredor", "handle", "estilo", "itens", "monitores", "corItem", "cadeira", "cadeiraEstilo", "abajur", "pato"];
  const hash = d => { let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
  window.retrato = p => {
    const r = {
      W: p.W, H: p.H, corredorY: p.corredorY, predioRet: p.predioRet, entrada: p.entrada, luzesTeto: p.luzesTeto, corredorTopo: p.corredorTopo, corredorAlt: p.corredorAlt,
      objetos: p.objetos.map(o => ({ ...pega(o, ["nome", "tipo", "x", "y", "w", "h", "dx", "chave", "espelho", "cor", "estilo", "abertura"]), mesa: o.mesa ? pega(o.mesa, MESA) : undefined })),
      vagas: p.vagas.map(v => [nomeSala(v.sala), v.x, v.y, v.tipo, v.olha, v.via]),
      janelas: p.janelas, quadros: p.quadros,
      portas: p.portas.map(q => ({ ...q, sala: nomeSala(q.sala) })),
      animados: p.animados.map(a => ({ ...a, sala: nomeSala(a.sala) })),
      salas: [...p.salas, ...p.baixo].map(s => ({ ...pega(s, ["tipo", "nome", "tx", "ty", "tw", "th", "parede", "piso", "px", "py", "pw", "ph", "chao", "porta", "portas", "faixa", "faixaX", "placa", "placaLogo", "logo", "cols", "linhas", "emCima", "luz"]),
        mesas: (s.mesas || []).map(m => pega(m, MESA)), vagasLivres: (s.vagasLivres || []).map(v => [v.x, v.y]) })),
      ringue: p.ringue ? { ...pega(p.ringue, ["x", "y", "w", "h", "pontos", "quadro", "plateia"]) } : null,
      externos: p.externos,
    };
    let bits = ""; for (let y = 0; y < p.H; y += 3) for (let x = 0; x < p.W; x += 3) bits += p.livre(x, y) ? "1" : "0";
    r.livre = hash(new TextEncoder().encode(bits));
    r.fundo = hash(p.fundo.getContext("2d").getImageData(0, 0, p.W, p.H).data);
    return r;
  };
  window.diferenca = (a, b, caminho = "") => {
    if (JSON.stringify(a) === JSON.stringify(b)) return null;
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diferenca(a[k], b[k], caminho + "." + k); if (d) return d; }
    }
    return caminho + ": " + JSON.stringify(a)?.slice(0, 160) + " ≠ " + JSON.stringify(b)?.slice(0, 160);
  };
  window.cenario = (nTimes, grande, empresa) => {
    const cfg = structuredClone(config); delete cfg.planta;
    const hs = estado.agentes.map(a => a.handle), base = cfg.times[0] || {};
    if (nTimes) cfg.times = Array.from({ length: nTimes }, (_, i) => ({ ...base, nome: "Time " + (i + 1), tipo: "mesas", parede: i % 6, piso: i % 10, agentes: hs.filter((_, j) => j % nTimes === i) }));
    if (grande) cfg.times = [...cfg.times, ...Array.from({ length: 14 }, (_, i) => ({ ...cfg.times[0], nome: "Time extra " + (i + 1), agentes: [] }))];
    cfg.empresa = empresa;
    return { cfg, grupos: Planta.grupos(cfg, estado.agentes) };
  };
  return true;
})()`);

const achados = [];
const achado = t => { achados.push(t); console.log("  ACHADO:", t); };

// ---- 1. planta vazia = prédio de hoje
const MARCAS = ["Dev Maniac's", "Acme", "Padaria do Zé", "Estúdio Norte", "Loja 42", "Clínica Sol"];
const CENARIOS = [[0, false], [1, false], [6, false], [12, false], [20, false], [0, true]];
let comparados = 0;
for (const [n, grande] of CENARIOS) for (const marca of MARCAS) {
  const r = await js(`(() => {
    const { cfg, grupos } = cenario(${n}, ${grande}, ${JSON.stringify(marca)});
    const ref = retrato(MapaRef.montarPredio(atlas, cfg, grupos));
    const out = [];
    for (const [rotulo, planta] of [["ausente", undefined], ["null", null], ["vazia", Planta.vazia(7)]]) {
      const p = Mapa.montarPredio(atlas, cfg, grupos, planta);
      const d = diferenca(ref, retrato(p));
      if (d) out.push(rotulo + " " + d);
      const sem = Planta.semPassagem(p);
      if (sem.length) out.push(rotulo + ": " + sem.length + " vagas sem passagem no automático (" + sem.slice(0, 3).map(v => v.tipo + "@" + v.sala.chave + " " + v.x + "," + v.y).join(", ") + ")");
      if (p.planta.aplicados || p.planta.ignorados.length) out.push(rotulo + ": planta vazia com ajustes " + JSON.stringify(p.planta));
    }
    const cfgP = { ...cfg, planta: Planta.vazia(3) };   // a planta pelo config (como a página faz)
    const d = diferenca(ref, retrato(Mapa.montarPredio(atlas, cfgP, grupos))); if (d) out.push("config.planta " + d);
    return { out, salas: grupos.length, objetos: ref.objetos.length, vagas: ref.vagas.length, ringue: !!ref.ringue, plateia: ref.ringue ? ref.ringue.plateia.length : 0 };
  })()`);
  comparados++;
  const nome = `${grande ? "grande" : (n || "config") + " times"} · ${marca}`;
  if (r.out.length) r.out.forEach(t => achado(`${nome}: ${t}`));
  else console.log(`ok idêntico  ${nome}: ${r.salas} grupos, ${r.objetos} objetos, ${r.vagas} vagas, plateia ${r.plateia}`);
}

// ---- 2. plantas de exemplo
const exemplo = await js(`(() => {
  const out = [], { cfg, grupos } = cenario(6, false, "Dev Maniac's");
  const auto = Mapa.montarPredio(atlas, cfg, grupos, null);
  const ed = auto.objetos.filter(o => o.id), ids = ed.map(o => o.id);
  const sala = Object.fromEntries([...auto.salas, ...auto.baixo].map(s => [s.chave, s]));
  if (new Set(ids).size !== ids.length) out.push("ids repetidos");
  if (ids.some(id => !/^(recepcao|reuniao|lounge|cozinha|time:[^|]+)\\|[a-z][a-z0-9_]*\\|[0-9]{1,2}$/.test(id))) out.push("id fora do formato");
  for (const o of ed) { const s = sala[o.salaChave]; if (!s || o.auto.x !== Math.round(o.x + o.w / 2) - s.px && Math.abs(o.auto.x - (o.x + o.w / 2 - s.px)) > 1 || o.auto.y !== o.y + o.h - s.chao) { out.push("o.auto errado em " + o.id); break; } }
  if (ed.some(o => o.tipo === "mesa" || o.tipo === "cadeira" || /^(divisoria|jardineira|bancada|ringue)/.test(o.nome || ""))) out.push("peça não editável com id");
  // podeFechar: plantas cegas (tudo movido de uma vez) podem fechar assento; no editor o Salvar fica bloqueado (Planta.semPassagem)
  const fechadosCegos = {};
  const conferir = (rotulo, planta, esperaIgnorados = null, podeFechar = false) => {
    const p = Mapa.montarPredio(atlas, cfg, grupos, planta), sem = Planta.semPassagem(p);
    if (podeFechar) fechadosCegos[rotulo] = sem.length;
    else if (sem.length) out.push(rotulo + ": " + sem.length + " vagas sem passagem (" + sem.slice(0, 3).map(v => v.tipo + "@" + v.sala.chave).join(", ") + ")");
    if (!p.ringue || p.ringue.plateia.length < 8) out.push(rotulo + ": ringue sem plateia de 8 (" + (p.ringue ? p.ringue.plateia.length : "sem ringue") + ")");
    if (esperaIgnorados !== null && p.planta.ignorados.length !== esperaIgnorados) out.push(rotulo + ": " + p.planta.ignorados.length + " ignorados, esperava " + esperaIgnorados + " " + JSON.stringify(p.planta.ignorados.slice(0, 5)));
    // nada encavalado: pegada (parte de baixo) de cada peça movida ou posta contra as outras peças sólidas
    const fundo = o => Math.max(6, o.h * 0.35), peg = o => ({ x: o.x + 1, y: o.y + o.h - fundo(o), w: o.w - 2, h: fundo(o) });
    const sobre = (r, q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y;
    const solidos = p.objetos.filter(o => o.nome && o.chave >= 0 && o.w && o.h && !/^(fruteira|reuniao_mesa|reuniao_fundo)$/.test(o.nome));
    const mexidos = p.objetos.filter(o => o.id && (o.id.startsWith("novo:") || o.pos.x !== o.auto.x || o.pos.y !== o.auto.y) && o.chave >= 0);
    for (const o of mexidos) for (const q of solidos) if (q !== o && sobre(peg(o), peg(q))) { out.push(rotulo + ": " + o.id + " encavalado em " + (q.id || q.nome)); break; }
    for (const o of mexidos) for (const s of p.salas) for (const m of s.mesas) if (sobre(peg(o), { x: m.x - 16, y: m.topo, w: 32, h: 13 })) out.push(rotulo + ": " + o.id + " em cima de mesa");
    return p;
  };
  // a) pintura de todas as salas (mesmos objetos, só cor muda)
  const salas = {}; Object.keys(sala).forEach((k, i) => { salas[k] = { parede: i % 7, piso: (i * 3) % 10 }; });
  const pint = conferir("pintar", { rev: 1, salas, moveis: {}, novos: [] }, 0);
  if (pint.planta.aplicados !== Object.keys(salas).length) out.push("pintar: aplicados " + pint.planta.aplicados);
  if (!Object.entries(salas).every(([k, v]) => [...pint.salas, ...pint.baixo].find(s => s.chave === k && s.parede === v.parede && s.piso === v.piso))) out.push("pintar: sala sem a cor da planta");
  if (JSON.stringify(retrato(pint).objetos) !== JSON.stringify(retrato(auto).objetos)) out.push("pintar mudou os objetos");
  // b) tirar 1 de cada 3 peças: as outras ficam no mesmo lugar e com o mesmo id
  const fora = ids.filter((_, i) => i % 3 === 0), moveis = Object.fromEntries(fora.map(id => [id, { fora: true }]));
  const tir = conferir("tirar", { rev: 1, salas: {}, moveis, novos: [] }, 0);
  const pos = p => Object.fromEntries(p.objetos.filter(o => o.id).map(o => [o.id, [o.x, o.y]]));
  const pa = pos(auto), pt = pos(tir);
  if (fora.some(id => pt[id])) out.push("tirar: peça tirada continua no prédio");
  if (ids.filter(id => !fora.includes(id)).some(id => JSON.stringify(pa[id]) !== JSON.stringify(pt[id]))) out.push("tirar mexeu em outra peça");
  const vagasTiradas = auto.vagas.length - tir.vagas.length;
  // c) espelhar tudo o que espelha
  const esp = Object.fromEntries(ed.filter(o => !Mapa.SEM_ESPELHO.has(o.nome) && !Mapa.FIXOS.has(o.nome)).map(o => [o.id, { e: true }]));
  const pe = conferir("espelhar", { rev: 1, salas: {}, moveis: esp, novos: [] });
  const espelhados = pe.objetos.filter(o => o.id && o.espelho).length;
  // d) mover cada peça móvel 16 px para a direita e 8 para baixo (o que não cabe volta e é contado)
  const mov = Object.fromEntries(ed.filter(o => !Mapa.FIXOS.has(o.nome)).map(o => [o.id, { x: o.auto.x + 16, y: o.auto.y + 8 }]));
  const pm = conferir("mover", { rev: 1, salas: {}, moveis: mov, novos: [] }, null, true);
  const movidos = pm.objetos.filter(o => o.id && (o.pos.x !== o.auto.x || o.pos.y !== o.auto.y)).length;
  // e) troca de lugar entre duas peças iguais da mesma sala, em qualquer ordem. Só peças baixas: uma peça alta movida não
  // pode subir na frente de quadro ou placa (C4.4), e o automático às vezes põe planta alta na frente de pôster
  const baixas = ed.filter(o => !Mapa.FIXOS.has(o.nome) && o.y >= sala[o.salaChave].chao).sort((a, b) => (a.nome === "mesinha" ? -1 : 0) - (b.nome === "mesinha" ? -1 : 0));
  const A = baixas.find(o => baixas.some(q => q !== o && q.nome === o.nome && q.salaChave === o.salaChave));
  const B = A && baixas.find(q => q !== A && q.nome === A.nome && q.salaChave === A.salaChave);
  if (!A) out.push("troca: nenhum par de peças iguais e baixas para testar");
  else for (const ordem of [[A, B], [B, A]]) {
    const m = {}; for (const o of ordem) m[o.id] = o === A ? { x: B.auto.x, y: B.auto.y } : { x: A.auto.x, y: A.auto.y };
    const p = conferir("troca", { rev: 1, salas: {}, moveis: m, novos: [] });
    if (p.planta.ignorados.length) out.push("troca de lugar não coube: " + JSON.stringify(p.planta.ignorados));
  }
  // f) pôr peças do catálogo em cada sala (na frente e no fundo de cada sala)
  const novos = [];
  for (const [k, s] of Object.entries(sala)) for (const [nome, fx, fy] of [["planta_g1", 0.5, 0.92], ["tapete2", 0.3, 0.5], ["caixas", 0.85, 0.3]])
    novos.push({ nome, sala: k, x: Math.round(s.pw * fx), y: Math.round((s.py + s.ph - s.chao) * fy), e: nome === "caixas" });
  const pn = conferir("pôr", { rev: 1, salas: {}, moveis: {}, novos });
  const postos = pn.objetos.filter(o => o.id && o.id.startsWith("novo:")).length;
  // g) tudo junto
  const tudo = conferir("tudo junto", { rev: 2, salas, moveis: { ...esp, ...mov, ...moveis }, novos }, null, true);
  window.exemplos = { auto, pint, tir, pe, pm, pn, tudo };
  return { out, troca: A ? A.id + " <-> " + B.id : null, assentosFechadosNasCegas: fechadosCegos, editaveis: ids.length, fora: fora.length, vagasTiradas, espelhados, pedidosEspelho: Object.keys(esp).length, movidos, pedidosMover: Object.keys(mov).length,
    postos, pedidosPor: novos.length, tudo: tudo.planta.aplicados + " aplicados, " + tudo.planta.ignorados.length + " ignorados" };
})()`);
exemplo.out.forEach(t => achado("exemplo " + t));
const { out: _o, ...resumo } = exemplo;
console.log("exemplo:", JSON.stringify(resumo));

// ---- 3. plantas adulteradas: monta sem exceção, ignorando o que não vale
const adulteradas = await js(`(() => {
  const { cfg, grupos } = cenario(0, false, "Dev Maniac's"), out = [];
  const lista = [
    JSON.parse('{"rev":1,"salas":{"__proto__":{"piso":3},"constructor":{"parede":1},"naoexiste":{"piso":2},"lounge":{"piso":99},"cozinha":{"parede":-1},"reuniao":{"piso":"3"}},"moveis":{"__proto__":{"x":1,"y":1},"constructor":{"fora":true},"lounge|sofa|0":{"x":99999,"y":-5},"lounge|sofa_cinza|0":{"x":1.5,"y":2},"recepcao|recepcao|0":{"e":"sim"},"cozinha|balcao|0":{"x":10,"y":30},"toString":{}},"novos":[{"nome":"__proto__","sala":"lounge","x":10,"y":10,"e":false},{"nome":"constructor","sala":"lounge","x":10,"y":10,"e":false},{"nome":"jukebox","sala":"lounge","x":100,"y":60,"e":false},{"nome":"planta","sala":"__proto__","x":10,"y":10,"e":false},null,5,{"nome":"planta","sala":"lounge","x":4000,"y":4000,"e":false}]}'),
    { rev: 1, salas: null, moveis: null, novos: null }, { rev: 1, salas: 5, moveis: "x", novos: {} }, { salas: [], moveis: [], novos: [[]] }, "planta", 42, [],
    { rev: 1, salas: {}, moveis: Object.fromEntries(Array.from({ length: 400 }, (_, i) => ["lounge|planta_g1|" + (i % 100), { x: i, y: i }])), novos: Array.from({ length: 200 }, (_, i) => ({ nome: "planta", sala: "lounge", x: i * 7, y: 40, e: false })) },
  ];
  lista.forEach((pl, i) => {
    try { const p = Mapa.montarPredio(atlas, cfg, grupos, pl); if (!p || !p.objetos.length || !p.ringue) out.push("adulterada " + i + ": prédio incompleto"); }
    catch (e) { out.push("adulterada " + i + ": exceção " + e.message); }
  });
  const p0 = Mapa.montarPredio(atlas, cfg, grupos, lista[0]);
  return { out, ignorados0: p0.planta.ignorados.length, aplicados0: p0.planta.aplicados, proto: Object.prototype.x === undefined && Object.prototype.piso === undefined && !Object.hasOwn(Object.prototype, "fora") };
})()`);
adulteradas.out.forEach(achado);
if (!adulteradas.proto) achado("adulterada: a planta mexeu no Object.prototype");
console.log(`adulteradas: ok (a primeira: ${adulteradas.aplicados0} aplicados, ${adulteradas.ignorados0} ignorados)`);

if (PRINTS) {
  mkdirSync(TELAS, { recursive: true });
  for (const cena of ["auto", "tudo", "pn", "pm"]) {
    const url = await js(`(() => { const p = exemplos.${cena}, cv = document.createElement("canvas"); cv.width = p.W; cv.height = p.H;
      const c = cv.getContext("2d"); c.imageSmoothingEnabled = false; c.drawImage(p.fundo, 0, 0);
      const spr = (n, x, y) => { const s = atlas.json.sprites[n]; if (s) c.drawImage(atlas.img, s[0], s[1], s[2], s[3], x, y, s[2], s[3]); };
      for (const o of [...p.objetos].sort((a, b) => a.chave - b.chave)) {
        if (o.tipo === "mesa") Mapa.desenharMesa(c, o.mesa.x, o.mesa.topo, "apagada", 0, o.mesa);
        else if (o.tipo === "cadeira") Mapa.desenharCadeira(c, o.x, o.y, o.cor, o.estilo);
        else { if (o.espelho) { c.save(); c.translate(2 * o.x + o.w, 0); c.scale(-1, 1); } spr(o.nome, o.x, o.y); if (o.espelho) c.restore(); }
      }
      c.fillStyle = "rgba(255,0,80,.9)"; for (const v of p.vagas) c.fillRect(v.x - 1, v.y - 1, 3, 3);   // assentos e pontos
      return cv.toDataURL("image/png"); })()`);
    const arq = join(TELAS, `construcao-mapa-${cena}.png`);
    writeFileSync(arq, Buffer.from(url.split(",")[1], "base64"));
    console.log("print:", arq);
  }
}

const novosConsole = consoleMsgs.slice(consoleAntes);
if (novosConsole.length) novosConsole.forEach(t => achado("console: " + t));
if (consoleMsgs.slice(0, consoleAntes).length) console.log("console ao abrir a página:", consoleMsgs.slice(0, consoleAntes));
console.log(`\n${comparados} montagens comparadas com ${REF}; ${achados.length} achado(s).`);
await sair(achados.length ? 1 : 0);
