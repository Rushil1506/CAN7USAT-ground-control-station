# CAN-7USAT Continuous-Rotation Servo Actuator Integration & Safety Audit

**Project:** `2026-IN-SPACe-CAN-7USAT-017` (Team Parikshit)  
**Scope:** Onboard Parafoil Brake-Line Actuation (`CAN7USAT_FSW.ino`, `config.h`, `actuators.h`, `actuators.cpp`)  
**Hardware Configuration:** Two continuous-rotation servos winding left and right parafoil brake lines directly around M4 screws without position feedback sensors.

---

## Repository Status & Authoritative Source Policy

1. **Inspection of `flight-software-reference/` and Authoritative Baseline:**
   - The directory `groundstation/cansat-ground-control-station/flight-software-reference/` is the reference copy of `CAN7USAT_FSW.ino` stored inside the Ground Control Station (GCS) repository. The separate `Precision Landing Algo` repository was used only to share algorithm development and is **not** the authoritative flight software (left untouched).
   - The baseline reference files in `flight-software-reference/` are preserved untouched for audit traceability.
2. **Integrated Firmware Candidate (`flight-software-integrated/`):**
   - A complete, standalone, Teensy 4.1 PlatformIO-buildable integrated firmware candidate has been created in `groundstation/cansat-ground-control-station/flight-software-integrated/`, containing:
     - Reviewed and corrected `config.h`, `actuators.h`, `actuators.cpp`, and `CAN7USAT_FSW.ino`
     - Reconstructed `ekf.h` (which was missing from `flight-software-reference/`)
     - Unchanged GNC/state-machine files (`nav_types.h`, `nav_math.h`, `ekf.cpp`, `guidance.h`, `guidance.cpp`, `flight_sm.h`, `flight_sm.cpp`)
     - `platformio.ini` (verified with `pio run` for `teensy41` / `IMXRT1062`)
     - Unified diff `flight_software_integrated.patch` against `flight-software-reference/`
     - 19-category host C++17 verification suite in `flight-software-integrated/tests/test_integrated_fsw_actuators.cpp`

---

## Independent Code Review of Initial Proposal (`continuous-servo-integration-proposal/`)

An independent engineering review of the first proposal identified and fixed **8 problems** in `flight-software-integrated/`:

1. **Missing `ekf.h` Header Prevented Full Firmware Compilation:** `flight-software-reference/` omitted `ekf.h` while `CAN7USAT_FSW.ino` and `ekf.cpp` included `#include "ekf.h"`. Reconstructed `ekf.h` in `flight-software-integrated/` matching `ExtendedKalmanFilter` in `ekf.cpp`.
2. **Repurposed `LEFT_SERVO_DEG` / `RIGHT_SERVO_DEG` Telemetry Fields:** The first proposal stuffed a synthetic brake-effort surrogate (`90 * (1 - brake)`) into `LEFT_SERVO_DEG` and `RIGHT_SERVO_DEG`. In `flight-software-integrated/CAN7USAT_FSW.ino`, those misleading degree fields were replaced by explicit v2 continuous-rotation brake spool telemetry fields (`LEFT_BRAKE_CMD`, `RIGHT_BRAKE_CMD`, `LEFT_SPOOL_DIR`, `RIGHT_SPOOL_DIR`, `LEFT_SERVO_US`, `RIGHT_SERVO_US`, `LEFT_EST_PULL_MM`, `RIGHT_EST_PULL_MM`, `ACTUATOR_CAL`, `ACTUATOR_FAULT`).
3. **32-Bit `millis()` Rollover Bug:** Signed/direct comparison (`now_ms > last_update_ms`) failed across `0xFFFFFFFF -> 0x00000000`. Replaced with wrap-safe modular unsigned subtraction `elapsedMsWrapSafe(now_ms, past_ms)`.
4. **Artificial Truncation of Elapsed Travel Integration When Update Loop Is Delayed:** The first proposal truncated `active_dt_ms` to `remaining_burst_ms` and clamped `next_pull` to `target_pull_mm` inside `advanceChannelEstimate()`, under-counting physical line travel if a main-loop tick was delayed. Fixed so `advanceChannelEstimate()` integrates actual elapsed rotation time `dt_ms`, while `computeChannelCommand()` scales `speed_norm` and sets `planned_burst_ms` so normal 10 Hz steps land on target without overshooting.
5. **False Neutral Assumption & Unbounded Open-Loop Drift Under Alternating Turns:** Returning `estimated_line_pull_mm` to `0.0` does not mean physical neutral has been verified. Added `neutral_position_verified` (`isLeftNeutralVerified()` / `isRightNeutralVerified()`, which becomes `false` after any open-loop motion), `cumulative_travel_mm`, and `estimated_uncertainty_mm` (`15%` of cumulative travel), latching `ActuatorFaultCode::OPEN_LOOP_DRIFT_LIMIT` when `estimated_uncertainty_mm >= max_uncertainty_mm`.
6. **Main-Loop-Coupled Watchdog Vulnerability (`loop()` Stall):** Because Teensy 4.1 FlexPWM hardware continues generating the last pulse in silicon even if `loop()` blocks on I2C or SD card I/O, a software-only check inside `loop()` cannot stop a spinning continuous-rotation servo during a stall. Added a Teensy 4.1 hardware `IntervalTimer` ISR (`servoSafetyTimerIsr` every `10 ms` calling `onHardwareTimerTick(isr_now_ms)`) that enforces `planned_burst_ms`, `max_burst_duration_ms`, and `command_timeout_ms` (`LOOP_STALL_ISR_CUTOFF`) in interrupt context.
7. **Stale `has_command_timestamp` Across Disabled State Transitions:** Cleared `has_command_timestamp = false` whenever steering is disabled or in a prohibited flight state.
8. **Hardware PWM Callback Testability:** Added `setPwmWriteCallback()` so host unit tests verify exact microsecond pulse writes to `SERVO_LEFT_PIN` and `SERVO_RIGHT_PIN`.

---

## A. What the Existing Code Assumed vs. What the Updated Code Does

### 1. Existing Positional-Servo Assumptions (`flight-software-reference/actuators.cpp`)

The original `ActuatorManager` (`actuators.h`, `actuators.cpp`, `config.h`) was written for standard positional hobby servos (`0°..90°`):

| Aspect | Original Positional-Servo Implementation | Physical Effect on Actual Continuous-Rotation M4 Screw Hardware |
| :--- | :--- | :--- |
| **Control Variable** | `brake_to_servo()` mapped normalized brake `[0.0, 1.0]` to an angle `90.0° -> 0.0°` (`SERVO_NEUTRAL_ANGLE = 90.0f`, `SERVO_MAX_BRAKE_ANGLE = 0.0f`). | A continuous-rotation servo has no internal potentiometer feedback loop; PWM pulse width controls **rotational angular velocity**, not shaft angle. |
| **PWM Pulse Mapping** | `angleToEs3004PulseUs()` mapped `[0°, 90°]` linearly to `[500 µs, 1500 µs]`. | Under any sustained turn command (e.g. `steering = +0.5 -> 1000 µs` at 10 Hz), the servo **spins continuously at ~50% speed forever**, winding the brake line around the M4 screw indefinitely until the line snaps, the canopy stalls, or the servo stalls/browns out the 5V rail. |
| **Angle Slew Limiter** | `hwLeftAngle` / `hwRightAngle` stepped by `6.0°` every `50 ms` between `90°` and `0°`. | Instead of slewing position, this ramped motor speed over `750 ms` and then held full rotational speed (`500 µs`) indefinitely. Worse, when returning from `0°` (`500 µs`) toward `90°` (`1500 µs`), every intermediate pulse (`566..1433 µs`) was still `< 1500 µs`, **continuing to wind the brake line even tighter while "returning to neutral."** |
| **Brake Line Release (Unwinding)** | Returning `steering` to `0.0` commanded `90°` (`1500 µs`). Pulses `> 1500 µs` were never generated anywhere in the code. | `1500 µs` merely stops the motor shaft at its current wound-up position. Because reverse pulses (`> 1500 µs`) were never generated, **a wound brake line could never be unwound/released**, locking the parafoil in a permanent turn. |
| **Startup / Neutral Pulse** | Hardcoded `1500 µs` (`ES3004_NEUTRAL_PULSE_US`) and unverified `500 µs` minimum pulse. | Continuous-rotation servos exhibit unit-to-unit stop deadband offsets (typically `1470–1530 µs`). Hardcoding `1500 µs` without per-unit calibration causes continuous slow creep of the M4 screw during flight. |
| **Loop Blocking & Fault Handling** | Called blocking `delay(25)` inside `applySteering()` on initial attach; `steering_to_brakes(NAN)` silently evaluated to `0.0` without flagging a fault; no activation duration cap or stale-command timeout existed. | Stale GNC updates or manual LoRa override commands (`'L'` / `'R'`) could spin the motor indefinitely. |

### 2. What the Updated Continuous-Rotation Spool Controller Does

The updated `ActuatorManager` (`continuous-servo-integration-proposal/actuators.h` and `actuators.cpp`) preserves the entire upstream GNC architecture (`MS5611 / BNO055 / NEO-M9N -> EKF -> WindEstimator -> WaypointManager / LoiterGuidance / Breakout -> PID -> steering in [-1.0, +1.0]`) while replacing the actuator layer with a **calibration-gated, bounded open-loop continuous-rotation spool controller**:

1. **Explicit Separation of Physical Quantities:**
   - `requested_steering_effort` (`[-1.0, +1.0]`)
   - `target_brake_norm` (`left` and `right` in `[0.0, 1.0]`)
   - `SpoolDirection` (`STOP`, `WIND_BRAKE`, `RELEASE_BRAKE`)
   - `commanded_speed_norm` (`[0.0, 1.0]`) and `commanded_pulse_us` (`uint16_t` microseconds)
   - `current_burst_ms` (`uint32_t` active burst duration) and `cooldown_remaining_ms`
   - `estimated_line_pull_mm` (`float`, open-loop dead-reckoned line displacement in `mm`; `NAN` when uncalibrated)
   - `actual_position_known` (`bool`, **always `false`** on current sensorless hardware)
2. **Uncalibrated Default Lockout (`ACTUATOR_CALIBRATED = 0`):**
   - Because physical neutral pulses, winding polarities, loaded rotational rates, and effective M4 screw line travel per revolution have not yet been measured on the bench, `ACTUATOR_CALIBRATED` defaults to `0` (`false`).
   - While uncalibrated (or if any calibration parameter fails `validateSystemCalibration()`), `ActuatorManager` keeps both servo channels detached (`0 µs`), sets `ActuatorFaultCode::UNCALIBRATED` (or `INVALID_CALIBRATION`), and prevents any motor rotation.

---

## B. How the Updated Actuator Control Works Physically

1. **Target Brake Pull vs. Open-Loop Estimated Pull:**
   - When calibrated (`isCalibrated() == true`), a normalized brake command $b_{\text{target}} \in [0, 1]$ maps to a desired open-loop brake-line pull distance:
     $$L_{\text{target}} = b_{\text{target}} \cdot L_{\text{max\_pull\_mm}}$$
   - On each update step $\Delta t$, the controller integrates the open-loop estimated pull $L_{\text{est}}$ from the previous step's active command:
     $$\Delta L_{\text{est}} = u_{\text{speed}} \cdot \omega_{\text{max\_rev\_s}} \cdot p_{\text{mm\_per\_rev}} \cdot \Delta t$$
     adding $\Delta L_{\text{est}}$ during `WIND_BRAKE` and subtracting $\Delta L_{\text{est}}$ during `RELEASE_BRAKE` (clamped to $[0, L_{\text{max\_pull\_mm}}]$).
2. **Bounded Winding (`SpoolDirection::WIND_BRAKE`):**
   - When $L_{\text{target}} - L_{\text{est}} > \varepsilon_{\text{deadband}}$, the channel rotates in its configured `wind_polarity` direction (`+1` or `-1` relative to `neutral_pulse_us`).
   - As $L_{\text{est}}$ approaches $L_{\text{target}}$, motor speed tapers proportionally. Once $|L_{\text{target}} - L_{\text{est}}| \le \varepsilon_{\text{deadband}}$ (or $L_{\text{est}}$ reaches `max_pull_mm`), the motor **automatically transitions to `SpoolDirection::STOP` (`neutral_pulse_us`) and holds**, even if the 10 Hz PID controller continues commanding the same steering value.
3. **Bounded Unwinding / Brake Release (`SpoolDirection::RELEASE_BRAKE`):**
   - When the steering command decreases or returns to `0.0`, $L_{\text{target}} < L_{\text{est}} - \varepsilon_{\text{deadband}}$.
   - The controller commands `SpoolDirection::RELEASE_BRAKE` using the **opposite** pulse polarity (`-wind_polarity`) for the bounded duration required for $L_{\text{est}}$ to return to $L_{\text{target}}$ (or `0.0 mm`), then transitions to `SpoolDirection::STOP` (`neutral_pulse_us`).
   - Release integration is strictly clamped at `0.0 mm` so the motor never unwinds past estimated zero brake, reducing the risk of slack line tangling or reverse-wrapping onto the M4 screw.
4. **Hard Safety Barriers (Independent of Guidance):**
   - **Per-Burst Duration Cap (`max_burst_duration_ms = 400 ms`):** No single continuous rotation burst may exceed `max_burst_duration_ms`. Reaching the cap immediately forces `SpoolDirection::STOP` (`neutral_pulse_us`), latches `ActuatorFaultCode::MAX_BURST_EXCEEDED`, and enforces a mandatory `min_cooldown_ms` (`150 ms`) pause.
   - **Stale-Command Watchdog (`command_timeout_ms = 300 ms`):** If `update(now_ms)` detects that no fresh steering command has arrived within `300 ms` (3x the 10 Hz control period), both servos are immediately stopped at `neutral_pulse_us` with `ActuatorFaultCode::STALE_COMMAND`.
   - **Flight-State Gating:** Steering is permitted **only** in `PRECISION_GUIDANCE`, `TERMINAL_GUIDANCE`, and `FINAL_APPROACH`. In `BOOT`, `LAUNCH_PAD`, `ASCENT`, `DROGUE_DESCENT`, `PARAFOIL_DEPLOYMENT`, `LANDING`, and `FAILSAFE`, both servos are immediately stopped and detached (`0 µs`).

---

## C. Step-by-Step Pre-Flight Bench Calibration Procedure

Do **not** set `ACTUATOR_CALIBRATED` to `1` in `config.h` until all steps below have been executed and recorded on the actual flight hardware:

1. **Disconnect Brake Lines Before Initial Power-Up:**
   - Mechanically disconnect both parafoil brake lines from the M4 screws so the screws can spin freely without fouling rigging or damaging the canopy.
2. **Verify Servo Model & 5V Power Rail Integrity:**
   - Record the exact continuous-rotation servo part number and stall current rating.
   - Verify with an oscilloscope/multimeter on the 5V BEC rail and Teensy `VBAT_PIN` (`A0`) that stalling or reversing one or both servos does not cause a voltage dip that resets the Teensy 4.1 or browns out the Ra-08H LoRa transceiver.
3. **Calibrate Neutral Stop Pulse & Deadband (`SERVO_*_NEUTRAL_US`, `SERVO_*_DEADBAND_US`):**
   - Command test pulses in `1 µs` increments across `1450..1550 µs` on Pin 2 (Left) and Pin 3 (Right).
   - For each servo, record the lower pulse $P_{\text{stop,low}}$ where reverse creep stops and the upper pulse $P_{\text{stop,high}}$ where forward creep begins.
   - Set:
     $$\text{neutral\_pulse\_us} = \text{round}\left(\frac{P_{\text{stop,low}} + P_{\text{stop,high}}}{2}\right), \quad \text{neutral\_deadband\_us} = \left\lceil\frac{P_{\text{stop,high}} - P_{\text{stop,low}}}{2}\right\rceil + 5\,\mu\text{s}$$
4. **Determine Winding Polarity (`SERVO_*_WIND_POLARITY`) & Safe Pulse Bounds:**
   - Observe the M4 screw rotation for a pulse slightly above neutral (`neutral_pulse_us + 80 µs`) vs. below neutral (`neutral_pulse_us - 80 µs`).
   - Set `wind_polarity = +1` if `pulse > neutral_pulse_us` winds (shortens) the brake line in its flight routing, or `-1` if `pulse < neutral_pulse_us` winds the brake line.
   - Verify the safe electrical pulse limits (`min_pulse_us` $\ge 1000\,\mu\text{s}$, `max_pulse_us` $\le 2000\,\mu\text{s}$) and choose conservative `max_wind_delta_us` and `max_release_delta_us` (typically `250..350 µs`).
5. **Measure Effective Line Travel per Revolution (`SERVO_*_MM_PER_REV`) Under Tension:**
   - Attach the actual braided brake line to the M4 screw and apply representative aerodynamic line tension (e.g., `2–5 N` hanging mass or spring scale).
   - Command exactly $N = 5$ revolutions in the `WIND_BRAKE` direction and measure the linear brake-line displacement $\Delta L$ in millimeters with calipers/ruler.
   - Compute `mm_per_revolution` $= \Delta L / N$.
   - *Note:* Do **not** calculate `mm_per_revolution` theoretically from the bare M4 major diameter ($4\,\text{mm} \times \pi \approx 12.57\,\text{mm}$), because thread seating, line diameter, and multi-layer overlapping wraps significantly alter the effective pitch radius.
6. **Measure Loaded Rotational Speed (`SERVO_*_REV_PER_SEC_MAX`):**
   - Under the same representative tension load, command `neutral_pulse_us + wind_polarity * max_wind_delta_us` for a timed `1000 ms` burst and measure the revolutions completed to obtain `rev_per_sec_at_max`.
7. **Determine Maximum Safe Brake Pull (`SERVO_*_MAX_PULL_MM`) & Unwind Tension:**
   - Measure the physical brake-line travel from zero-brake (full glide trim) to maximum safe asymmetric turn deflection (staying at least `25%` short of canopy stall or mechanical binding on the M4 screw length).
   - Test `RELEASE_BRAKE` under minimal expected canopy tension to verify the line unwinds smoothly without jumping threads, binding, or reverse-wrapping.
8. **Populate `config.h` and Re-Verify:**
   - Enter the measured constants into `config.h`, set `ACTUATOR_CALIBRATED` to `1`, flash the firmware, and run pre-flight bench checks in `LAUNCH_PAD` (confirming servos remain detached) and `PRECISION_GUIDANCE` (confirming bounded wind, hold at stop, and clean unwind to neutral).

---

## D. Remaining Hardware Limitations (Why Open-Loop Control Cannot Know True Line Position)

Even with the updated software safety guards, **the physical mechanism remains open-loop at the actuator level**:

1. **Zero Position Feedback (`actual_position_known == false`):**
   - Without an encoder, potentiometer, or limit switch, the flight software **cannot detect** shaft slip, servo stall, stripped gears, broken brake lines, or fouled spools.
2. **Cumulative Dead-Reckoning Drift:**
   - Aerodynamic load on the parafoil trailing edge varies with airspeed, gust loading, and bank angle. Because continuous-rotation DC servo speed drops under load and varies as battery/BEC voltage sags, integrated `estimated_line_pull_mm` will drift over multiple turns (`WIND_BRAKE` under high aerodynamic load runs slower than `RELEASE_BRAKE` assisted by canopy tension).
3. **M4 Screw Layering & Tension Sensitivity:**
   - Winding a flexible line around a bare M4 machine screw causes overlapping wraps (increasing effective diameter per revolution) and risks thread pinching or slack loops if canopy tension momentarily drops during deployment or turbulence.

---

## E. Practical Hardware Improvements for True Closed-Loop or Repeatable Control

In order of engineering effectiveness and ease of integration on CAN-7USAT:

1. **Replace Continuous-Rotation Servos + Bare M4 Screws with Multi-Turn Positional Sail-Winch Servos or Standard Positional Servos with Extended Moment Arms (Highest Recommendation):**
   - A positional servo (or 1-to-3 turn positional winch servo with internal potentiometer feedback) inherently provides closed-loop shaft position control, deterministic neutral return, and zero cumulative drift.
2. **Add a Smooth Grooved Spool Drum / Capstan Over the M4 Screw:**
   - If using a rotary shaft, replace the bare M4 machine threads with a lightweight 3D-printed/machined grooved drum of known diameter so the line winds in a single repeatable layer without catching on M4 thread crests.
3. **Add Multi-Turn Potentiometer or Magnetic Encoder Feedback (AS5600 I2C / Analog Pot):**
   - Coupling a contactless magnetic encoder (e.g., AS5600) or multi-turn pot to the spool shaft converts the mechanism into a true closed-loop position servo where `actual_position_known` becomes `true`.
4. **Add Zero-Brake Optical/Micro Limit Switches (Home Reference):**
   - A micro-switch or photo-interrupter triggered by a knot/bead at the zero-brake ("fully released") position allows the controller to re-zero its line position accurately on every return to neutral, eliminating cumulative drift across turns.

---

## F. Flight-Readiness Limitations

- **Software Verification $\neq$ Flight Readiness:** Passing C++17 host compilation, unit tests (`12/12`), and GCS telemetry integration tests verifies **only** the software logic and safety state machine under simulated inputs.
- **Current Hardware Status:** Because `ACTUATOR_CALIBRATED` is `0` (`false`) pending physical bench measurements of the continuous-rotation servos and M4 screw mechanisms, **physical parafoil steering is currently locked out by design** and the vehicle is **not ready for guided free-flight** until Section C is completed on the actual hardware.
