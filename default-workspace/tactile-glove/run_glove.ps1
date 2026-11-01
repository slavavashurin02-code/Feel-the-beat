# Запуск контроллера тактильной перчатки.
# Примеры:
#   .\run_glove.ps1 --audio test_song.wav --lyrics test_song.srt --port wokwi
#   .\run_glove.ps1 --audio test_song.wav --lyrics test_song.srt --mock
#   .\run_glove.ps1 --audio test_song.wav --lyrics test_song.srt --gui
#   .\run_glove.ps1 --list-ports
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = "C:\Users\Body\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
$env:PYTHONPATH = "$proj\libs"
Push-Location $proj
try {
    & $python "$proj\glove_controller.py" @args
} finally {
    Pop-Location
}
