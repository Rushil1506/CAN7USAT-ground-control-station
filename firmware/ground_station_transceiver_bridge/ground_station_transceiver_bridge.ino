// Ground Station Transceiver Bridge - Team 017
//
// WHY PIN 2 IS USED FOR Ra-08H RXD:
// On the Arduino Uno R3, Pin 0 (RX) has a 1 kOhm series resistor (RN4A) from the
// USB-serial chip, which cannot pull the Crowtail Ra-08H RXD pin (with its onboard
// pull-up + green RX LED) below the 0.8V logic-LOW threshold.
// Using Uno Pin 2 (direct 40mA CMOS output) drives Ra-08H RXD cleanly to 0.0V!
//
// WIRING (Slide switch on BOTH Ra-08H boards must be on BOOT / UART-RX):
//   Ra-08H TXD -> Uno Pin 1 (Receives telemetry & ACKs from CanSat -> USB Serial Monitor)
//   Ra-08H RXD -> Uno Pin 2 (Sends commands typed in Serial Monitor -> Ground Ra-08H -> CanSat)
//   Ra-08H 3.3V -> Uno 3.3V
//   Ra-08H GND  -> Uno GND
//
// Serial Monitor Settings: 115200 baud, Line Ending = "Both NL & CR" or "Newline"
// Commands to send from Ground Station:
//   1. GPS:<lat>,<lon>   (e.g. GPS:13.347500,74.792100 - sets Precision Landing Target)
//   2. START             (starts 1 Hz CanSat telemetry transmission)
//   3. STOP              (stops 1 Hz CanSat telemetry transmission)

static char cmdBuf[128];
static uint8_t cmdLen = 0;

// Cycle-exact 115200 baud (8N1) transmitter on Uno Pin 2 (PD2) at 16 MHz (138.89 cycles/bit)
static void sendBytePin2_115200(uint8_t b) {
  uint8_t sreg = SREG;
  cli();

  // Start bit (LOW)
  PORTD &= ~(1 << PD2);
  __builtin_avr_delay_cycles(134);

  // 8 data bits (LSB first)
  for (uint8_t i = 0; i < 8; i++) {
    if (b & 1) {
      PORTD |= (1 << PD2);
    } else {
      PORTD &= ~(1 << PD2);
    }
    b >>= 1;
    __builtin_avr_delay_cycles(127);
  }

  // 2 Stop bits (HIGH) for maximum receiver sync margin
  PORTD |= (1 << PD2);
  SREG = sreg;
  __builtin_avr_delay_cycles(276);
}

static void sendLineToLoRa(const char *str) {
  while (*str) {
    sendBytePin2_115200((uint8_t)(*str++));
    delayMicroseconds(25);
  }
  sendBytePin2_115200('\r');
  delayMicroseconds(25);
  sendBytePin2_115200('\n');
}

void setup() {
  // 1. Pre-charge Uno Pin 2 HIGH BEFORE setting as OUTPUT to prevent 0V glitch
  digitalWrite(2, HIGH);
  pinMode(2, OUTPUT);

  // 2. Enable hardware UART RX on Uno Pin 0 (reads commands from USB Serial Monitor at 115200)
  Serial.begin(115200);

  // 3. Disable ATmega328P hardware UART TX on Uno Pin 1 so Ground Ra-08H TXD
  //    drives Uno Pin 1 directly into the USB Serial Monitor without contention
  UCSR0B &= ~_BV(TXEN0);
  pinMode(1, INPUT);
}

void loop() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') {
      if (cmdLen > 0) {
        cmdBuf[cmdLen] = '\0';
        // Strip leading non-printable or whitespace
        char *p = cmdBuf;
        while (*p != '\0' && (uint8_t)*p <= ' ') p++;
        // Strip trailing non-printable or whitespace
        size_t len = strlen(p);
        while (len > 0 && (uint8_t)p[len - 1] <= ' ') {
          p[--len] = '\0';
        }
        if (len > 0) {
          sendLineToLoRa(p);
        }
        cmdLen = 0;
      }
    } else if ((uint8_t)c >= 32 && (uint8_t)c <= 126 && cmdLen < sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = c;
    }
  }
}
