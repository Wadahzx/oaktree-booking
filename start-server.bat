@echo off
title Oaktree Meeting Room Booking — Server
echo.
echo  ============================================
echo   Oaktree Meeting Room Booking Server
echo  ============================================
echo.
echo  Starting server on http://localhost:3000
echo  Admin panel:  http://localhost:3000/admin
echo  Admin code:   Fathima
echo.
echo  Keep this window open while using the app.
echo  Press Ctrl+C to stop the server.
echo.
cd /d "%~dp0"
node server.js
pause
