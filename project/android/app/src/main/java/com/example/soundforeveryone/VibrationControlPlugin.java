package com.example.soundforeveryone;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

// Мост между JavaScript (наш сайт) и системным вибромотором Android.
// Имя "VibrationControl" должно совпадать с registerPlugin("VibrationControl") в src/vibration.js.
@CapacitorPlugin(name = "VibrationControl")
public class VibrationControlPlugin extends Plugin {

    private Vibrator getVibrator() {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager =
                (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return manager.getDefaultVibrator();
        }
        return (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
    }

    // Что умеет мотор этого телефона
    @PluginMethod
    public void getInfo(PluginCall call) {
        Vibrator vibrator = getVibrator();
        JSObject result = new JSObject();
        result.put("hasVibrator", vibrator.hasVibrator());
        result.put("hasAmplitudeControl", vibrator.hasAmplitudeControl());
        result.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    // Узор с разной силой: timings[i] — сколько мс длится шаг, amplitudes[i] — сила шага (0 = пауза, 1..255)
    @PluginMethod
    public void vibratePattern(PluginCall call) {
        JSArray timingsJs = call.getArray("timings");
        JSArray amplitudesJs = call.getArray("amplitudes");
        if (timingsJs == null || amplitudesJs == null || timingsJs.length() != amplitudesJs.length()) {
            call.reject("timings и amplitudes должны быть массивами одной длины");
            return;
        }

        try {
            int size = timingsJs.length();
            long[] timings = new long[size];
            int[] amplitudes = new int[size];
            for (int i = 0; i < size; i++) {
                timings[i] = timingsJs.getLong(i);
                amplitudes[i] = Math.max(0, Math.min(255, amplitudesJs.getInt(i)));
            }
            // repeat = -1: проиграть один раз, без повторения
            getVibrator().vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));
            call.resolve();
        } catch (JSONException e) {
            call.reject("Неверные данные: " + e.getMessage());
        }
    }
}
