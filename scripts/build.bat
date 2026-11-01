@echo off
chcp 65001 >nul
rem
node "%~dp0build.js" %*
pause
