import { registerPlugin } from "@capacitor/core";

// Подключаем наш Android-плагин (Java-файл VibrationControlPlugin) по имени
const VibrationControl = registerPlugin("VibrationControl");

// Что умеет мотор: { hasVibrator, hasAmplitudeControl, sdk }
export function getVibrationInfo() {
  return VibrationControl.getInfo();
}

// pattern — как раньше: [вибрация, пауза, вибрация, ...] в мс; strength — сила от 1 до 255
export function vibratePattern(pattern, strength) {
  const amplitudes = pattern.map((_, i) => (i % 2 === 0 ? strength : 0));
  return VibrationControl.vibratePattern({ timings: pattern, amplitudes });
}

// Свой узор: timings — длительности шагов в мс, amplitudes — сила каждого шага (0 = пауза, 1..255)
export function vibrateCustom(timings, amplitudes) {
  return VibrationControl.vibratePattern({ timings, amplitudes });
}
