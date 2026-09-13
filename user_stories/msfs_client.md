# User Story: MSFS CDU Client Integration

## Goal
Integrate the existing MCDU agent (currently used in Tauri) directly into MSFS 2020.

## High-Level Architecture
```text
                 MSFSLOGGER SERVER
                        │
               HTTP / WS / protocol
                        │
              ┌─────────┴──────────┐
              │                    │
       Windows CDU Agent      MSFS CDU Gauge
          (Tauri)             (Coherent GT)
              │                    │
        native desktop         in-sim display
```

## User Story
As a CDU page developer,
I want every CDU page to operate against a small abstract interface rather than calling Tauri commands directly,
so that the same CDU logic can run in both the Windows desktop agent and the MSFS in-sim gauge.

## First Step
Refactor CDU pages to depend only on the abstract interface.

