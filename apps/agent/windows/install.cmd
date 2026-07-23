@echo off
REM Wrapper: evita bloqueio de ExecutionPolicy ao instalar via MSI.
set "INSTALLFOLDER=%~1"
set "TOKEN=%~2"
set "API_URL=%~3"
if "%API_URL%"=="" set "API_URL=https://nexaops.tdesksolutions.com.br"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -InstallFolder "%INSTALLFOLDER%" -Token "%TOKEN%" -ApiUrl "%API_URL%"
exit /b %ERRORLEVEL%
