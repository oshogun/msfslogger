 # ETOPS Certification and Route Analysis Specification

## 1. Purpose

Provide pre-flight planning and post-flight analysis for extended operations (ETOPS), including diversion coverage, alternate suitability, weather validation, entry/exit points, equal-time points, and map visualization.

## 2. Scope

The feature shall analyze a planned route and, optionally, an actual flown track. It shall support configurable diversion thresholds and aircraft-specific assumptions without changing the underlying route data.

## 3. Configuration

### 3.1 ETOPS profile

An ETOPS profile shall contain:

- One or more diversion thresholds, including standard values such as 60, 120, 180, and 207 minutes.
- Aircraft identifier and applicable engine/operational assumptions.
- One-engine-inoperative (OEI) cruise/diversion speed, with units and optional altitude-dependent values.
- Optional wind, temperature, and fuel assumptions used by the time model.
- Required runway length, runway surface, approach types, navigation capability, and airport operating requirements.
- Dispatch weather minima, including ceiling, visibility, crosswind, and other configurable limits.
- Rules for airport availability, such as opening hours, NOTAM status, and data freshness.

Profiles shall be versioned and included in analysis results so that results are reproducible.

## 4. Airport and weather data

The airport dataset shall support, at minimum:

- Identifier, name, coordinates, and elevation.
- Runways, including usable length, width, surface, heading, and operational status.
- Available approaches and associated minima/capabilities.
- Airport operating hours, facilities, and suitability flags.
- Data source, timestamp, and validity period.

The system shall retrieve METAR and TAF data for nominated ETOPS alternates. Missing, stale, or unavailable weather shall be reported explicitly rather than treated as suitable.

## 5. Route envelope analysis

### 5.1 Diversion-time calculation

For sampled points along the planned route, the system shall calculate travel time to each suitable diversion airport using the configured OEI diversion speed and assumptions. The result shall identify the nearest suitable alternate by time and the minimum diversion time for each route point.

The calculation shall account for the configured routing model, including direct or route-constrained diversion, and shall record assumptions, inputs, and units.

### 5.2 ETOPS entry and exit points

For each configured threshold, the system shall identify:

- The first point where the route exceeds the threshold (ETOPS entry point, EEP).
- Each subsequent point where it re-enters the threshold envelope (ETOPS exit point, EXP).
- The corresponding coordinates, route distance, elapsed planned time, threshold, and limiting alternate.

Boundary interpolation shall be used where practical, and the result shall indicate the sampling resolution and uncertainty.

### 5.3 Critical/equal-time points

For adjacent candidate alternates, the system shall calculate approximate points where diversion time to each alternate is equal. Each result shall include both airports, coordinates, route position, calculated times, and the assumptions used. Results shall be marked approximate when terrain, routing, weather, or sparse route samples reduce accuracy.

## 6. Alternate nomination and weather validation

The system shall nominate or accept nominated alternates for each ETOPS segment. A nominated alternate shall be evaluated against airport suitability and the configured dispatch minima.

Weather checks shall:

- Compare current/relevant METAR observations and TAF forecasts with configured minima.
- Report ceiling, visibility, wind, approach, and data-age checks separately.
- Produce statuses of suitable, unsuitable, unknown, or stale.
- Preserve the raw report, retrieval time, forecast validity, and comparison result.

Weather status shall not alter route geometry silently; it shall instead cause the affected alternate or segment to be excluded or flagged according to configuration.

## 7. Post-flight analysis

Given an actual track, the system shall:

- Match the track to the planned route and calculate the actual ETOPS envelope using the same or explicitly selected profile.
- Identify actual entry/exit points and compare them with planned EEP/EXP and ETP results.
- Detect and time-stamp excursions outside the planned envelope.
- Report maximum excursion, duration, nearest suitable alternate, and relevant threshold.
- Distinguish data gaps, track deviations, and calculation uncertainty.

## 8. Map visualization

The map shall display:

- Planned and actual tracks with distinct styles.
- Diversion circles/arcs or shaded coverage regions for configured thresholds.
- All suitable diversion airports and nominated alternates, with suitability/weather status.
- EEP and EXP markers for each threshold.
- Equal-time/critical-point markers and the candidate alternate pair.
- Tooltips or detail panels containing calculated times, assumptions, timestamps, and source data.

Users shall be able to toggle thresholds, layers, planned versus actual data, and unsuitable/stale alternates. Map geometry shall use the same calculations as the tabular analysis.

## 9. Outputs and acceptance criteria

Each analysis shall produce a versioned result containing configuration, source-data timestamps, route samples, suitable-airport decisions, diversion times, EEP/EXP, ETPs, weather checks, and post-flight excursions where applicable.

The feature is acceptable when a test route can reproduce its configured threshold envelope, identify entry/exit and equal-time points, reject an airport that fails runway or weather minima, display all required layers, and report a deliberately introduced actual-track excursion with its location and duration.
