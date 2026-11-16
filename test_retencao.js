"use strict";
// Personalizar (static/personalizar.js): o prazo das conversas da equipe (D3: 1 ano, a empresa só baixa para 90 ou 30
// dias). Só o admin do andar e só com config.equipe. Diminuir apaga o que passou do prazo: pede confirmação antes do POST.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const TELA = new Proxy(function () {}, { get: () => TELA, apply: () => TELA, set: () => true });
function elemento(id = "") {
  const e = {
    id, hidden: false, textContent: "", value: "", className: "", disabled: false, checked: false, type: "", href: "", name: "",
    dataset: {}, style: {}, attrs: {}, filhos: [], antes: [], depois: [], ouvintes: {},
    addEventListener(t, f) { (e.ouvintes[t] ||= []).push(f); },
    setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute: k => e.attrs[k] ?? null, removeAttribute(k) { delete e.attrs[k]; },
    replaceChildren(...f) { e.filhos = f; }, append(...f) { e.filhos.push(...f); }, prepend(...f) { e.filhos.unshift(...f); },
    before(...f) { e.antes.push(...f); }, after(...f) { e.depois.push(...f); }, replaceWith() {}, focus() {}, select() {},
    closest: () => elemento(), querySelector: () => elemento(), querySelectorAll: () => [], getContext: () => TELA,
    classList: { toggle() {}, add() {}, remove() {} },
  };
  return e;
}
const todos = (e, saida = []) => { for (const f of e.filhos || []) if (f && typeof f === "object") { saida.push(f); todos(f, saida); } return saida; };

function carregar(config) {
  const ids = new Map(), envios = [];
  const document = {
    getElementById: id => { if (!ids.has(id)) ids.set(id, elemento(id)); return ids.get(id); },
    createElement: () => elemento(), querySelector: () => null, querySelectorAll: () => [], body: elemento("body"),
  };
  const fetch = async (url, op = {}) => {
    if (op.method === "POST") envios.push({ url, corpo: JSON.parse(op.body) });
    const corpo = url.startsWith("api/canal/retencao") ? { retencao: JSON.parse(op.body).dias } : { usuario: "ana", avisos: { modo: "sempre" } };
    return { status: 200, ok: true, json: async () => corpo };
  };
  const contexto = {
    document, fetch, location: { hash: config.andar && config.andar !== "principal" ? `#andar=${config.andar}` : "", href: "" }, localStorage: null,
    window: { addEventListener() {} }, setTimeout() {}, clearTimeout() {}, matchMedia: () => ({ matches: true, addEventListener() {} }),
    Expediente: { abre: "09:00", fecha: "18:00" }, Avatar: { padrao: () => ({}), seletor: () => ({ valor: () => ({}) }) },
    aplicarCor() {}, contraste: () => 4.5, textoSobre: () => "#000", JSON, Promise,
  };
  vm.runInNewContext(fs.readFileSync("static/expediente.js", "utf8"), contexto);
  contexto.Andar = contexto.window.Andar;
  vm.runInNewContext(fs.readFileSync("static/personalizar.js", "utf8"), contexto);
  contexto.window.Personalizar.abrir(config);
  const form = document.getElementById("form-marca").depois[0];
  return { form, envios };
}
const espera = () => new Promise(r => setImmediate(r));
const opcoes = form => todos(form).filter(x => x.type === "radio");
const escolher = (form, dias) => opcoes(form).forEach(r => { r.checked = r.value === String(dias); });
const salvar = async form => { for (const f of form.ouvintes.submit) await f({ preventDefault() {} }); await espera(); };
const confirmacao = form => todos(form).find(x => x.dataset.papel === "confirmar");
const botao = (form, texto) => todos(form).find(x => x.textContent === texto);
const ID = "a1b2c3d4", EQUIPE = { retencao: 365, pode_moderar: true };

(async () => {
  // membro, ou sem as conversas da equipe: não aparece
  assert.equal(carregar({ andar: ID, papel: "membro", equipe: EQUIPE }).form, undefined);
  assert.equal(carregar({ andar: ID, papel: "admin", equipe: null }).form, undefined);
  // admin do andar: os três prazos, 1 ano marcado
  {
    const { form, envios } = carregar({ andar: ID, papel: "admin", admin_predio: false, equipe: { ...EQUIPE } });
    assert.ok(form, "o cartão aparece depois da marca");
    assert.deepEqual(opcoes(form).map(r => r.value), ["365", "90", "30"]);
    assert.equal(opcoes(form).find(r => r.checked).value, "365");
    // diminuir: primeiro a confirmação, sem POST
    escolher(form, 90); await salvar(form);
    assert.equal(envios.length, 0, "nada sai antes de confirmar");
    const caixa = confirmacao(form);
    assert.equal(caixa.hidden, false);
    assert.match(todos(caixa).map(x => x.textContent).join(" "), /apaga.*90 dias/);
    // cancelar volta para o prazo de agora
    botao(form, "Cancelar").ouvintes.click[0]();
    assert.equal(caixa.hidden, true);
    assert.equal(opcoes(form).find(r => r.checked).value, "365");
    // confirmar manda o POST do andar
    escolher(form, 90); await salvar(form);
    await botao(form, "Diminuir e apagar").ouvintes.click[0](); await espera();
    assert.deepEqual(envios, [{ url: `api/canal/retencao?andar=${ID}`, corpo: { dias: 90 } }]);
    assert.equal(caixa.hidden, true);
    // aumentar de volta (até 1 ano) não apaga nada: vai direto
    escolher(form, 365); await salvar(form);
    assert.deepEqual(envios[1].corpo, { dias: 365 });
    assert.equal(confirmacao(form).hidden, true);
    // sem cota no config (servidor de antes ou não é quem cuida do prazo): a linha fica escondida
    assert.equal(todos(form).find(x => x.dataset.papel === "cota").hidden, true);
  }
  // o admin do prédio no andar de uma empresa lê, mas não muda o prazo (pode_moderar false): sem o cartão
  assert.equal(carregar({ andar: ID, papel: "admin", equipe: { ...EQUIPE, pode_moderar: false } }).form, undefined);
  // a cota de anexos: a linha com o uso; a partir de 90%, o aviso
  {
    const GB = 1024 ** 3, linha = f => todos(f).find(x => x.dataset.papel === "cota");
    const baixa = linha(carregar({ andar: ID, papel: "admin", equipe: { ...EQUIPE, cota: { usado: 1.5 * GB, total: 5 * GB } } }).form);
    assert.equal(baixa.hidden, false);
    assert.equal(baixa.textContent, "Anexos: 1,5 GB de 5 GB usados.");
    assert.equal(baixa.attrs.role, undefined);
    const pouco = linha(carregar({ andar: ID, papel: "admin", equipe: { ...EQUIPE, cota: { usado: 3.2 * 1024 ** 2, total: 5 * GB } } }).form);
    assert.equal(pouco.textContent, "Anexos: 3,2 MB de 5 GB usados.");
    const cheia = linha(carregar({ andar: ID, papel: "admin", equipe: { ...EQUIPE, cota: { usado: 4.6 * GB, total: 5 * GB } } }).form);
    assert.match(cheia.textContent, /^Anexos: 4,6 GB de 5 GB usados\. A cota está quase cheia/);
    assert.equal(cheia.attrs.role, "alert");
    assert.match(cheia.className, /ruim/);
  }
  console.log("test_retencao.js ok");
})().catch(e => { console.error(e); process.exit(1); });
