//go:build !windows

package main

import "time"

// horaCriacao, fora do Windows, é a hora do começo do main.
func horaCriacao() time.Time { return time.Now() }
