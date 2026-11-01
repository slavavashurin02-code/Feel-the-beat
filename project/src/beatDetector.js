// ============================================================================
//  Детектор ударов баса: перенос алгоритма AudioBeatAnalyzer.extract_bass_beats
//  из проекта FeelTheBeat (Python + librosa) на JavaScript.
//
//  Шаги те же, что в описании «Этап 1» из вашего файла:
//   1. Звук приводится к моно, 22050 Гц (это делает audioDecode.js).
//   2. Оконное преобразование Фурье: окно 2048 отсчётов, шаг 512 (≈ 23,22 мс).
//   3. Мел-фильтры: 8 треугольных полос, только 20–150 Гц (бочка и бас).
//   4. Логарифм (децибелы) относительно самого громкого места трека.
//   5. «Огибающая атак»: на каждом кадре берётся рост громкости каждой полосы
//      по сравнению с предыдущим кадром, затем медиана по 8 полосам.
//   6. Поиск пиков: удар = локальный максимум огибающей выше порога,
//      после удара ~93 мс (4 кадра) «мёртвая зона», чтобы один удар не считался дважды.
//
//  Файл не зависит от браузера, поэтому его можно проверять и в Node.js.
// ============================================================================

export const ANALYSIS_RATE = 22050; // частота дискретизации, на которой считаем
const N_FFT = 2048; // длина окна
const HOP = 512; // шаг окна: 512 / 22050 ≈ 23,22 мс
const N_MELS = 8; // число мел-полос
const F_MIN = 20; // нижняя граница басового окна, Гц
const F_MAX = 150; // верхняя граница басового окна, Гц
const TOP_DB = 80; // всё тише «самого громкого − 80 дБ» считаем тишиной
const DEAD_ZONE_FRAMES = 4; // «мёртвая зона» после удара: 4 кадра ≈ 93 мс
const PEAK_HALF_WINDOW = 3; // пик должен быть максимумом среди ±3 кадров
const THRESHOLD_STD = 0.5; // порог = среднее + 0,5 × стандартное отклонение (см. примечание в ответе)

// ---------- Быстрое преобразование Фурье (FFT) ----------

function makeFft(n) {
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  return (re, im) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  };
}

// ---------- Мел-фильтры (8 треугольников между 20 и 150 Гц) ----------

const hzToMel = (f) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m) => 700 * (Math.pow(10, m / 2595) - 1);

function buildMelFilters(sampleRate) {
  const binHz = sampleRate / N_FFT; // ширина одной частотной корзины (≈ 10,77 Гц)
  const melMin = hzToMel(F_MIN);
  const melMax = hzToMel(F_MAX);
  const edges = [];
  for (let i = 0; i < N_MELS + 2; i++) {
    edges.push(melToHz(melMin + ((melMax - melMin) * i) / (N_MELS + 1)));
  }
  const filters = [];
  for (let m = 0; m < N_MELS; m++) {
    const lo = edges[m];
    const center = edges[m + 1];
    const hi = edges[m + 2];
    const bins = [];
    const weights = [];
    for (let j = Math.floor(lo / binHz); j <= Math.ceil(hi / binHz); j++) {
      const f = j * binHz;
      let w = 0;
      if (f > lo && f <= center) w = (f - lo) / (center - lo);
      else if (f > center && f < hi) w = (hi - f) / (hi - center);
      if (w > 0) {
        bins.push(j);
        weights.push(w);
      }
    }
    // Если полоса уже шага FFT и ни одной корзины не попало («Empty filters» в librosa) — берём ближайшую корзину
    if (bins.length === 0) {
      bins.push(Math.round(center / binHz));
      weights.push(1);
    }
    filters.push({ bins, weights });
  }
  return filters;
}

// ---------- Главная функция ----------

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * @param {Float32Array} samples  звук, моно, с частотой sampleRate
 * @param {number} sampleRate     по умолчанию 22050
 * @param {(share:number)=>void} onProgress  необязательно: доля готовности 0..1
 * @returns {Promise<{beats: {time:number, strength:number}[]}>}
 *   time — секунды от начала трека, strength — «сила» удара от 0 до 1
 */
export async function detectBassBeats(samples, sampleRate = ANALYSIS_RATE, onProgress) {
  const nFrames = 1 + Math.floor(samples.length / HOP);
  const fft = makeFft(N_FFT);
  const filters = buildMelFilters(sampleRate);

  const hann = new Float64Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);

  // 1. Мел-спектрограмма (мощность в 8 басовых полосах на каждом кадре)
  const mel = new Float64Array(nFrames * N_MELS);
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  let maxPower = 0;

  for (let t = 0; t < nFrames; t++) {
    const start = t * HOP - N_FFT / 2; // кадр центрирован на t * HOP
    for (let i = 0; i < N_FFT; i++) {
      const idx = start + i;
      re[i] = idx >= 0 && idx < samples.length ? samples[idx] * hann[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let m = 0; m < N_MELS; m++) {
      const { bins, weights } = filters[m];
      let sum = 0;
      for (let k = 0; k < bins.length; k++) {
        const b = bins[k];
        sum += weights[k] * (re[b] * re[b] + im[b] * im[b]);
      }
      mel[t * N_MELS + m] = sum;
      if (sum > maxPower) maxPower = sum;
    }
    if (t % 200 === 0) {
      if (onProgress) onProgress(t / nFrames);
      await tick(); // отдаём управление интерфейсу, чтобы экран не «замирал»
    }
  }

  if (maxPower <= 0) return { beats: [] }; // полная тишина

  // 2. Децибелы относительно самого громкого места (как power_to_db(ref=max, top_db=80))
  const db = new Float64Array(mel.length);
  for (let i = 0; i < mel.length; i++) {
    db[i] = Math.max(10 * Math.log10(Math.max(mel[i], 1e-10) / maxPower), -TOP_DB);
  }

  // 3. Огибающая атак: медиана по полосам положительного прироста громкости
  const onset = new Float64Array(nFrames);
  const diffs = new Array(N_MELS);
  for (let t = 1; t < nFrames; t++) {
    for (let m = 0; m < N_MELS; m++) {
      diffs[m] = Math.max(0, db[t * N_MELS + m] - db[(t - 1) * N_MELS + m]);
    }
    diffs.sort((a, b) => a - b);
    onset[t] = (diffs[N_MELS / 2 - 1] + diffs[N_MELS / 2]) / 2;
  }

  // 4. Порог: среднее + 0,5 × стандартное отклонение
  let mean = 0;
  for (let t = 0; t < nFrames; t++) mean += onset[t];
  mean /= nFrames;
  let variance = 0;
  for (let t = 0; t < nFrames; t++) variance += (onset[t] - mean) ** 2;
  const threshold = mean + THRESHOLD_STD * Math.sqrt(variance / nFrames);

  // 5. Поиск пиков + «мёртвая зона»
  const peaks = [];
  let lastPeak = -Infinity;
  for (let t = 1; t < nFrames; t++) {
    if (onset[t] <= threshold || onset[t] <= 0) continue;
    let isMax = true;
    for (let d = -PEAK_HALF_WINDOW; d <= PEAK_HALF_WINDOW; d++) {
      const u = t + d;
      if (u >= 0 && u < nFrames && onset[u] > onset[t]) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    if (t - lastPeak < DEAD_ZONE_FRAMES) continue;
    peaks.push(t);
    lastPeak = t;
  }

  let maxPeak = 0;
  for (const t of peaks) if (onset[t] > maxPeak) maxPeak = onset[t];

  return {
    beats: peaks.map((t) => ({
      time: (t * HOP) / sampleRate,
      strength: maxPeak > 0 ? onset[t] / maxPeak : 1,
    })),
  };
}

// ---------- Из ударов — в узор вибрации (формат timings + amplitudes) ----------

/**
 * @param beats  результат detectBassBeats
 * @param options.pulseMs   длина одного «шлепка» (в проекте FeelTheBeat — 75 мс)
 * @param options.leadMs    на сколько мс раньше включать мотор, чтобы компенсировать его разгон
 * @param options.minAmp    сила самого слабого удара (1..255)
 * @param options.maxAmp    сила самого сильного удара
 */
export function beatsToVibration(beats, options = {}) {
  const { pulseMs = 75, leadMs = 15, minAmp = 110, maxAmp = 255 } = options;
  const timings = [];
  const amplitudes = [];
  let cursor = 0; // сколько мс узора уже расписано

  for (let i = 0; i < beats.length; i++) {
    const start = Math.max(cursor, Math.round(beats[i].time * 1000 - leadMs));
    const nextStart =
      i + 1 < beats.length ? Math.round(beats[i + 1].time * 1000 - leadMs) : Infinity;
    // Импульс не должен «наезжать» на следующий удар
    const length = Math.max(20, Math.min(pulseMs, nextStart - start - 10));
    const pause = start - cursor;
    if (pause > 0) {
      timings.push(pause);
      amplitudes.push(0);
    }
    timings.push(length);
    amplitudes.push(Math.round(minAmp + (maxAmp - minAmp) * beats[i].strength));
    cursor = start + length;
  }
  return { timings, amplitudes };
}
