@echo off
REM Instala o NexaOps Agent via MSI
REM Uso: install-agent.bat TOKEN API_URL

setlocal
if "%~1"=="" (
  echo Uso: install-agent.bat TOKEN [API_URL]
  echo Exemplo: install-agent.bat abc123 http://localhost:3001
  exit /b 1
)

set TOKEN=%~1
set API_URL=%~2
if "%API_URL%"=="" set API_URL=http://localhost:3001

set MSI=%~dp0dist\NexaOpsAgent.msi
if not exist "%MSI%" (
  echo MSI nao encontrado. Execute build-msi.ps1 primeiro.
  exit /b 1
)

echo Instalando NexaOps Agent...
msiexec /i "%MSI%" TOKEN=%TOKEN% API_URL=%API_URL%
exit /b %ERRORLEVEL%
