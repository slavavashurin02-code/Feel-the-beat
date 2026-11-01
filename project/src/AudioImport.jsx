import { useRef, useState } from "react";
import { decodeToMono } from "./audioDecode.js";
import { detectBassBeats, beatsToVibration } from "./beatDetector.js";

// Блок «Свой файл»: выбираем аудио → audioDecode.js (моно 22050 Гц) → beatDetector.js (удары баса)
// → beatsToVibration (узор вибрации). Готовый узор отдаём наверх через onTrack в том же формате,
// что и остальные кнопки (id, title, subtitle, timings, amplitudes), поэтому App проигрывает его как обычную песню.
export default function AudioImport({ onTrack }) {
  const inputRef = useRef(null);
  const jobRef = useRef(0); // номер текущей обработки: если выбрали другой файл, старый результат игнорируем
  const [status, setStatus] = useState("idle"); // idle | decoding | analyzing | done | error
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // чтобы тот же файл можно было выбрать повторно
    if (!file) return;

    const job = ++jobRef.current;
    const stale = () => job !== jobRef.current;
    setProgress(0);
    setMessage(file.name);
    setStatus("decoding");

    try {
      const { samples, duration } = await decodeToMono(file);
      if (stale()) return;
      setStatus("analyzing");
      const { beats } = await detectBassBeats(samples, undefined, (share) => {
        if (!stale()) setProgress(share);
      });
      if (stale()) return;

      if (beats.length === 0) {
        setStatus("error");
        setMessage("В этом файле не нашлось ударов баса. Попробуйте другой трек.");
        return;
      }

      const { timings, amplitudes } = beatsToVibration(beats);
      const title = file.name.replace(/\.[^.]+$/, "");
      onTrack({
        id: "imported",
        title,
        subtitle: `${beats.length} ударов, около ${Math.round(duration)} сек`,
        timings,
        amplitudes,
      });
      setStatus("done");
      setMessage(`Готово: ${title}`);
    } catch {
      if (stale()) return;
      setStatus("error");
      setMessage("Не удалось прочитать файл. Подойдут mp3, wav, m4a, ogg.");
    }
  };

  const busy = status === "decoding" || status === "analyzing";
  const label =
    status === "decoding"
      ? "Читаю файл…"
      : status === "analyzing"
        ? `Ищу удары баса: ${Math.round(progress * 100)}%`
        : message;

  return (
    <div className="import">
      <input
        ref={inputRef}
        className="import__input"
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac"
        onChange={handleFile}
      />
      <button
        type="button"
        className="import__button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        Загрузить свой трек
      </button>
      {label && (
        <p className={`import__status ${status === "error" ? "is-error" : ""}`} role="status">
          {label}
        </p>
      )}
    </div>
  );
}
