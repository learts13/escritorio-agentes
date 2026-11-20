package processo

import (
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	processQueryLimitedInformation = 0x1000
	stillActive                    = 259
)

// Vivo diz se o processo pid existe e ainda não terminou. Acesso negado quer dizer
// que o processo existe (é protegido ou de outro usuário).
func Vivo(pid int) bool {
	vivo, _ := vivoEInicio(pid)
	return vivo
}

// Inicio devolve a hora em que o processo pid foi criado, em FILETIME (intervalos de
// 100 ns desde 1601), o mesmo número que o Claude grava em procStart. 0 quando não dá
// para saber.
func Inicio(pid int) uint64 {
	if pid <= 0 {
		return 0
	}
	h, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return 0
	}
	defer syscall.CloseHandle(h)
	return criacao(h)
}

// vivoEInicio responde Vivo e Inicio com um OpenProcess só (o VivoDesde roda para
// cada sessão a cada passo). Morto ou sem acesso, a hora é 0.
func vivoEInicio(pid int) (bool, uint64) {
	if pid <= 0 {
		return false, 0
	}
	h, err := syscall.OpenProcess(processQueryLimitedInformation, false, uint32(pid))
	if err != nil {
		return err == syscall.ERROR_ACCESS_DENIED, 0
	}
	defer syscall.CloseHandle(h)

	var codigo uint32
	if syscall.GetExitCodeProcess(h, &codigo) != nil || codigo != stillActive {
		return false, 0
	}
	return true, criacao(h)
}

func criacao(h syscall.Handle) uint64 {
	var criacao, saida, kernel, usuario syscall.Filetime
	if syscall.GetProcessTimes(h, &criacao, &saida, &kernel, &usuario) != nil {
		return 0
	}
	return uint64(criacao.HighDateTime)<<32 | uint64(criacao.LowDateTime)
}

type info struct {
	pai  int
	nome string
}

// validadeFoto é quanto a foto dos processos vale: com centenas de processos ela
// custa dezenas de ms, e uma rajada de hooks reaproveita a mesma.
const validadeFoto = 250 * time.Millisecond

var (
	muFoto   sync.Mutex
	foto     map[int]info
	tiradaEm time.Time
)

// consulta responde pai e nome por PID a partir de uma foto dos processos (Toolhelp),
// guardada por validadeFoto; fresca força uma foto nova.
func consulta(fresca bool) (func(pid int) (pai int, nome string, ok bool), error) {
	muFoto.Lock()
	defer muFoto.Unlock()
	if fresca || foto == nil || time.Since(tiradaEm) > validadeFoto {
		nova, err := tirarFoto()
		if err != nil {
			return nil, err
		}
		foto, tiradaEm = nova, time.Now()
	}
	tabela := foto
	return func(pid int) (int, string, bool) {
		p, ok := tabela[pid]
		return p.pai, p.nome, ok
	}, nil
}

func tirarFoto() (map[int]info, error) {
	foto, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer syscall.CloseHandle(foto)

	tabela := map[int]info{}
	var e syscall.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = syscall.Process32First(foto, &e); err == nil; err = syscall.Process32Next(foto, &e) {
		tabela[int(e.ProcessID)] = info{pai: int(e.ParentProcessID), nome: syscall.UTF16ToString(e.ExeFile[:])}
	}
	return tabela, nil
}

var (
	ntQueryInformationProcess = syscall.NewLazyDLL("ntdll.dll").NewProc("NtQueryInformationProcess")
	readProcessMemory         = syscall.NewLazyDLL("kernel32.dll").NewProc("ReadProcessMemory")
)

const (
	processQueryInformation = 0x0400
	processVMRead           = 0x0010
	// Deslocamentos num processo de 64 bits: PEB.ProcessParameters e, em
	// RTL_USER_PROCESS_PARAMETERS, Environment e EnvironmentSize.
	pebParametros         = 0x20
	parametrosAmbiente    = 0x80
	parametrosTamAmbiente = 0x3F0
	maxAmbiente           = 1 << 20
)

// lerProcesso é o ReadProcessMemory: se leu e quantos bytes. Os testes trocam.
var lerProcesso = func(h syscall.Handle, endereco uintptr, destino unsafe.Pointer, tam uintptr) (bool, uintptr) {
	var lidos uintptr
	ok, _, _ := readProcessMemory.Call(uintptr(h), endereco, uintptr(destino), tam, uintptr(unsafe.Pointer(&lidos)))
	return ok != 0, lidos
}

// sidPonte é o SID do usuário da ponte ("" sem como ler). Os testes trocam.
var sidPonte = sync.OnceValue(func() string {
	t, err := syscall.OpenCurrentProcessToken()
	if err != nil {
		return ""
	}
	defer t.Close()
	return sidDoToken(t)
})

// terminalNoAmbiente lê o VarTerminal do bloco de ambiente do processo pid, pela PEB.
// Só de um processo cujo dono é o usuário da ponte, e só com a ponte de 64 bits; o
// buffer é zerado no fim.
func terminalNoAmbiente(pid int) string {
	if unsafe.Sizeof(uintptr(0)) != 8 {
		return ""
	}
	h, err := syscall.OpenProcess(processQueryInformation|processVMRead, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer syscall.CloseHandle(h)
	if !mesmoDono(h) {
		return ""
	}

	var basica [6]uintptr // PROCESS_BASIC_INFORMATION; [1] é o PebBaseAddress
	if st, _, _ := ntQueryInformationProcess.Call(uintptr(h), 0, uintptr(unsafe.Pointer(&basica)), unsafe.Sizeof(basica), 0); st != 0 {
		return ""
	}
	parametros, ok := lerPonteiro(h, basica[1]+pebParametros)
	if !ok {
		return ""
	}
	bloco, ok1 := lerPonteiro(h, parametros+parametrosAmbiente)
	tam, ok2 := lerPonteiro(h, parametros+parametrosTamAmbiente)
	if !ok1 || !ok2 || bloco == 0 || tam < 4 || tam > maxAmbiente {
		return ""
	}
	buf := make([]uint16, tam/2)
	defer clear(buf)
	if !lerMemoria(h, bloco, unsafe.Pointer(&buf[0]), uintptr(len(buf)*2)) {
		return ""
	}
	return terminalNoBloco(buf)
}

// mesmoDono diz se o dono do processo h tem o SID do usuário da ponte.
func mesmoDono(h syscall.Handle) bool {
	var t syscall.Token
	if syscall.OpenProcessToken(h, syscall.TOKEN_QUERY, &t) != nil {
		return false
	}
	defer t.Close()
	sid := sidDoToken(t)
	return sid != "" && sid == sidPonte()
}

func sidDoToken(t syscall.Token) string {
	u, err := t.GetTokenUser()
	if err != nil {
		return ""
	}
	sid, err := u.User.Sid.String()
	if err != nil {
		return ""
	}
	return sid
}

func lerPonteiro(h syscall.Handle, endereco uintptr) (uintptr, bool) {
	var v uintptr
	return v, lerMemoria(h, endereco, unsafe.Pointer(&v), unsafe.Sizeof(v))
}

// lerMemoria só aceita a leitura inteira.
func lerMemoria(h syscall.Handle, endereco uintptr, destino unsafe.Pointer, tam uintptr) bool {
	ok, lidos := lerProcesso(h, endereco, destino, tam)
	return ok && lidos == tam
}
