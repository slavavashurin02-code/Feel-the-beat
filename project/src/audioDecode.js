import { ANALYSIS_RATE } from "./beatDetector.js";

// Читает аудиофайл (mp3, wav, m4a и др.), приводит к моно и частоте 22050 Гц.
// Всё делает сам браузер: декодирование и качественное понижение частоты.
export async function decodeToMono(file) {
  const bytes = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const context = new AudioCtx();
  let decoded;
  try {
    decoded = await context.decodeAudioData(bytes);
  } finally {
    if (context.close) context.close();
  }

  // Прогоняем через «офлайн-плеер» с нужной частотой и одним каналом: он сам сведёт стерео в моно
  const length = Math.ceil(decoded.duration * ANALYSIS_RATE);
  const offline = new OfflineAudioContext(1, length, ANALYSIS_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return { samples: rendered.getChannelData(0), duration: decoded.duration };
}
