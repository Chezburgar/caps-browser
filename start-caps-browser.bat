@echo off
title Capitals Browser
echo Starting Capitals Browser...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
echo.
echo Capitals Browser server has stopped.
pause
