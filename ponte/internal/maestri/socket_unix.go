//go:build !windows

package maestri

import (
	"os"
	"path/filepath"
	"syscall"
)

// acharSocket é o MAESTRI_SOCKET da ponte (rodando num terminal do Maestri) ou, no serviço, o
// <tmp>/maestri-*/maestri.sock mais novo. Só vale pasta e socket deste usuário, com a pasta
// fechada para os outros (0700): no /tmp, qualquer um cria uma pasta com esse nome.
func acharSocket() string {
	if s := os.Getenv("MAESTRI_SOCKET"); s != "" && socketMeu(s) {
		return s
	}
	var melhor string
	var quando int64
	for _, dir := range []string{os.TempDir(), "/tmp"} {
		achados, _ := filepath.Glob(filepath.Join(dir, "maestri-*", "maestri.sock"))
		for _, s := range achados {
			i, err := os.Lstat(s)
			if err != nil || !socketMeu(s) || !pastaMinha(filepath.Dir(s)) {
				continue
			}
			if t := i.ModTime().UnixNano(); melhor == "" || t > quando {
				melhor, quando = s, t
			}
		}
	}
	return melhor
}

// binarioSeguro: arquivo comum executável (seguindo o link), do root ou deste usuário e sem
// escrita para o grupo nem para os outros. Vale para o MAESTRI_CLI, o PATH e os caminhos fixos.
func binarioSeguro(c string) bool {
	i, err := os.Stat(c)
	if err != nil || !i.Mode().IsRegular() || i.Mode().Perm()&0o111 == 0 || i.Mode().Perm()&0o022 != 0 {
		return false
	}
	st, ok := i.Sys().(*syscall.Stat_t)
	return ok && (st.Uid == 0 || int(st.Uid) == os.Getuid())
}

func socketMeu(s string) bool {
	i, err := os.Lstat(s)
	if err != nil || i.Mode()&os.ModeSocket == 0 {
		return false
	}
	st, ok := i.Sys().(*syscall.Stat_t)
	return ok && int(st.Uid) == os.Getuid()
}

func pastaMinha(d string) bool {
	i, err := os.Lstat(d)
	if err != nil || !i.IsDir() || i.Mode().Perm()&0o077 != 0 {
		return false
	}
	st, ok := i.Sys().(*syscall.Stat_t)
	return ok && int(st.Uid) == os.Getuid()
}
