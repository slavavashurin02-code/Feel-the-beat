package com. example.soundforeveryone;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Сообщаем Capacitor, что у нас есть собственный плагин.
        // Это нужно сделать ДО super.onCreate
        registerPlugin(VibrationControlPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
