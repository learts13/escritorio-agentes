package main

import (
	"syscall"
	"time"
)

// horaCriacao é quando o agente criou este processo: a ordem dos spawns é a ordem dos
// eventos, coisa que o relógio no main já não garante (o arranque varia dezenas de ms).
func horaCriacao() time.Time {
	var criacao, saida, kernel, usuario syscall.Filetime
	h, err := syscall.GetCurrentProcess()
	if err != nil || syscall.GetProcessTimes(h, &criacao, &saida, &kernel, &usuario) != nil {
		return time.Now()
	}
	return time.Unix(0, criacao.Nanoseconds())
}
