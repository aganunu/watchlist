@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Кино-менеджер — локальный сервер

cd /d "%~dp0"
set "SERVER_SCRIPT=%~dp0tools\serve_local.py"
set "LOCAL_URL=http://127.0.0.1:8765/v6-beta15.html"
set "PYTHON_EXE="
set "PYTHON_ARGS="

py.exe -3 -c "import sys" >nul 2>&1
if not errorlevel 1 (
  set "PYTHON_EXE=py.exe"
  set "PYTHON_ARGS=-3"
)

if not defined PYTHON_EXE (
  python.exe -c "import sys" >nul 2>&1
  if not errorlevel 1 set "PYTHON_EXE=python.exe"
)

if not defined PYTHON_EXE (
  python3.exe -c "import sys" >nul 2>&1
  if not errorlevel 1 set "PYTHON_EXE=python3.exe"
)

if not defined PYTHON_EXE (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" set "PYTHON_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
)

if not defined PYTHON_EXE (
  echo Python 3 не найден. Установите Python 3 и повторите запуск.
  pause
  exit /b 1
)

for /f "delims=" %%U in ('""%PYTHON_EXE%" %PYTHON_ARGS% "%SERVER_SCRIPT%" --lan-url"') do set "LAN_URL=%%U"
if not defined LAN_URL set "LAN_URL=http://127.0.0.1:8765/v6-beta15.html"

"%PYTHON_EXE%" %PYTHON_ARGS% "%SERVER_SCRIPT%" --check >nul 2>&1
if not errorlevel 1 (
  echo Сервер Watchlist уже работает — второй экземпляр не запущен.
  echo.
  echo ПК:  %LOCAL_URL%
  echo LAN: %LAN_URL%
  echo.
  start "" "%LOCAL_URL%"
  echo Нажмите любую клавишу, чтобы закрыть это окно. Работающий сервер останется запущен.
  pause >nul
  exit /b 0
)

echo Запуск безопасного локального сервера Watchlist...
echo ПК:  %LOCAL_URL%
echo LAN: %LAN_URL%
echo.
"%PYTHON_EXE%" %PYTHON_ARGS% "%SERVER_SCRIPT%" --open-browser
set "SERVER_EXIT=%ERRORLEVEL%"

if not "%SERVER_EXIT%"=="0" (
  echo.
  echo Сервер не запущен. Возможно, порт 8765 занят другим приложением.
)
echo.
echo Нажмите любую клавишу, чтобы закрыть окно.
pause >nul
exit /b %SERVER_EXIT%
