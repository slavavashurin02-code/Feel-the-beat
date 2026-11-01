#include <Arduino.h>
#include <ArduinoJson.h>

const int PIN_BEAT = 2;
const int FINGER_PINS[10] = {13, 12, 14, 27, 26, 25, 33, 32, 18, 19};

String rxBuffer = "";

// Маппинг символа (UTF-8 или ASCII) в 10-битную комбинацию пальцев (0..1023)
uint16_t charToFingerMask(const char* str) {
    if (str == nullptr || str[0] == '\0' || str[0] == ' ') {
        return 0; // Пауза или пробел — все пальцы выключены
    }
    uint8_t b0 = (uint8_t)str[0];
    uint16_t code = b0;
    // Если это двухбайтовая кириллица UTF-8 (0xD0 / 0xD1)
    if (b0 >= 0xC0 && str[1] != '\0') {
        uint8_t b1 = (uint8_t)str[1];
        code = ((b0 & 0x1F) << 6) | (b1 & 0x3F);
    }
    // Детерминированно раскладываем код буквы на 10 вибромоторов пальцев
    // (для реальной перчатки сюда можно подставить таблицу шрифта Брайля)
    uint16_t mask = (code * 2654435761UL) & 0x03FF;
    return (mask == 0) ? 1 : mask;
}

void applyFingers(uint16_t mask) {
    for (int i = 0; i < 10; i++) {
        digitalWrite(FINGER_PINS[i], (mask >> i) & 0x01 ? HIGH : LOW);
    }
}

void processPacket(const String& jsonLine) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, jsonLine);
    if (err) return;
    int beat = doc["b"] | 0;
    const char* ch = doc["c"] | "";
    digitalWrite(PIN_BEAT, beat ? HIGH : LOW);
    uint16_t mask = charToFingerMask(ch);
    applyFingers(mask);
}

void setup() {
    Serial.begin(115200);
    rxBuffer.reserve(128);
    pinMode(PIN_BEAT, OUTPUT);
    digitalWrite(PIN_BEAT, LOW);
    for (int i = 0; i < 10; i++) {
        pinMode(FINGER_PINS[i], OUTPUT);
        digitalWrite(FINGER_PINS[i], LOW);
    }
}

void loop() {
    while (Serial.available() > 0) {
        char c = (char)Serial.read();
        if (c == '\n') {
            processPacket(rxBuffer);
            rxBuffer = "";
        } else if (c != '\r') {
            rxBuffer += c;
        }
    }
    delay(5); // Разгружает процессор эмулятора Wokwi с 17% до 100% realtime
}
