@echo off
setlocal
pushd "%~dp0" || exit /b 1

set "PYTHON_CMD="
py -3 -c "import http.server" >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3"
if defined PYTHON_CMD goto run
python -c "import http.server" >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=python"
if defined PYTHON_CMD goto run
python3 -c "import http.server" >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=python3"
if defined PYTHON_CMD goto run

echo Python 3 is required. Install it and run this file again.
pause
popd
exit /b 1

:run
echo Open http://127.0.0.1:4173 in your browser.
echo Press Ctrl+C to stop the server.
%PYTHON_CMD% -m http.server 4173 --bind 127.0.0.1
set "SERVER_EXIT=%ERRORLEVEL%"
if not "%SERVER_EXIT%"=="0" pause
popd
exit /b %SERVER_EXIT%
