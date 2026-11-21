package integracoes

import (
	"strings"
	"testing"
)

// O `ponte decidir`: um grupo síncrono só no PermissionRequest, no Claude Code e no Codex, que o
// desfazer também reconhece; o do estado (async) segue igual em todos os eventos.
func TestDecidirSoNoPermissionRequestESincrono(t *testing.T) {
	a := novoAmbiente(t)
	p := aplicar(t, a.op)

	claude := decodificar(t, a.ler(t, ".claude/settings.json")).(map[string]any)["hooks"].(map[string]any)
	for ev, lista := range claude {
		for _, g := range lista.([]any) {
			if grupoClaudeDecidirNosso(g) && ev != "PermissionRequest" {
				t.Errorf("Claude: decidir fora do PermissionRequest (%s)", ev)
			}
		}
	}
	pr := claude["PermissionRequest"].([]any)
	dec := pr[len(pr)-1].(map[string]any)["hooks"].([]any)[0].(map[string]any)
	if _, async := dec["async"]; async || dec["timeout"] != float64(130) || dec["command"] != a.op.Exe {
		t.Errorf("Claude decidir: %v", dec)
	}
	if args := dec["args"].([]any); len(args) != 4 || args[0] != "decidir" || args[3] != "claude" {
		t.Errorf("Claude decidir args: %v", args)
	}
	if !grupoClaudeNosso(pr[len(pr)-2]) {
		t.Error("Claude: o hook do estado segue no PermissionRequest")
	}

	codex := decodificar(t, a.ler(t, ".codex/hooks.json")).(map[string]any)["hooks"].(map[string]any)
	cpr := codex["PermissionRequest"].([]any)
	cdec := cpr[len(cpr)-1].(map[string]any)["hooks"].([]any)[0].(map[string]any)
	if _, async := cdec["async"]; async || cdec["timeout"] != float64(35) ||
		cdec["command"] != `'`+a.op.Exe+`' decidir --porta 47820 codex` || cdec["commandWindows"] != `& '`+a.op.Exe+`' decidir --porta 47820 codex` {
		t.Errorf("Codex decidir: %v", cdec)
	}
	// a versão anterior (sem --porta) também é nossa: o setup troca no lugar, sem duplicar
	if !grupoCodexDecidirNosso(map[string]any{"hooks": []any{map[string]any{"type": "command", "command": `'/x/ponte' decidir codex`}}}) {
		t.Error("decidir sem --porta não reconhecido")
	}
	if !grupoCodexNosso(cpr[len(cpr)-2]) {
		t.Error("Codex: o hook do estado segue no PermissionRequest")
	}
	for _, g := range cpr[:len(cpr)-1] {
		if grupoCodexDecidirNosso(g) {
			t.Error("Codex: decidir repetido")
		}
	}
	if !strings.Contains(strings.Join(p.Avisos, "\n"), "/hooks") {
		t.Errorf("o aviso de aprovar em /hooks do Codex: %v", p.Avisos)
	}
	for _, f := range []string{"onFailure", "updatedInput", "updatedPermissions", "interrupt", "setMode"} {
		if strings.Contains(a.ler(t, ".claude/settings.json"), f) || strings.Contains(a.ler(t, ".codex/hooks.json"), f) {
			t.Errorf("%s não entra nos hooks", f)
		}
	}

	// De novo: nada muda (o decidir não se repete).
	antesC, antesX := a.ler(t, ".claude/settings.json"), a.ler(t, ".codex/hooks.json")
	aplicar(t, a.op)
	if a.ler(t, ".claude/settings.json") != antesC || a.ler(t, ".codex/hooks.json") != antesX {
		t.Error("aplicar duas vezes mudou os hooks")
	}

	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	for _, arq := range []string{".claude/settings.json", ".codex/hooks.json"} {
		if final := a.ler(t, arq); strings.Contains(final, "decidir") {
			t.Fatalf("o desfazer tira o decidir de %s:\n%s", arq, final)
		}
	}
}
