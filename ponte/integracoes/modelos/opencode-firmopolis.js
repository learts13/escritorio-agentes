// Firmópolis: plugin global do OpenCode (firmopolis), vindo do Escritório Vivo.
// Manda os eventos de estado das sessões para a ponte local (127.0.0.1:47820), com o
// token do arquivo de config e o MAESTRI_TERMINAL_ID. Nunca bloqueia o OpenCode nem
// lança erro: envio sem await, tempo-limite de 1 s e falha silenciosa.
// Só os campos que a ponte usa saem daqui; conteúdo de arquivo, comando de permissão
// e texto de pergunta ficam no OpenCode.
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const URL_PONTE = "http://127.0.0.1:47820/evento/opencode"

const TIPOS = new Set([
  "session.created", "session.deleted", "session.status", "session.idle", "session.error",
  "permission.asked", "permission.v2.asked", "permission.replied", "permission.v2.replied",
  "question.asked", "question.v2.asked", "question.replied", "question.v2.replied",
  "question.rejected", "question.v2.rejected",
])

const ARGS_ALVO = ["filePath", "path", "command", "url"]

// a pasta da ponte: Firmopolis, ou a EscritorioVivo de quem ainda não rodou a ponte nova
function arquivosToken() {
  const base = process.platform === "win32" ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
    : process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
    : process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return [join(base, "Firmopolis", "token"), join(base, "EscritorioVivo", "token")]
}

function lerToken() {
  for (const arquivo of arquivosToken()) {
    try {
      const t = readFileSync(arquivo, "utf8").trim()
      if (t) return t
    } catch {}
  }
  return ""
}

function enviar(corpo) {
  const token = lerToken()
  if (!token) return
  try {
    fetch(URL_PONTE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ponte-Token": token,
        "X-Maestri-Terminal-Id": process.env.MAESTRI_TERMINAL_ID || "",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(1000),
    }).catch(() => {})
  } catch {
    // ponte desligada ou fetch indisponível: o OpenCode segue normalmente
  }
}

function resumir(p) {
  p = p || {}
  return {
    sessionID: p.sessionID ?? p.info?.id,
    status: p.status && { type: p.status.type },
    info: p.info && { id: p.info.id, parentID: p.info.parentID, directory: p.info.directory },
    error: p.error && { name: p.error.name },
  }
}

// argsDoAlvo guarda só os campos do alvo; do comando, só a 1ª linha.
function argsDoAlvo(args) {
  args = args || {}
  return Object.fromEntries(
    ARGS_ALVO.filter((k) => typeof args[k] === "string").map((k) => [k, k === "command" ? args[k].split("\n")[0] : args[k]]),
  )
}

export const Firmopolis = async ({ directory }) => {
  // opencode run é execução não interativa: não vira morador.
  if (process.argv.slice(1).includes("run")) return {}

  const pais = new Map() // sessão filha (subagente) → sessão pai

  // O pid do OpenCode deixa a ponte saber quando o processo saiu (não há evento de fim).
  const mandar = (type, properties) => {
    const pai = pais.get(properties.sessionID)
    enviar({ type, properties, cwd: directory, pid: process.pid, ...(pai && { pai }) })
  }

  return {
    event: async (entrada) => {
      try {
        const event = entrada?.event
        if (!TIPOS.has(event?.type)) return
        const p = resumir(event.properties)
        if (event.type === "session.created" && p.info?.parentID) pais.set(p.sessionID, p.info.parentID)
        mandar(event.type, p)
        if (event.type === "session.deleted") pais.delete(p.sessionID)
      } catch {
        // evento em formato inesperado: ignora, o OpenCode segue
      }
    },
    "tool.execute.before": async (input, output) => {
      try {
        mandar("tool.execute.before", { sessionID: input?.sessionID, tool: input?.tool, args: argsDoAlvo(output?.args) })
      } catch {
        // idem
      }
    },
  }
}
