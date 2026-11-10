@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Installez Node.js 22.13 ou plus recent : https://nodejs.org & pause & exit /b 1)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set MAJOR=%%v
if %MAJOR% LSS 22 (echo Node.js est trop ancien : il faut 22.13 ou plus recent. & pause & exit /b 1)
node deploy\doctor.js > "%TEMP%\eticket-doctor.txt" 2>&1
if errorlevel 1 (type "%TEMP%\eticket-doctor.txt" & echo. & echo Corrigez les points ci-dessus ^(voir DOCUMENTATION.md, section 17^), puis relancez. & pause & exit /b 1)
echo Serveur E-Ticket : lisez l'adresse affichee ci-dessous ^(Ouvrez ce site dans le navigateur^). Fermez cette fenetre pour arreter.
start "" http://localhost:3000
node --disable-warning=ExperimentalWarning server.js
pause
