@echo off
cd /d "%~dp0"
title Mis Amores - Servidor de actualizaciones
echo Sirviendo actualizaciones para las otras PCs de la red...
echo No cierres esta ventana - si se cierra, las otras PCs dejan de encontrar actualizaciones nuevas.
echo.
call npm run actualizaciones:servir
echo.
echo El servidor se cerro. Podes cerrar esta ventana.
pause
