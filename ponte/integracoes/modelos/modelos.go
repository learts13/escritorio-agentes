// Package modelos guarda os arquivos que o `ponte setup` instala como estão.
package modelos

import _ "embed"

// PluginOpenCode é o plugin global do OpenCode (firmopolis.js).
//
//go:embed opencode-firmopolis.js
var PluginOpenCode []byte
