import argparse
import json
import os
import queue
import re
import sys
import threading
import time
from dataclasses import dataclass
from typing import List, Optional

import librosa
import numpy as np
import serial
import serial.tools.list_ports

# Подавляем приветственное сообщение pygame в консоли
os.environ["PYGAME_HIDE_SUPPORT_PROMPT"] = "1"
import pygame


@dataclass
class LyricCharEvent:
    timestamp: float  # Время появления символа (в секундах)
    char: str         # Символ для отображения на пальцах


class AudioBeatAnalyzer:
    """Анализатор аудио для извлечения таймингов бочки (kick) и баса."""

    @staticmethod
    def extract_bass_beats(
        audio_path: str,
        fmax: int = 150,
        sensitivity: float = 0.25
    ) -> List[float]:
        print(f"[DSP] Загрузка и анализ аудиофайла: {audio_path}...")
        # Загружаем в моно с частотой 22050 Гц (оптимально для скорости анализа НЧ)
        y, sr = librosa.load(audio_path, sr=22050, mono=True)
        hop_length = 512
        # Вычисляем Мел-спектрограмму только в низкочастотном спектре (до fmax Гц)
        mel_spec = librosa.feature.melspectrogram(
            y=y,
            sr=sr,
            n_fft=2048,
            hop_length=hop_length,
            n_mels=8,
            fmin=20,
            fmax=fmax
        )
        # Строим огибающую энергии атак (onset strength) по басовому регистру
        onset_env = librosa.onset.onset_strength(
            S=librosa.power_to_db(mel_spec, ref=np.max),
            sr=sr,
            hop_length=hop_length,
            aggregate=np.median
        )
        # Детектируем пики (удары) с защитой от дребезга (wait=4 фрейма ~ 90 мс)
        onset_frames = librosa.onset.onset_detect(
            onset_envelope=onset_env,
            sr=sr,
            hop_length=hop_length,
            backtrack=False,
            delta=sensitivity,
            wait=4
        )
        # Если трек без выраженной бочки, делаем fallback на классический beat_track
        if len(onset_frames) == 0:
            print("[DSP] НЧ-удары не найдены, переключение на стандартный beat_track...")
            _, onset_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
        beat_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)
        print(f"[DSP] Найдено ударов бита: {len(beat_times)}")
        return beat_times.tolist()


class LyricsParser:
    """Парсер файлов субтитров (.srt и .lrc) с посимвольной интерполяцией."""

    SRT_BLOCK_REGEX = re.compile(
        r"(\d+)\s*\n"
        r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*"
        r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*\n"
        r"((?:.+\n?)+)",
        re.MULTILINE
    )
    LRC_LINE_REGEX = re.compile(r"\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)")

    @classmethod
    def parse(cls, lyrics_path: str, max_char_duration: float = 0.25) -> List[LyricCharEvent]:
        if not os.path.exists(lyrics_path):
            raise FileNotFoundError(f"Файл субтитров не найден: {lyrics_path}")
        ext = os.path.splitext(lyrics_path)[1].lower()
        with open(lyrics_path, "r", encoding="utf-8") as f:
            content = f.read()
        if ext == ".srt":
            phrases = cls._parse_srt(content)
        elif ext == ".lrc":
            phrases = cls._parse_lrc(content)
        else:
            raise ValueError(f"Неподдерживаемый формат субтитров: {ext}. Используйте .srt или .lrc")
        events = cls._interpolate_characters(phrases, max_char_duration)
        print(f"[Lyrics] Загружено фраз: {len(phrases)} | Посимвольных событий: {len(events)}")
        return events

    @classmethod
    def _parse_srt(cls, content: str) -> List[tuple]:
        phrases = []
        for match in cls.SRT_BLOCK_REGEX.finditer(content):
            h1, m1, s1, ms1 = map(int, match.groups()[1:5])
            h2, m2, s2, ms2 = map(int, match.groups()[5:9])
            raw_text = match.group(10)
            start_sec = h1 * 3600 + m1 * 60 + s1 + ms1 / 1000.0
            end_sec = h2 * 3600 + m2 * 60 + s2 + ms2 / 1000.0
            clean_text = cls._clean_text(raw_text)
            if clean_text and end_sec > start_sec:
                phrases.append((start_sec, end_sec, clean_text))
        return phrases

    @classmethod
    def _parse_lrc(cls, content: str) -> List[tuple]:
        raw_lines = []
        for line in content.splitlines():
            match = cls.LRC_LINE_REGEX.match(line.strip())
            if match:
                minutes = int(match.group(1))
                seconds = int(match.group(2))
                fraction_str = match.group(3) or "0"
                fraction = int(fraction_str) / (1000.0 if len(fraction_str) == 3 else 100.0)
                start_sec = minutes * 60 + seconds + fraction
                text = cls._clean_text(match.group(4))
                if text:
                    raw_lines.append((start_sec, text))
        raw_lines.sort(key=lambda x: x[0])
        phrases = []
        for i, (start_sec, text) in enumerate(raw_lines):
            # Если есть следующая строка, берем время до нее, иначе даем до 3 секунд
            if i + 1 < len(raw_lines):
                next_start = raw_lines[i + 1][0]
                end_sec = min(next_start - 0.05, start_sec + len(text) * 0.2)
            else:
                end_sec = start_sec + len(text) * 0.18
            if end_sec > start_sec:
                phrases.append((start_sec, end_sec, text))
        return phrases

    @staticmethod
    def _clean_text(text: str) -> str:
        # Убираем HTML-теги, переносы строк и лишние пробелы, приводим к верхнему регистру
        text = re.sub(r"<[^>]+>", "", text)
        text = re.sub(r"\s+", " ", text).strip().upper()
        return text

    @staticmethod
    def _interpolate_characters(phrases: List[tuple], max_char_duration: float) -> List[LyricCharEvent]:
        events: List[LyricCharEvent] = []
        for start_sec, end_sec, text in phrases:
            num_chars = len(text)
            if num_chars == 0:
                continue
            total_duration = end_sec - start_sec
            char_duration = min(total_duration / num_chars, max_char_duration)
            for idx, ch in enumerate(text):
                char_time = start_sec + idx * char_duration
                events.append(LyricCharEvent(timestamp=char_time, char=ch))
            # Добавляем пустой символ после окончания фразы, чтобы отпустить пальцы
            phrase_end_time = start_sec + num_chars * char_duration
            events.append(LyricCharEvent(timestamp=phrase_end_time, char=""))
        events.sort(key=lambda e: e.timestamp)
        return events


class SerialWorker:
    """Асинхронный потоковый передатчик данных в COM-порт."""

    def __init__(self, port: Optional[str], baudrate: int = 115200, mock: bool = False):
        self.port = port
        self.baudrate = baudrate
        self.mock = mock
        self.queue: queue.SimpleQueue = queue.SimpleQueue()
        self.running = False
        self.serial_conn: Optional[serial.Serial] = None
        self.thread: Optional[threading.Thread] = None

    def start(self):
        if not self.mock:
            try:
                # Если передан алиас 'wokwi', подключаемся к RFC2217 серверу эмулятора.
                # ВАЖНО: для rfc2217 pyserial не поддерживает write_timeout — не передаём его.
                if self.port.lower() == "wokwi":
                    target_port = "rfc2217://localhost:4000?ign_set_control"
                    self.serial_conn = serial.serial_for_url(
                        target_port, baudrate=self.baudrate, timeout=0
                    )
                else:
                    target_port = self.port
                    self.serial_conn = serial.serial_for_url(
                        target_port, baudrate=self.baudrate, timeout=0, write_timeout=0.05
                    )
                # Пауза на случай авто-перезагрузки ESP32 при открытии DTR/RTS
                time.sleep(1.5)
                self.serial_conn.reset_input_buffer()
                self.serial_conn.reset_output_buffer()
                print(f"[Serial] Подключено к {target_port}")
            except Exception as e:
                print(f"[Serial ОШИБКА] Не удалось открыть {self.port}: {e}")
                print("[Serial] Переключение в режим эмуляции (Mock Mode)...")
                self.mock = True
        else:
            print("[Serial] Запущен режим эмуляции (Mock Mode) без физического COM-порта")
        self.running = True
        self.thread = threading.Thread(target=self._worker_loop, daemon=True)
        self.thread.start()

    def send_state(self, beat_state: int, char_state: str):
        """Помещает пакет в очередь без блокировки аудиопотока."""
        self.queue.put((beat_state, char_state))

    def _worker_loop(self):
        while self.running:
            try:
                item = self.queue.get(timeout=0.1)
            except queue.Empty:
                continue
            if item is None:
                break
            beat_state, char_state = item
            # Компактный JSON без пробелов + \n как маркер конца пакета
            payload_str = json.dumps(
                {"b": beat_state, "c": char_state},
                separators=(",", ":"),
                ensure_ascii=False
            ) + "\n"
            if self.mock:
                # Каждый пакет с новой строки, чтобы поток был виден в консоли
                sys.stdout.write(f"[TX -> ESP32] {payload_str.strip()}\n")
                sys.stdout.flush()
            else:
                try:
                    self.serial_conn.write(payload_str.encode("utf-8"))
                except serial.SerialTimeoutException:
                    pass
                except serial.SerialException as e:
                    print(f"\n[Serial ОШИБКА] Потеря соединения: {e}")
                    self.mock = True

    def stop(self):
        self.running = False
        self.queue.put(None)
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.0)
        if self.serial_conn and self.serial_conn.is_open:
            # Гасим все вибромоторы перед выходом
            try:
                self.serial_conn.write(b'{"b":0,"c":""}\n')
                self.serial_conn.close()
            except Exception:
                pass
        print("\n[Serial] Соединение закрыто.")


class GloveGuiMonitor:
    """Графический эмулятор перчатки: ладонь (бит) + 10 пальцев (текст)."""

    FINGER_COLORS = [(0, 200, 255)] * 5 + [(50, 205, 50)] * 5
    FINGER_LABELS = ["L1", "L2", "L3", "L4", "L5", "R1", "R2", "R3", "R4", "R5"]

    def __init__(self, engine: "TactileGloveEngine"):
        self.engine = engine
        self.screen = None

    def start(self):
        pygame.init()
        self.screen = pygame.display.set_mode((520, 320))
        pygame.display.set_caption("Tactile Glove Emulator (Pygame)")
        self.font = pygame.font.SysFont("consolas", 20, bold=True)
        self.font_small = pygame.font.SysFont("consolas", 14)

    def draw(self):
        if not self.screen:
            return
        self.screen.fill((18, 22, 28))
        state = self.engine.state
        beat = state.get("b", 0)
        char = state.get("c", "")
        mask = self.engine.char_mask
        # Ладонь (бит)
        palm_color = (255, 60, 60) if beat else (70, 40, 40)
        pygame.draw.ellipse(self.screen, palm_color, (210, 110, 100, 130))
        pygame.draw.ellipse(self.screen, (30, 30, 30), (218, 118, 84, 114), 2)
        self._label("BEAT", (260, 168), (255, 255, 255))
        # Пальцы: левая рука (слева) и правая (справа), L1/R1 сверху
        for i in range(10):
            left_side = i < 5
            x = 60 + 38 * i if left_side else 422 - 38 * (9 - i)
            y = 40 + 52 * i if left_side else 40 + 52 * (i - 5)
            on = bool(mask & (1 << i))
            color = self.FINGER_COLORS[i] if on else (45, 50, 55)
            pygame.draw.ellipse(self.screen, color, (x - 15, y - 15, 30, 30))
            self._label(self.FINGER_LABELS[i], (x, y), (255, 255, 255))
        # Строка состояния
        self._label(f"char: {char!r}  mask: {mask:010b}", (260, 290), (200, 200, 200), self.font_small)

    def _label(self, text, center, color, font=None):
        font = font or self.font
        surf = font.render(text, True, color)
        rect = surf.get_rect(center=center)
        self.screen.blit(surf, rect)

    def close(self):
        if self.screen:
            pygame.display.quit()
            self.screen = None


class TactileGloveEngine:
    """Главный синхронизатор воспроизведения, битов и субтитров."""

    def __init__(
        self,
        audio_path: str,
        beats: List[float],
        lyrics: List[LyricCharEvent],
        serial_worker: SerialWorker,
        beat_pulse_ms: float = 75.0,
        latency_offset_ms: float = 0.0,
        gui: bool = False
    ):
        self.audio_path = audio_path
        self.beats = beats
        self.lyrics = lyrics
        self.serial_worker = serial_worker
        self.beat_pulse_sec = beat_pulse_ms / 1000.0
        self.latency_offset_sec = latency_offset_ms / 1000.0
        self.gui = gui
        self.state = {"b": 0, "c": ""}
        self.char_mask = 0

    @staticmethod
    def _char_to_mask(ch: str) -> int:
        """Детерминированная 10-битная маска символа (зеркало прошивки ESP32)."""
        if not ch or ch == " ":
            return 0
        b = ch.encode("utf-8")
        b0 = b[0]
        code = b0
        if b0 >= 0xC0 and len(b) > 1:
            code = ((b0 & 0x1F) << 6) | (b[1] & 0x3F)
        mask = (code * 2654435761) & 0x03FF
        return mask if mask else 1

    def run(self):
        # Инициализируем аудиомикшер с малым буфером (512 сэмплов) для минимальной задержки
        pygame.mixer.pre_init(frequency=44100, size=-16, channels=2, buffer=512)
        pygame.mixer.init()
        pygame.mixer.music.load(self.audio_path)
        gui_monitor = GloveGuiMonitor(self) if self.gui else None
        if gui_monitor:
            gui_monitor.start()
        beat_idx = 0
        lyric_idx = 0
        num_beats = len(self.beats)
        num_lyrics = len(self.lyrics)
        current_beat_state = 0
        current_char_state = ""
        beat_off_timestamp = 0.0
        print("\n[Engine] Старт воспроизведения! Нажмите Ctrl+C для остановки.")
        pygame.mixer.music.play()
        start_perf_time = time.perf_counter()
        last_draw = 0.0
        try:
            while pygame.mixer.music.get_busy():
                # Вычисляем точное время трека с учетом компенсации задержки
                now = (time.perf_counter() - start_perf_time) + self.latency_offset_sec
                state_changed = False
                # 1. Проверяем наступление нового удара бита
                if beat_idx < num_beats and now >= self.beats[beat_idx]:
                    current_beat_state = 1
                    beat_off_timestamp = now + self.beat_pulse_sec
                    state_changed = True
                    # Пропускаем возможные дубли, если цикл проскочил вперед
                    while beat_idx < num_beats and self.beats[beat_idx] <= now:
                        beat_idx += 1
                # 2. Автоматическое отключение вибромотора ладони после импульса (75 мс)
                if current_beat_state == 1 and now >= beat_off_timestamp:
                    current_beat_state = 0
                    state_changed = True
                # 3. Проверяем появление нового символа субтитров
                if lyric_idx < num_lyrics and now >= self.lyrics[lyric_idx].timestamp:
                    new_char = self.lyrics[lyric_idx].char
                    while lyric_idx < num_lyrics and self.lyrics[lyric_idx].timestamp <= now:
                        new_char = self.lyrics[lyric_idx].char
                        lyric_idx += 1
                    if new_char != current_char_state:
                        current_char_state = new_char
                        state_changed = True
                # 4. Отправляем пакет только при изменении состояния
                if state_changed:
                    self.state = {"b": current_beat_state, "c": current_char_state}
                    self.char_mask = self._char_to_mask(current_char_state)
                    self.serial_worker.send_state(current_beat_state, current_char_state)
                # 5. Отрисовка GUI-эмулятора ~30 FPS + обработка закрытия окна
                if gui_monitor:
                    for event in pygame.event.get():
                        if event.type == pygame.QUIT:
                            raise KeyboardInterrupt
                    t = time.perf_counter()
                    if t - last_draw >= 0.033:
                        gui_monitor.draw()
                        pygame.display.flip()
                        last_draw = t
                # Шаг цикла ~1 мс (1000 Гц опрос) без 100% загрузки ядра CPU
                time.sleep(0.001)
        except KeyboardInterrupt:
            print("\n[Engine] Остановка пользователем...")
        finally:
            pygame.mixer.music.stop()
            pygame.mixer.quit()
            if gui_monitor:
                gui_monitor.close()
            self.serial_worker.stop()


def list_serial_ports():
    ports = serial.tools.list_ports.comports()
    if not ports:
        print("Доступные COM-порты не обнаружены.")
    else:
        print("Доступные COM-порты в системе:")
        for p in ports:
            print(f"  - {p.device}: {p.description}")


def main():
    parser = argparse.ArgumentParser(
        description="Контроллер тактильной перчатки (Audio Beat + Lyrics -> ESP32 Serial)"
    )
    parser.add_argument("--audio", "-a", type=str, help="Путь к аудиофайлу (.mp3 или .wav)")
    parser.add_argument("--lyrics", "-l", type=str, help="Путь к файлу субтитров (.srt или .lrc)")
    parser.add_argument("--port", "-p", type=str, default="COM3",
                        help="COM-порт ESP32 (COM3, /dev/ttyUSB0) или 'wokwi' для эмулятора")
    parser.add_argument("--baud", "-b", type=int, default=115200,
                        help="Скорость порта (по умолчанию 115200)")
    parser.add_argument("--pulse", type=float, default=75.0,
                        help="Длительность вибрации бита на ладони в мс (по умолчанию 75)")
    parser.add_argument("--offset", type=float, default=15.0,
                        help="Опережение отправки в мс для компенсации инерции моторов (по умолчанию 15)")
    parser.add_argument("--mock", action="store_true",
                        help="Тестовый запуск без подключенной ESP32 (вывод пакетов в консоль)")
    parser.add_argument("--gui", action="store_true",
                        help="Открыть встроенный графический эмулятор перчатки (pygame)")
    parser.add_argument("--list-ports", action="store_true",
                        help="Показать список всех доступных COM-портов и выйти")
    args = parser.parse_args()

    if args.list_ports:
        list_serial_ports()
        sys.exit(0)
    if not args.audio or not args.lyrics:
        parser.error("Необходимо указать аргументы --audio и --lyrics (или используйте --list-ports)")

    # 1. Предварительный анализ аудио и парсинг текста
    beats = AudioBeatAnalyzer.extract_bass_beats(args.audio)
    lyrics_events = LyricsParser.parse(args.lyrics)
    # 2. Инициализация потока Serial-порта
    serial_worker = SerialWorker(port=args.port, baudrate=args.baud, mock=args.mock)
    serial_worker.start()
    # 3. Запуск синхронного плеера
    engine = TactileGloveEngine(
        audio_path=args.audio,
        beats=beats,
        lyrics=lyrics_events,
        serial_worker=serial_worker,
        beat_pulse_ms=args.pulse,
        latency_offset_ms=args.offset,
        gui=args.gui
    )
    engine.run()


if __name__ == "__main__":
    main()
