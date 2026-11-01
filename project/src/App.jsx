import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { getVibrationInfo, vibrateCustom } from "./vibration.js";
import { MY_SONGS } from "./mySongs.js";
import AudioImport from "./AudioImport.jsx";

// ---------------------------------------------------------------------------
// Данные вибраций
// Каждая композиция — два списка одинаковой длины:
//   timings    — сколько миллисекунд длится шаг
//   amplitudes — сила шага: 0 = пауза, 1..255 = вибрация (255 — максимум)
// Шаги идут парами: вибрация, пауза, вибрация, пауза, ...
// ---------------------------------------------------------------------------

const repeat = (list, times) => Array.from({ length: times }, () => list).flat();
const sum = (list) => list.reduce((total, ms) => total + ms, 0);

// Браузерная вибрация знает только «вибрация, пауза, вибрация, пауза...» без силы.
// Здесь список «длительность + сила» превращается в такой вид: шаги с силой > 0 — вибрация, с силой 0 — пауза,
// соседние шаги одного вида склеиваются (так «удар + затухание» превращаются в один короткий удар).
function toWebPattern(timings, amplitudes) {
  const result = [];
  let currentlyOn = true; // узор в браузере всегда начинается с вибрации
  let accumulated = 0;
  timings.forEach((ms, i) => {
    const on = amplitudes[i] > 0;
    if (on === currentlyOn) {
      accumulated += ms;
    } else {
      result.push(accumulated);
      currentlyOn = on;
      accumulated = ms;
    }
  });
  result.push(accumulated);
  return result;
}

// 1. Проверка вибрации: три импульса (200, 200 и 400 мс) с паузами по 100 мс
const TEST_TIMINGS = [200, 100, 200, 100, 400];
const TEST_AMPLITUDES = [255, 0, 255, 0, 255];

// 2. Гимн России — «отбивание рукой». Официальный темп гимна — 76 четвертей в минуту, одна доля ≈ 789 мс.
// Каждая доля — один короткий резкий «шлепок» (как удар ладонью по ладони): сильный толчок и сразу слабое затухание, потом тишина.
// Первая доля такта — самый сильный удар, третья — средний, вторая и четвёртая — лёгкие.
// Это ритм-пульс гимна, а не ритм его мелодии: длительности нот мелодии нужно брать из нот или MIDI-файла.
// Шаги идут тройками: толчок, затухание, пауза до следующей доли (в сумме 789 мс).
const ANTHEM_BAR = [35, 25, 729, 25, 20, 744, 30, 22, 737, 25, 20, 744];
const ANTHEM_BAR_AMPLITUDES = [255, 120, 0, 170, 70, 0, 210, 90, 0, 170, 70, 0];
const ANTHEM_BARS = 4; // ~13 секунд

// 3. Duran Duran — Invisible. Приближение: темп около 114 ударов в минуту (одна восьмая ≈ 263 мс),
// клубный ритм с прямой бочкой. 255 — бочка, 200 — хлопок, 60 — лёгкий тактовый щелчок.
// Это не точная запись песни, а ритм в её темпе.
const INVISIBLE_BAR = [120, 143, 30, 233, 100, 163, 30, 233, 120, 143, 30, 233, 100, 163, 30, 233];
const INVISIBLE_BAR_AMPLITUDES = [255, 0, 60, 0, 200, 0, 60, 0, 255, 0, 60, 0, 200, 0, 60, 0];
const INVISIBLE_BARS = 7; // ~15 секунд

// Кнопки главного экрана. Чтобы добавить или заменить композицию — меняйте этот список.
const TRACKS = [
  {
    id: "test",
    title: "Проверка вибрации",
    subtitle: "Три коротких импульса",
    timings: TEST_TIMINGS,
    amplitudes: TEST_AMPLITUDES,
    accent: true, // жёлтая кнопка, чтобы выделялась среди композиций
  },
  {
    id: "anthem",
    title: "Гимн России",
    subtitle: "Отбивание рукой, около 13 секунд",
    timings: repeat(ANTHEM_BAR, ANTHEM_BARS),
    amplitudes: repeat(ANTHEM_BAR_AMPLITUDES, ANTHEM_BARS),
  },
  {
    id: "invisible",
    title: "Duran Duran — Invisible",
    subtitle: "Ритм песни, около 15 секунд",
    timings: repeat(INVISIBLE_BAR, INVISIBLE_BARS),
    amplitudes: repeat(INVISIBLE_BAR_AMPLITUDES, INVISIBLE_BARS),
  },
  // Две кнопки для ваших песен: сами комбинации пишутся в файле src/mySongs.js
  ...MY_SONGS.map((song, i) => {
    const timings = song.timings;
    // Если силу не задали, все вибрации (шаги с чётным номером) идут на полную силу
    const amplitudes = song.amplitudes ?? timings.map((_, step) => (step % 2 === 0 ? 255 : 0));
    return {
      id: `my-song-${i + 1}`,
      title: song.title,
      subtitle:
        timings.length === 0
          ? "Место для вашей комбинации"
          : `Около ${Math.max(1, Math.round(sum(timings) / 1000))} секунд`,
      timings,
      amplitudes,
    };
  }),
];

// Chrome в обычном браузере ограничивает длину узора, поэтому там берём только начало
const WEB_MAX_STEPS = 64;

// Столбики-«эквалайзер»: двигаются всё время
const BAR_COUNT = 14;
const bars = Array.from({ length: BAR_COUNT }, (_, i) => ({
  peak: 0.3 + 0.7 * Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21)),
  duration: 1.4 + (i % 5) * 0.25,
  delay: -(i * 0.17),
}));

const MESSAGES = {
  idle: "Выберите вибрацию и приложите телефон к ладони.",
  unsupported:
    "Этот браузер не поддерживает вибрацию. Откройте сайт в Chrome на Android-телефоне.",
  empty:
    "Здесь пока пусто. Впишите комбинацию в файл src/mySongs.js и пересоберите приложение.",
  badLength:
    "В этой песне списки timings и amplitudes разной длины. Они должны совпадать.",
  blocked:
    "Вибрация не включилась. Проверьте, что на телефоне не включён режим экономии заряда.",
};

export default function App() {
  const [playingId, setPlayingId] = useState(null); // какая кнопка сейчас играет
  const [run, setRun] = useState(0); // номер запуска: нужен, чтобы полоска прогресса стартовала заново при повторном нажатии
  const [problem, setProblem] = useState(null); // "unsupported" | "blocked" | null
  const [strength, setStrength] = useState(200); // общая сила вибрации, 1..255
  const [canControl, setCanControl] = useState(null); // умеет ли мотор менять силу: null — пока не знаем
  const [importedTrack, setImportedTrack] = useState(null); // песня, построенная из загруженного аудиофайла
  const timerRef = useRef(null);
  const isApp = Capacitor.isNativePlatform();

  // В приложении спрашиваем у телефона, умеет ли его мотор менять силу вибрации
  useEffect(() => {
    if (!isApp) return;
    getVibrationInfo()
      .then((info) => setCanControl(info.hasAmplitudeControl))
      .catch(() => {});
  }, [isApp]);

  const play = (track) => {
    setProblem(null);

    // Проверяем песни, которые пользователь вписывает сам
    if (track.timings.length === 0) {
      setProblem("empty");
      return;
    }
    if (track.amplitudes.length !== track.timings.length) {
      setProblem("badLength");
      return;
    }

    let started = true;
    let webPattern = null;

    if (isApp) {
      // Ползунок работает как общая громкость: все силы умножаются на его положение
      const scaled = track.amplitudes.map((a) => Math.round((a * strength) / 255));
      vibrateCustom(track.timings, scaled).catch(() => {
        setPlayingId(null);
        setProblem("blocked");
      });
    } else if ("vibrate" in navigator) {
      // В браузере силу задать нельзя, играем только ритм
      webPattern = toWebPattern(track.timings, track.amplitudes).slice(0, WEB_MAX_STEPS);
      started = navigator.vibrate(webPattern);
    } else {
      setProblem("unsupported");
      return;
    }

    if (!started) {
      setProblem("blocked");
      return;
    }

    const duration = sum(isApp ? track.timings : webPattern);
    setPlayingId(track.id);
    setRun((n) => n + 1);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPlayingId(null), duration);
  };

  // Остановка (нужна для длинных песен из файла)
  const stop = () => {
    clearTimeout(timerRef.current);
    setPlayingId(null);
    if (isApp) vibrateCustom([1], [0]).catch(() => {});
    else if ("vibrate" in navigator) navigator.vibrate(0);
  };

  const handleImported = (track) => {
    stop();
    setImportedTrack(track);
  };

  const visibleTracks = importedTrack ? [...TRACKS, importedTrack] : TRACKS;

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Feel the beat</h1>
      </header>

      {/* Декоративный элемент: скринридеру он не нужен */}
      <div className="viz" aria-hidden="true">
        {bars.map((bar, i) => (
          <span
            key={i}
            className="bar"
            style={{
              "--peak": bar.peak,
              "--dur": `${bar.duration}s`,
              "--delay": `${bar.delay}s`,
            }}
          />
        ))}
      </div>

      <AudioImport onTrack={handleImported} />

      <main className="tracks">
        {visibleTracks.map((track) => {
          const isPlaying = track.id === playingId;
          return (
            <button
              key={track.id}
              type="button"
              className={[
                "track",
                track.accent ? "track--accent" : "",
                isPlaying ? "is-playing" : "",
              ].join(" ")}
              style={{ "--track-dur": `${sum(track.timings)}ms` }}
              onClick={() => play(track)}
            >
              <span className="track__title">{track.title}</span>
              <span className="track__subtitle">{track.subtitle}</span>
              {/* Полоска прогресса: показывает глазами, сколько ещё идёт вибрация */}
              {isPlaying && <span key={run} className="track__progress" />}
            </button>
          );
        })}
      </main>

      <footer className="panel">
        {problem && <p className="panel__problem">{MESSAGES[problem]}</p>}
        {playingId && (
          <button type="button" className="stop" onClick={stop}>
            Стоп
          </button>
        )}
        {/* Регулятор силы работает только в Android-приложении */}
        {isApp && (
          <div className="strength">
            <label className="strength__label" htmlFor="strength">
              Сила вибрации: {Math.round((strength / 255) * 100)}%
            </label>
            <input
              id="strength"
              className="strength__range"
              type="range"
              min="1"
              max="255"
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
            />
            {canControl === false && (
              <p className="strength__hint">
                Мотор этого телефона не умеет менять силу, ползунок ни на что не влияет.
              </p>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
