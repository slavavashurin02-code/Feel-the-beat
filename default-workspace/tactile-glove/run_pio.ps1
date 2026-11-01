# Сборка прошивки ESP32 через PlatformIO Core (CLI).
# Использует установленный в tools/pio PlatformIO и кэш в .platformio.
$proj = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = "C:\Users\Body\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
$env:PYTHONPATH = "$proj\tools\pio"
$env:PLATFORMIO_CORE_DIR = "$proj\.platformio"
& $python -m platformio run -d "$proj\esp32-wokwi" @args
