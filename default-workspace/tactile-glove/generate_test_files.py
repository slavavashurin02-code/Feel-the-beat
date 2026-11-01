import wave

import numpy as np


def create_test_files():
    sr = 44100
    duration = 8.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    audio = np.zeros_like(t)
    # Генерируем удары бочки (kick) каждые 0.5 сек (120 BPM)
    for beat_time in np.arange(0.5, duration, 0.5):
        idx = int(beat_time * sr)
        kick_len = int(0.15 * sr)
        if idx + kick_len < len(audio):
            kt = np.linspace(0, 0.15, kick_len)
            # Падающая частота 110 Гц -> 45 Гц (классический электронный kick)
            freq = np.linspace(110, 45, kick_len)
            envelope = np.exp(-25 * kt)
            audio[idx:idx + kick_len] += 0.9 * np.sin(2 * np.pi * freq * kt) * envelope
    audio_int16 = np.int16(np.clip(audio, -1.0, 1.0) * 32767)
    with wave.open("test_song.wav", "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(audio_int16.tobytes())
    srt_content = (
        "1\n00:00:00,500 --> 00:00:03,500\nПРИВЕТ МИР\n\n"
        "2\n00:00:04,000 --> 00:00:07,500\nТЕСТ ПЕРЧАТКИ\n"
    )
    with open("test_song.srt", "w", encoding="utf-8") as f:
        f.write(srt_content)
    print("Готово! Созданы файлы test_song.wav и test_song.srt")


if __name__ == "__main__":
    create_test_files()
