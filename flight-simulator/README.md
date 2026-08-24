# SkyTrainer — Flight Simulator for Student Pilots

A browser-based flight simulator built to help **student pilots** learn the
fundamentals of flying a small single-engine aircraft (a Cessna 172-class
airplane). It runs entirely in the browser with **no build step and no external
libraries** — just open `index.html`.

![Six-pack instrument panel with out-the-window view](https://placehold.co/1x1)
<!-- Screenshot placeholder; open the app to see the live cockpit. -->

## What it teaches

The simulator is organised as a series of lessons, each with a live objective
tracker and a "flight instructor" that gives you real-time tips:

1. **Takeoff & Climb** — hold the centreline, apply full power, rotate at ~55 kt
   and establish a stable climb.
2. **Straight & Level** — hold heading, altitude and airspeed using small
   inputs and trim.
3. **Coordinated Turns** — roll into a bank and keep the slip/skid ball centred
   with rudder ("step on the ball").
4. **Stall Recognition & Recovery** — feel the approach to a stall and recover
   with minimal height loss.
5. **Approach & Landing** — fly a stabilised final approach and flare for a soft
   touchdown on Runway 36.
6. **Free Flight** — no objectives; practise anything.

## Realistic flight model

The core (`js/physics.js`) is a **6-degree-of-freedom rigid-body simulation**
using classic aerodynamic stability derivatives tuned to a Cessna 172. It
reproduces the behaviour that actually matters for training, including:

- **Angle-of-attack driven lift** with a genuine **stall** (lift breaks down
  past the critical AoA; stall speed ≈ 49 kt clean, ≈ 40 kt with full flaps).
- **Realistic airspeeds** — cruise ≈ 100–120 kt, climb ≈ 75–85 kt.
- **Adverse yaw** and the need for **coordinated rudder** in turns, shown on the
  inclinometer (slip/skid) ball.
- **Trim, flaps** (0/10/20/30°), **ground roll, braking and nosewheel steering**.
- **Load factor (G)**, indicated-vs-true airspeed with altitude, and
  **hard-landing / crash** detection.

The model is validated by a set of headless scenarios (takeoff, cruise trim,
turn coordination, stall recovery, landing, taxi) — see the development notes.

## Controls

| Action | Keys |
| --- | --- |
| Elevator (pitch) | `↑`/`W` nose up · `↓`/`S` nose down |
| Ailerons (roll) | `←`/`A` left · `→`/`D` right |
| Rudder (yaw) | `Q` left · `E` right |
| Throttle | `Shift` up · `Ctrl` down · `Z` full · `X` idle |
| Flaps | `F` down · `G` up |
| Elevator trim | `[` nose up · `]` nose down |
| Wheel brakes | hold `B` (or mouse button) |
| Parking brake | `P` |
| Pause / Reset | `Space` / `R` |
| Mouse as yoke | `M` to toggle |

A **gamepad** is picked up automatically if connected (left stick =
elevator/ailerons, triggers = throttle). Enable **Sound** for the engine drone
and the stall-warning horn.

## The instrument scan (the "six-pack")

The panel shows the six primary flight instruments a student learns to scan,
plus engine gauges:

```
 Airspeed Indicator | Attitude Indicator | Altimeter
 Turn Coordinator   | Heading Indicator  | Vertical Speed Indicator
```

Plus a tachometer and throttle / flap / trim / G tapes.

## Running it

No server or build is required:

```bash
# Just open the file...
open flight-simulator/index.html        # macOS
xdg-open flight-simulator/index.html    # Linux

# ...or serve the folder if your browser restricts file:// access:
npx http-server flight-simulator -p 8080
# then browse to http://localhost:8080
```

## Project layout

```
flight-simulator/
├── index.html            # page + cockpit layout, help overlay
├── css/style.css         # dark cockpit theme, HUD, instrument panel
└── js/
    ├── physics.js        # 6-DOF flight dynamics model (the aircraft)
    ├── input.js          # keyboard / mouse / gamepad -> control demands
    ├── render.js         # out-the-window 3D view (canvas, no WebGL)
    ├── instruments.js    # the six-pack + engine gauges
    └── main.js           # sim loop, lessons, objectives, audio, HUD
```

## Notes & disclaimer

This is a **training aid and educational toy**, not a certified flight
simulator. The aerodynamic constants are representative of a light aircraft but
are not a substitute for real flight instruction. Have fun, and go take a
discovery flight with a real CFI!
