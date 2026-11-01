# Тактильная перчатка — Python-мозг + эмулятор ESP32 (Wokwi)

Стек из диалога с Gemini: Python-контроллер анализирует аудио (удары бочки/бита),
синхронизирует субтитры посимвольно и шлёт компактные JSON-пакеты (`{"b":1,"c":"А"}\n`)
в ESP32 по Serial. ESP32 управляет 1 вибромотором ладони (бит) и 10 вибромоторами пальцев (текст).

Поскольку платы под рукой нет — всё тестируется на эмуляторах:
**Wokwi** (VS Code + PlatformIO) и встроенный **--gui / --mock** режим на чистом Python.

## Структура проекта

```
tactile-glove/
├── glove_controller.py      # «Мозг»: DSP-анализ, субтитры, Serial, плеер (+ --gui)
├── generate_test_files.py   # Генератор test_song.wav (бочка 120 BPM) + test_song.srt
├── requirements.txt         # librosa, numpy, soundfile, pygame, pyserial
├── esp32-wokwi/             # Проект PlatformIO для эмулятора Wokwi
│   ├── platformio.ini       # esp32dev + ArduinoJson 7
│   ├── wokwi.toml           # rfc2217ServerPort = 4000
│   ├── diagram.json         # Схема: 1 красный LED ладони (GPIO2) + 10 LED пальцев
│   └── src/main.cpp         # Прошивка: приём JSON по Serial → маска 10 пальцев
└── libs/                    # (после установки) зависимости Python
```

## 1. Установка зависимостей Python

✅ **Уже выполнено** — зависимости установлены в `libs/`:
librosa 1.0.0, numpy 2.5.4, scipy 1.18.1, numba 0.68.1, scikit-learn 1.9.1,
soundfile 0.14.0, soxr 1.1.0, pygame 2.6.1, pyserial 3.5.

Повторная установка (вне песочницы достаточно `pip install -r requirements.txt`):

```powershell
$env:PYTHONPATH = "$PWD\libs"; $env:TMP = "$PWD\pip-tmp"; $env:TEMP = "$PWD\pip-tmp"
& "<python>" -m pip install --target libs librosa soundfile pygame pyserial
```

`libs/sitecustomize.py` — служебный патч для песочницы DSH (заменяет `tempfile.mkdtemp`
на эквивалент через `os.mkdir`; на обычной машине не нужен и не мешает).

## 2. Эмулятор ESP32 в Wokwi (VS Code)

1. Расширения VS Code **уже установлены** ✅: PlatformIO IDE v3.3.4 и Wokwi Simulator v4.1.0.
2. Откройте папку `esp32-wokwi` в VS Code, нажмите **PlatformIO: Build** (галочка внизу) —
   появится `.pio/build/esp32dev/firmware.bin`.
3. Откройте `diagram.json` и нажмите зелёную кнопку **Play** — Wokwi запустит
   виртуальную ESP32 и поднимет RFC2217-мост на `localhost:4000`.
   ⚠️ Вкладка симулятора в VS Code должна оставаться видимой, иначе симуляция
   встаёт на паузу (требование Wokwi).

Альтернатива без VS Code (CLI-сборка PlatformIO Core):

```powershell
$env:PYTHONPATH = "$PWD\tools\pio"
$env:PLATFORMIO_CORE_DIR = "$PWD\.platformio"
& "<python>" -m platformio run -d esp32-wokwi
```

## 3. Запуск Python-контроллера

```powershell
$env:PYTHONPATH = "$PWD\libs"
& "<python>" generate_test_files.py
& "<python>" glove_controller.py --audio test_song.wav --lyrics test_song.srt --port wokwi
```

- `--port wokwi` → подключается к эмулятору Wokwi (`rfc2217://localhost:4000`).
- `--port COM3` → реальная ESP32 по USB (список портов: `--list-ports`).
- `--mock` → пакеты печатаются в консоль без порта (авто-включение, если порт не открылся).
- `--gui` → встроенный графический эмулятор перчатки на pygame (ладонь + 10 пальцев).
- `--pulse 75` — длительность импульса бита, `--offset 15` — опережение (мс).

Проверка без звуковой карты (silent-тест):

```powershell
$env:SDL_AUDIODRIVER = "dummy"
& "<python>" glove_controller.py --audio test_song.wav --lyrics test_song.srt --mock
```

`<python>` — путь к интерпретатору, например `C:\Users\Body\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`.

## Протокол обмена

- Скорость: **115200 бод**. Каждый пакет — JSON без пробелов + `\n` (~14 байт, ~1.4 мс на пакет).
- `b` — состояние ладони (1 = удар бита, 0 = гашение через `--pulse` мс).
- `c` — текущий символ (кириллица/латиница, UTF-8); пустая строка = отпустить пальцы.
- На ESP32 символ раскладывается в детерминированную 10-битную маску пальцев
  (та же формула продублирована в `--gui` режиме Python-скрипта).

## Проверено

- ✅ `generate_test_files.py` → `test_song.wav` (бочка 120 BPM, 8 c) + `test_song.srt`.
- ✅ DSP-анализ находит ровно 15 ударов бочки в тестовом треке.
- ✅ `--mock` прогон: пакеты `{"b":1,"c":"П"}`…`{"b":0,"c":""}` уходят в правильном порядке,
  финальное гашение и закрытие порта отрабатывают.
- ✅ `--gui` режим запускается без ошибок (проверено с драйверами dummy).
- ✅ Расширения VS Code PlatformIO IDE + Wokwi Simulator установлены.
- ✅ **Прошивка собрана**: `esp32-wokwi/.pio/build/esp32dev/firmware.bin`
  (Flash 24.2%, RAM 6.8%; PlatformIO Core 6.2.0, espressif32 8.0.0, ArduinoJson 7.4.3).
- 💾 Диск C: был заполнен, поэтому хранилище PlatformIO живёт на диске **D:**
  (`D:\tactile-glove-pio\.platformio`), в проект и в профиль VS Code ведут ссылки-переходы
  (`tactile-glove\.platformio` и `C:\Users\Body\.platformio`).

Если `pio run` зависнет на скачивании пакета — просто повторите запуск:
`platformio run` докачает кэш с места разрыва, а `tools/seed_pio_cache.py`
заранее заливает все пакеты в кэш вручную.
