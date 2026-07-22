# NexaOps Agent — Instalador Windows (MSI)

Instalador MSI que registra o **NexaOps Agent** como serviço Windows para monitoramento contínuo de equipamentos.

## O que o MSI instala

- Agente Node.js + runtime em `C:\Program Files\NexaOps Agent\`
- Serviço Windows **NexaOpsAgent** (início automático)
- Configuração em `%ProgramData%\NexaOps Agent\config.json`
- Log em `%ProgramData%\NexaOps Agent\agent.log`

## Pré-requisitos para compilar

1. **WiX Toolset v3.14+**
   ```powershell
   winget install WiXToolset.WiXToolset
   ```
   Ou baixe em: https://wixtoolset.org/releases/

2. Conexão com internet (para baixar Node.js portable na primeira compilação)

## Compilar o MSI

Na raiz do monorepo:

```powershell
npm run build:agent-msi
```

Ou diretamente:

```powershell
cd apps/agent/installer
.\build-msi.ps1
```

Saída: `apps/agent/installer/dist/NexaOpsAgent.msi` (~35–45 MB)

## Instalar em um equipamento

Obtenha o token em **Administração → Organização**.

### Opção 1 — Linha de comando (admin)

```powershell
msiexec /i NexaOpsAgent.msi TOKEN=SEU_TOKEN API_URL=http://SEU_SERVIDOR:3001
```

### Opção 2 — Silencioso (GPO, PDQ Deploy, Intune)

```powershell
msiexec /i NexaOpsAgent.msi /qn TOKEN=SEU_TOKEN API_URL=http://SEU_SERVIDOR:3001
```

### Opção 3 — Pelo painel web

1. **Dispositivos → Instalar Agente**
2. Selecione **Windows**
3. Baixe o **MSI** ou o **Instalador .bat**

### Opção 4 — Script local

```powershell
cd apps/agent/installer
.\install-agent.bat SEU_TOKEN http://localhost:3001
```

## Verificar serviço

```powershell
Get-Service NexaOpsAgent
Get-Content "$env:ProgramData\NexaOps Agent\agent.log" -Tail 20
```

## Desinstalar

```powershell
msiexec /x NexaOpsAgent.msi /qn
```

Ou **Adicionar/Remover Programas** → NexaOps Agent.

## Assinatura Authenticode (SmartScreen)

Com certificado de código (.pfx ou thumbprint no store):

```powershell
$env:CODE_SIGN_PFX_PATH = "C:\certs\nexaops.pfx"
$env:CODE_SIGN_PFX_PASSWORD = "sua-senha"
npm run build:agent-msi   # assina automaticamente se as vars existirem

# Ou só assinar um MSI já gerado:
.\sign-msi.ps1
```

Sem certificado EV/OV o Windows pode exibir SmartScreen até o arquivo ganhar reputação de downloads.

## API de download

Com o MSI compilado e a API rodando:

- `GET /api/agent/download/windows?token=TOKEN` — download do MSI
- `GET /api/agent/download/windows/bootstrap?token=TOKEN` — script .bat automático
- `GET /api/agent/download/status` — verifica se o MSI foi compilado
