@echo off
REM Wrapper MSI: chama setup.js via node embutido (sem PowerShell).
set "INSTALLFOLDER=%~1"
set "TOKEN=%~2"
set "API_URL=%~3"
if "%API_URL%"=="" set "API_URL=https://nexaops.tdesksolutions.com.br"
if "%INSTALLFOLDER%"=="" set "INSTALLFOLDER=%~dp0.."
"%INSTALLFOLDER%\node.exe" "%~dp0setup.js" "%TOKEN%" "%API_URL%"
exit /b %ERRORLEVEL%
