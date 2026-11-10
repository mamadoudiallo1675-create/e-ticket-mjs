@echo off
REM E-Ticket MJS - lance la presentation (serveur Python HTTPS + moteur). Voir PRESENTATION.md
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3 est introuvable : https://www.python.org & pause & exit /b 1)
findstr /c:"eticket-mjs.local" "%SystemRoot%\System32\drivers\etc\hosts" >nul 2>nul || echo ATTENTION : ajoutez le domaine - ouvrez ce dossier dans une invite de commandes EN ADMINISTRATEUR et tapez : python live_server.py --installer-domaine
python live_server.py %*
pause
