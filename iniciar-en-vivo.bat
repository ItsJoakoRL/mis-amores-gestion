@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
echo Levantando Mis Amores Gestion en modo desarrollo (con recarga en vivo)...
echo No cierres esta ventana negra mientras uses la app - si se cierra, se cierra la app.
echo.
call npm run dev
echo.
echo La app se cerro. Podes cerrar esta ventana.
pause
