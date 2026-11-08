// Confere o Festas.lista(ano) do static/festas.js (as festas do menu de simulação) de 2025 a 2036 e as datas próprias:
// cada data da lista abre a festa certa no Festas.ativa() pela ?data=, toda festa que vale em algum dia do ano
// está na lista (e só uma vez) e ano inválido devolve lista vazia. Roda o festas.js de verdade, sem navegador.
// Uso: node ferramentas/checar_festas.js   (sai com 1 se algo falhar)
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

const ctx = { window: {}, location: { search: "" }, URLSearchParams, Intl, Date };   // o ativa() lê a ?data= a cada chamada
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "static", "festas.js"), "utf8"), ctx, { filename: "festas.js" });
const F = ctx.window.Festas, falhas = [];
const ativaEm = iso => { ctx.location.search = "?data=" + iso; return F.ativa(); };
const falha = msg => { if (falhas.length < 40) falhas.push(msg); };

const exemplo2026 = F.lista(2026).length;
for (let ano = 2025; ano <= 2036; ano++) {
  const lista = F.lista(ano), chaves = lista.map(f => f.chave);
  if (new Set(chaves).size !== chaves.length) falha(`${ano}: festa repetida na lista`);
  for (const f of lista) {
    const a = ativaEm(f.data);
    if (!f.data.startsWith(ano + "-")) falha(`${ano}: ${f.chave} em ${f.data}, fora do ano`);
    if (!a || a.chave !== f.chave || a.nome !== f.nome) falha(`${ano}: ${f.chave} em ${f.data} abre ${a ? a.chave : "nenhuma festa"}`);
  }
  // completa: as festas de todos os dias do ano
  const doAno = new Set();
  for (let ms = Date.UTC(ano, 0, 1); ms <= Date.UTC(ano, 11, 31); ms += 86400000) {
    const a = ativaEm(new Date(ms).toISOString().slice(0, 10));
    if (a) doAno.add(a.chave);
  }
  for (const k of doAno) if (!chaves.includes(k)) falha(`${ano}: ${k} vale no ano mas não está na lista`);
}
for (const ruim of [null, undefined, "abc", 1200, Infinity, -1]) if (F.lista(ruim).length) falha(`lista(${String(ruim)}) devolveu festas`);

// datas próprias (Festas.configurar): cobertura, virada de ano, 29/02, uma vez só, desligadas, tema e falas
F.configurar({ proprias: [
  { nome: "Aniversário da firma", data: "03-10", dias: 3, tema: "junina", falas: ["Parabéns, firma!"] },
  { nome: "Recesso", data: "12-30", dias: 5, tema: "nao_existe", falas: [] },
  { nome: "Bissexto", data: "02-29", dias: 1, tema: "natal", falas: [] },
  { nome: "Lançamento", data: "2027-08-20", dias: 2, tema: "generico", falas: [] },
], desligadas: ["halloween", "natal"] }, "#3b82f6");
const confere = (iso, esperado, rotulo) => { const a = ativaEm(iso), got = a ? a.nome : null; if (got !== esperado) falha(`${rotulo} (${iso}): ${got} em vez de ${esperado}`); return a; };
const aniv = confere("2026-03-10", "Aniversário da firma", "data própria no 1º dia");
if (!aniv || aniv.chave !== "propria" || aniv.tema !== "junina" || aniv.falas.join() !== "Parabéns, firma!" || !aniv.enfeites.includes("fogueira")) falha("data própria sem o tema ou as falas próprias");
confere("2026-03-12", "Aniversário da firma", "último dia coberto"); confere("2026-03-13", null, "dia seguinte");
const rec = confere("2027-01-02", "Recesso", "festa que vira o ano (do ano anterior)");
if (!rec || rec.tema !== "generico" || rec.cores[0] !== "#3b82f6" || rec.falas.length < 1) falha("tema desconhecido não virou o genérico nas cores da marca");
confere("2026-12-31", "Recesso", "data própria antes do Ano Novo do calendário"); confere("2027-01-04", null, "fim do recesso");
confere("2028-02-29", "Bissexto", "29/02 no bissexto"); confere("2027-03-01", null, "29/02 fora do bissexto não vira 01/03");
confere("2027-08-21", "Lançamento", "data de uma vez"); confere("2028-08-20", null, "data de uma vez no ano seguinte");
confere("2026-10-31", null, "Halloween desligado"); confere("2026-12-25", null, "Natal desligado"); confere("2026-09-07", "Independência do Brasil", "festa ligada");
const l27 = F.lista(2027);
if (l27.some(f => f.chave === "halloween") || !l27.some(f => f.nome === "Lançamento" && f.data === "2027-08-20") || l27.some(f => f.nome === "Bissexto")) falha("lista(2027) sem as próprias do ano ou com festa desligada");
if (!l27.filter(f => f.chave.startsWith("propria-")).every(f => ativaEm(f.data) && ativaEm(f.data).nome === f.nome)) falha("data própria da lista não abre ela mesma");
F.configurar({ proprias: [{ nome: "", data: "x" }, null, { nome: "ok", data: "13-45" }], desligadas: "tudo" });
if (ativaEm("2026-12-25")?.chave !== "natal" || F.lista(2026).length !== exemplo2026) falha("config torta mudou as festas");
F.configurar(null);

const exemplo = F.lista(2026);
console.log(`2026: ${exemplo.length} festas · ` + exemplo.map(f => `${f.nome} ${f.data.slice(8)}/${f.data.slice(5, 7)}`).join(", "));
if (falhas.length) { console.log(`FALHOU (${falhas.length}${falhas.length >= 40 ? "+" : ""}):\n  ` + falhas.join("\n  ")); process.exit(1); }
console.log("RESULTADO: tudo certo");
