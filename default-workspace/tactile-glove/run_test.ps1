# Быстрый тест без платы: генерирует test_song.wav/.srt и гоняет контроллер в Mock-режиме.
# (SDL_AUDIODRIVER=dummy — тихий режим, если нет звуковой карты; уберите строку, чтобы слышать бочку)
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = "C:\Users\Body\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
$env:PYTHONPATH = "$proj\libs"
$env:SDL_AUDIODRIVER = "dummy"
Push-Location $proj
try {
    & $python "$proj\generate_test_files.py"
    & $python "$proj\glove_controller.py" --audio "$proj\test_song.wav" --lyrics "$proj\test_song.srt" --mock
} finally {
    Pop-Location
}
