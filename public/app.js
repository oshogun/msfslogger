'use strict';

// ── Shared utilities ──────────────────────────────────────────────────────────

async function apiFetch(path, init = {}) {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDuration(sec) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDistance(nm) {
  if (nm == null) return '—';
  return nm.toFixed(1);
}

function formatAlt(ft) {
  if (ft == null) return '—';
  return Math.round(ft).toLocaleString();
}

function formatSpeed(kts) {
  if (kts == null) return '—';
  return Math.round(kts).toString();
}

function coordStr(lat, lon) {
  if (lat == null || lon == null) return '—';
  return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

// ── Live map ──────────────────────────────────────────────────────────────────

let _liveMap        = null;
let _liveMarker     = null;
let _liveTrack      = null;
let _lastTrackFetch = 0;
let _lastTrackId    = null;

function makeAircraftIcon(headingDeg) {
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${headingDeg}deg);font-size:24px;line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,.8))">✈</div>`,
    iconAnchor: [12, 12],
  });
}

function initLiveMap() {
  if (_liveMap) return;
  _liveMap = L.map('live-map', { preferCanvas: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(_liveMap);
}

function destroyLiveMap() {
  if (!_liveMap) return;
  _liveMap.remove();
  _liveMap = null; _liveMarker = null; _liveTrack = null;
  _lastTrackId = null; _lastTrackFetch = 0;
}

function updateLiveMap(s) {
  const { frame, currentFlightId } = s;
  if (!frame) return;
  const { lat, lon, headingDeg } = frame;
  if (lat === 0 && Math.abs(lon - 90) < 0.01) return;

  initLiveMap();
  const pos = [lat, lon];

  if (!_liveMarker) {
    _liveMarker = L.marker(pos, { icon: makeAircraftIcon(headingDeg), zIndexOffset: 1000 }).addTo(_liveMap);
    _liveMap.setView(pos, 10);
  } else {
    _liveMarker.setLatLng(pos);
    _liveMarker.setIcon(makeAircraftIcon(headingDeg));
    _liveMap.panTo(pos, { animate: true, duration: 0.8 });
  }

  const trackStale   = Date.now() - _lastTrackFetch > 10000;
  const flightChanged = currentFlightId !== _lastTrackId;
  if (currentFlightId && (trackStale || flightChanged)) {
    _lastTrackFetch = Date.now();
    _lastTrackId    = currentFlightId;
    apiFetch(`/api/flights/${currentFlightId}`).then(flight => {
      if (!_liveMap || !flight.points.length) return;
      const latlngs = flight.points.map(p => [p.lat, p.lon]);
      if (_liveTrack) _liveTrack.setLatLngs(latlngs);
      else _liveTrack = L.polyline(latlngs, { color: '#60a5fa', weight: 2.5, opacity: 0.8 }).addTo(_liveMap);
    }).catch(() => {});
  }

  _liveMap.invalidateSize();
}

// ── Status badge + live panel ─────────────────────────────────────────────────

let _lastFlightState = null;
let _statusInterval  = null;

async function updateStatus() {
  const dot   = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  const panel = document.getElementById('live-panel');

  let s;
  try {
    s = await apiFetch('/api/status');
  } catch {
    if (dot)   dot.className = 'dot disconnected';
    if (label) label.textContent = 'Server unreachable';
    return;
  }

  if (dot && label) {
    if (!s.connected) {
      dot.className = 'dot disconnected';
      label.textContent = 'Sim not connected';
    } else if (s.flightState === 'FLYING') {
      dot.className = 'dot flying';
      label.textContent = `Recording · ${s.aircraft || 'Unknown'}`;
    } else {
      dot.className = 'dot connected';
      label.textContent = 'Connected · Idle';
    }
  }

  if (panel) {
    const flying = s.flightState === 'FLYING' && s.frame;
    panel.style.display = flying ? 'block' : 'none';

    if (flying) {
      const f  = s.frame;
      const vs = Math.round(f.verticalSpeedFpm);
      document.getElementById('live-aircraft').textContent = s.aircraft || 'Unknown';
      document.getElementById('lv-airspeed').textContent  = Math.round(f.airspeedKnots);
      document.getElementById('lv-gs').textContent        = Math.round(f.groundSpeedKnots);
      document.getElementById('lv-alt').textContent       = Math.round(f.altitudeFt).toLocaleString();
      document.getElementById('lv-hdg').textContent       = Math.round(f.headingDeg).toString().padStart(3, '0');
      document.getElementById('lv-vs').textContent        = (vs >= 0 ? '+' : '') + vs.toLocaleString();
      document.getElementById('lv-pos').textContent       = `${f.lat.toFixed(3)}, ${f.lon.toFixed(3)}`;
      document.getElementById('lv-vs').style.color = vs > 100 ? '#34d399' : vs < -100 ? '#f87171' : '';
      if (typeof L !== 'undefined') updateLiveMap(s);
    } else {
      destroyLiveMap();
    }
  }

  const nowFlying = s.flightState === 'FLYING';
  if (nowFlying !== _lastFlightState) {
    _lastFlightState = nowFlying;
    if (_statusInterval) clearInterval(_statusInterval);
    _statusInterval = setInterval(updateStatus, nowFlying ? 1000 : 3000);
  }
}

// ── Flight list page ──────────────────────────────────────────────────────────

if (document.getElementById('flights-table')) {
  let listInterval;
  const selectedIds = new Set();
  let currentTrips  = [];

  function flightRow(f) {
    const combinable = f.point_count === null || f.point_count > 0;
    const checked    = selectedIds.has(f.id) && combinable ? 'checked' : '';
    const disabled   = combinable ? '' : 'disabled title="No recorded points"';
    return `
    <tr data-id="${f.id}">
      <td class="td-check"><input type="checkbox" class="row-check" value="${f.id}" ${checked} ${disabled}></td>
      <td class="td-aircraft" data-label="Aircraft">
        ${escHtml(f.aircraft || 'Unknown')}
        ${(f.departure_icao || f.arrival_icao) ? `<div class="td-route" title="${escHtml(f.departure_name || '')} → ${escHtml(f.arrival_name || '')}">${escHtml(f.departure_icao || '???')} &#8594; ${escHtml(f.arrival_icao || '???')}</div>` : ''}
      </td>
      <td class="td-date"     data-label="Date">${formatDate(f.start_time)}</td>
      <td class="td-stat"     data-label="Duration">${formatDuration(f.duration_sec)}</td>
      <td class="td-stat"     data-label="Distance">${formatDistance(f.distance_nm)} nm</td>
      <td class="td-stat"     data-label="Max Alt">${formatAlt(f.max_altitude_ft)} ft</td>
      <td class="td-stat"     data-label="Max Speed">${formatSpeed(f.max_airspeed_kts)} kts</td>
      <td class="td-actions"  data-label="">
        <a href="flight.html?id=${f.id}" class="btn btn-primary">View</a>
      </td>
    </tr>`;
  }

  async function loadFlights() {
    const tbody = document.getElementById('flights-body');
    const empty = document.getElementById('empty-state');

    const [flightsResult, tripsResult] = await Promise.allSettled([
      apiFetch('/api/flights'),
      apiFetch('/api/trips'),
    ]);

    if (flightsResult.status === 'rejected') {
      tbody.innerHTML = `<tr><td colspan="8" style="color:#f87171;padding:1rem">${escHtml(flightsResult.reason.message)}</td></tr>`;
      return;
    }

    const flights = flightsResult.value;
    currentTrips  = tripsResult.status === 'fulfilled' ? tripsResult.value : [];

    if (flights.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = 'block';
      updateCombineToolbar();
      return;
    }
    empty.style.display = 'none';

    // Remove stale selections
    const ids = new Set(flights.map(f => f.id));
    for (const id of selectedIds) { if (!ids.has(id)) selectedIds.delete(id); }

    const flightMap = new Map(flights.map(f => [f.id, f]));
    let html = '';

    // Pass 1: trips (with their legs)
    for (const trip of currentTrips) {
      const legIds = trip.flights.map(f => f.id);
      const legs   = legIds.map(id => flightMap.get(id)).filter(Boolean);
      const dist   = trip.total_distance_nm != null ? `${formatDistance(trip.total_distance_nm)} nm` : '—';
      const dur    = trip.total_duration_sec != null ? formatDuration(trip.total_duration_sec) : '—';
      html += `
      <tr class="tr-trip-header" onclick="toggleTrip(${trip.id})">
        <td colspan="8">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div class="trip-row-name">&#128648; ${escHtml(trip.name)}</div>
              <div class="trip-row-stats">${trip.flight_count} leg${trip.flight_count !== 1 ? 's' : ''} &middot; ${dur} &middot; ${dist}</div>
            </div>
            <div style="display:flex;align-items:center;gap:0.75rem">
              <a href="trip.html?id=${trip.id}" class="btn btn-ghost" style="font-size:0.8rem" onclick="event.stopPropagation()">View Trip</a>
            </div>
          </div>
        </td>
      </tr>`;
      for (const f of legs) {
        const row = flightRow(f);
        html += row.replace('<tr ', `<tr data-member-of-trip="${trip.id}" `);
      }
    }

    // Pass 2: ungrouped flights
    const ungrouped = flights.filter(f => f.trip_id === null || f.trip_id === undefined);
    if (ungrouped.length > 0) {
      if (currentTrips.length > 0) {
        html += `<tr class="tr-ungrouped-header"><td colspan="8">Ungrouped Flights</td></tr>`;
      }
      html += ungrouped.map(flightRow).join('');
    }

    tbody.innerHTML = html;
    attachCheckboxListeners();
  }

  window.toggleTrip = function(tripId) {
    document.querySelectorAll(`tr[data-member-of-trip="${tripId}"]`).forEach(tr => {
      tr.style.display = tr.style.display === 'none' ? '' : 'none';
    });
  };

  function attachCheckboxListeners() {
    document.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', e => {
        const id = parseInt(e.target.value, 10);
        e.target.checked ? selectedIds.add(id) : selectedIds.delete(id);
        updateCombineToolbar();
      });
    });
    const selectAll = document.getElementById('select-all');
    if (selectAll) {
      selectAll.onchange = e => {
        document.querySelectorAll('.row-check:not(:disabled)').forEach(cb => {
          cb.checked = e.target.checked;
          const id = parseInt(cb.value, 10);
          e.target.checked ? selectedIds.add(id) : selectedIds.delete(id);
        });
        updateCombineToolbar();
      };
    }
    updateCombineToolbar();
  }

  function updateCombineToolbar() {
    const toolbar    = document.getElementById('combine-toolbar');
    const btnCombine = document.getElementById('btn-combine');
    const btnNewTrip = document.getElementById('btn-new-trip');
    const btnAddTrip = document.getElementById('btn-add-to-trip');
    const info       = document.getElementById('combine-info');
    if (!toolbar) return;

    const n = selectedIds.size;
    toolbar.style.display = n > 0 ? 'flex' : 'none';
    if (btnNewTrip) btnNewTrip.style.display = n >= 1 ? '' : 'none';
    if (btnAddTrip) btnAddTrip.style.display = n >= 1 && currentTrips.length > 0 ? '' : 'none';

    if (n === 2) {
      btnCombine.disabled = false;
      const [a, b] = [...selectedIds];
      info.textContent = `Flights #${a} and #${b} selected`;
    } else {
      btnCombine.disabled = true;
      info.textContent = n === 1
        ? '1 flight selected'
        : `${n} flights selected`;
    }
  }

  document.getElementById('btn-combine').addEventListener('click', async () => {
    const [id1, id2] = [...selectedIds];
    if (!confirm(`Combine flights #${id1} and #${id2} into one? Both originals will be deleted.`)) return;

    const btn = document.getElementById('btn-combine');
    btn.disabled = true;
    btn.textContent = 'Combining...';

    try {
      const result = await apiFetch('/api/flights/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id1, id2 }),
      });
      selectedIds.clear();
      await loadFlights();
      location.href = `flight.html?id=${result.id}`;
    } catch (err) {
      alert('Combine failed: ' + err.message);
      btn.disabled = false;
      btn.textContent = 'Combine Selected';
    }
  });

  document.getElementById('btn-new-trip').addEventListener('click', async () => {
    const name = prompt('Trip name:');
    if (!name || !name.trim()) return;
    const btn = document.getElementById('btn-new-trip');
    btn.disabled = true;
    try {
      const { id: tripId } = await apiFetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      for (const flightId of selectedIds) {
        await apiFetch(`/api/trips/${tripId}/flights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flightId }),
        });
      }
      selectedIds.clear();
      await loadFlights();
    } catch (err) {
      alert('Failed to create trip: ' + err.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-add-to-trip').addEventListener('click', () => {
    const toolbar = document.getElementById('combine-toolbar');
    // Remove any existing picker
    const existing = document.getElementById('trip-picker-wrap');
    if (existing) { existing.remove(); return; }

    const wrap = document.createElement('span');
    wrap.id = 'trip-picker-wrap';
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:0.5rem';

    const sel = document.createElement('select');
    sel.style.cssText = 'background:#0f1117;color:#e2e8f0;border:1px solid #2d3148;border-radius:6px;padding:0.3rem 0.5rem;font-size:0.82rem';
    currentTrips.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });

    const confirm_ = document.createElement('button');
    confirm_.className = 'btn btn-primary';
    confirm_.style.fontSize = '0.8rem';
    confirm_.textContent = 'Add';
    confirm_.addEventListener('click', async () => {
      const tripId = parseInt(sel.value, 10);
      confirm_.disabled = true;
      try {
        for (const flightId of selectedIds) {
          await apiFetch(`/api/trips/${tripId}/flights`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ flightId }),
          });
        }
        selectedIds.clear();
        wrap.remove();
        await loadFlights();
      } catch (err) {
        alert('Failed to add to trip: ' + err.message);
        confirm_.disabled = false;
      }
    });

    wrap.appendChild(sel);
    wrap.appendChild(confirm_);
    toolbar.appendChild(wrap);
  });

  loadFlights();
  updateStatus();
  _statusInterval = setInterval(updateStatus, 3000);
  listInterval    = setInterval(loadFlights, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadFlights(); });
}

// ── Flight detail page ────────────────────────────────────────────────────────

if (document.getElementById('flight-detail')) {
  const params   = new URLSearchParams(location.search);
  const flightId = params.get('id');

  if (!flightId) {
    location.href = 'index.html';
  } else {
    initDetailPage(flightId);
    updateStatus();
    setInterval(updateStatus, 3000);
  }

  async function initDetailPage(id) {
    let flight;
    try {
      flight = await apiFetch(`/api/flights/${id}`);
    } catch (err) {
      document.getElementById('flight-detail').innerHTML =
        `<p style="color:#f87171">Failed to load flight: ${escHtml(err.message)}</p>`;
      return;
    }

    function refreshDisplay() {
      document.title = `Flight #${flight.id} — msfslogger`;
      document.getElementById('flight-title').textContent =
        `Flight #${flight.id} — ${flight.aircraft || 'Unknown Aircraft'}`;
      document.getElementById('flight-subtitle').textContent =
        formatDate(flight.start_time) + (flight.end_time ? ` → ${formatDate(flight.end_time)}` : ' (in progress)');

      const existing = document.getElementById('notes-section');
      if (existing) existing.remove();
      if (flight.notes) renderNotes(flight.notes);
    }

    refreshDisplay();
    renderStats(flight);
    renderMap(flight);
    renderAltitudeChart(flight.points);

    // Populate edit form
    document.getElementById('edit-aircraft').value = flight.aircraft || '';
    document.getElementById('edit-notes').value    = flight.notes    || '';

    // ── Edit button ──
    document.getElementById('btn-edit').addEventListener('click', () => {
      const section  = document.getElementById('edit-section');
      const isHidden = section.style.display === 'none';
      section.style.display = isHidden ? 'block' : 'none';
      if (isHidden) section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    document.getElementById('btn-cancel-edit').addEventListener('click', () => {
      document.getElementById('edit-section').style.display = 'none';
      document.getElementById('edit-aircraft').value = flight.aircraft || '';
      document.getElementById('edit-notes').value    = flight.notes    || '';
      document.getElementById('edit-error').style.display = 'none';
    });

    // ── Edit form submit ──
    document.getElementById('edit-form').addEventListener('submit', async e => {
      e.preventDefault();
      const aircraftVal = document.getElementById('edit-aircraft').value.trim();
      const notesVal    = document.getElementById('edit-notes').value.trim();
      const btn   = document.getElementById('btn-save');
      const errEl = document.getElementById('edit-error');

      btn.disabled = true;
      btn.textContent = 'Saving...';
      errEl.style.display = 'none';

      try {
        flight = await apiFetch(`/api/flights/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aircraft: aircraftVal || null, notes: notesVal || null }),
        });
        refreshDisplay();
        document.getElementById('edit-section').style.display = 'none';
      } catch (err) {
        errEl.textContent = 'Save failed: ' + err.message;
        errEl.style.display = 'inline';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });

    // ── Delete button ──
    document.getElementById('btn-delete').addEventListener('click', async () => {
      if (!confirm('Delete this flight log?')) return;
      try {
        await apiFetch(`/api/flights/${id}`, { method: 'DELETE' });
        location.href = 'index.html';
      } catch (err) {
        alert('Delete failed: ' + err.message);
      }
    });
  }

  function renderNotes(notes) {
    const div = document.createElement('div');
    div.id = 'notes-section';
    div.className = 'notes-section';
    div.innerHTML = `
      <div class="section-title">Notes</div>
      <p class="notes-text">${escHtml(notes)}</p>`;
    document.querySelector('.map-section').before(div);
  }

  function renderStats(f) {
    const grid  = document.getElementById('stats-grid');
    const stats = [
      { label: 'Duration',     value: formatDuration(f.duration_sec),            unit: '' },
      { label: 'Distance',     value: formatDistance(f.distance_nm),              unit: 'nm' },
      { label: 'Max Altitude', value: formatAlt(f.max_altitude_ft),               unit: 'ft' },
      { label: 'Max Airspeed', value: formatSpeed(f.max_airspeed_kts),            unit: 'kts' },
      { label: 'Points',       value: f.point_count ?? f.points?.length ?? 0,     unit: '' },
      { label: 'Departure', value: f.departure_icao || coordStr(f.departure_lat, f.departure_lon), unit: '', sub: f.departure_icao ? (f.departure_name || coordStr(f.departure_lat, f.departure_lon)) : '' },
      { label: 'Arrival',   value: f.arrival_icao   || coordStr(f.arrival_lat,   f.arrival_lon),   unit: '', sub: f.arrival_icao   ? (f.arrival_name   || coordStr(f.arrival_lat,   f.arrival_lon))   : '' },
    ];
    grid.innerHTML = stats.map(s => `
      <div class="stat-card">
        <div class="stat-label">${s.label}</div>
        <div class="stat-value">${escHtml(String(s.value))}<span class="stat-unit">${s.unit}</span></div>
        ${s.sub ? `<div class="stat-sub">${escHtml(s.sub)}</div>` : ''}
      </div>`).join('');
  }

  function renderMap(flight) {
    const points = flight.points || [];
    if (points.length === 0) {
      document.getElementById('map').innerHTML = '<p style="padding:2rem;color:#4b5563">No GPS points recorded.</p>';
      return;
    }
    const map = L.map('map', { preferCanvas: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    const latlngs = points.map(p => [p.lat, p.lon]);
    const polyline = L.polyline(latlngs, { color: '#60a5fa', weight: 2.5, opacity: 0.9 }).addTo(map);

    const mkIcon = c => L.divIcon({ className: '', iconAnchor: [6, 6],
      html: `<div style="width:12px;height:12px;border-radius:50%;background:${c};border:2px solid #fff;box-shadow:0 0 4px #000"></div>` });
    L.marker(latlngs[0], { icon: mkIcon('#34d399') }).addTo(map).bindTooltip('Departure');
    L.marker(latlngs[latlngs.length - 1], { icon: mkIcon('#f87171') }).addTo(map).bindTooltip('Arrival');
    map.fitBounds(polyline.getBounds(), { padding: [30, 30] });
  }

  function renderAltitudeChart(points) {
    if (!points || points.length < 2) return;
    const svg  = document.getElementById('altitude-chart');
    const W    = svg.clientWidth || 900;
    const H    = 140;
    const PAD  = { top: 16, right: 12, bottom: 28, left: 48 };
    const alts = points.map(p => p.altitude_ft);
    const maxAlt = Math.max(...alts), minAlt = Math.min(...alts);
    const range  = maxAlt - minAlt || 1;
    const xScale = i => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
    const yScale = v => PAD.top + (1 - (v - minAlt) / range) * (H - PAD.top - PAD.bottom);
    const pathD  = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.altitude_ft).toFixed(1)}`).join(' ');
    const areaD  = pathD + ` L${xScale(points.length-1).toFixed(1)},${(H-PAD.bottom).toFixed(1)} L${PAD.left},${(H-PAD.bottom).toFixed(1)} Z`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <defs><linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%"   stop-color="#60a5fa" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#60a5fa" stop-opacity="0.02"/>
      </linearGradient></defs>
      <path d="${areaD}" fill="url(#grad)"/>
      <path d="${pathD}" fill="none" stroke="#60a5fa" stroke-width="1.8"/>
      <text x="${PAD.left-6}" y="${yScale(maxAlt).toFixed(1)}" fill="#64748b" font-size="10" text-anchor="end" dominant-baseline="middle">${formatAlt(maxAlt)}</text>
      <text x="${PAD.left-6}" y="${yScale(minAlt).toFixed(1)}" fill="#64748b" font-size="10" text-anchor="end" dominant-baseline="middle">${formatAlt(minAlt)}</text>
      <text x="${W/2}" y="${H-4}" fill="#64748b" font-size="10" text-anchor="middle">Time</text>
      <text x="${PAD.left-36}" y="${H/2}" fill="#64748b" font-size="10" text-anchor="middle" transform="rotate(-90,${PAD.left-36},${H/2})">ft</text>`;
  }
}

// ── Trip detail page ──────────────────────────────────────────────────────────

if (document.getElementById('trip-detail')) {
  const params = new URLSearchParams(location.search);
  const tripId = params.get('id');

  if (!tripId) {
    location.href = 'index.html';
  } else {
    initTripPage(tripId);
    updateStatus();
    setInterval(updateStatus, 3000);
  }

  const LEG_COLORS = ['#60a5fa', '#34d399', '#f59e0b', '#a78bfa', '#f87171'];

  async function initTripPage(id) {
    let trip;
    try {
      trip = await apiFetch(`/api/trips/${id}`);
    } catch (err) {
      document.getElementById('trip-detail').innerHTML =
        `<p style="color:#f87171">Failed to load trip: ${escHtml(err.message)}</p>`;
      return;
    }

    function refreshDisplay() {
      document.title = `${trip.name} — msfslogger`;
      document.getElementById('trip-title').textContent = trip.name;
      document.getElementById('trip-subtitle').textContent =
        `${trip.flight_count} leg${trip.flight_count !== 1 ? 's' : ''}` +
        (trip.total_distance_nm != null ? ` · ${formatDistance(trip.total_distance_nm)} nm total` : '');
      const existing = document.getElementById('trip-notes-section');
      if (existing) existing.remove();
      if (trip.notes) {
        const div = document.createElement('div');
        div.id = 'trip-notes-section';
        div.className = 'notes-section';
        div.innerHTML = `<div class="section-title">Notes</div><p class="notes-text">${escHtml(trip.notes)}</p>`;
        document.querySelector('.map-section').before(div);
      }
    }

    refreshDisplay();
    renderTripStats(trip);
    renderTripMap(trip);
    renderLegsTable(trip, id);

    document.getElementById('edit-name').value  = trip.name;
    document.getElementById('edit-notes').value = trip.notes || '';

    document.getElementById('btn-edit').addEventListener('click', () => {
      const section = document.getElementById('edit-section');
      const isHidden = section.style.display === 'none';
      section.style.display = isHidden ? 'block' : 'none';
      if (isHidden) section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    document.getElementById('btn-cancel-edit').addEventListener('click', () => {
      document.getElementById('edit-section').style.display = 'none';
      document.getElementById('edit-name').value  = trip.name;
      document.getElementById('edit-notes').value = trip.notes || '';
      document.getElementById('edit-error').style.display = 'none';
    });

    document.getElementById('edit-form').addEventListener('submit', async e => {
      e.preventDefault();
      const nameVal  = document.getElementById('edit-name').value.trim();
      const notesVal = document.getElementById('edit-notes').value.trim();
      const btn   = document.getElementById('btn-save');
      const errEl = document.getElementById('edit-error');
      if (!nameVal) { errEl.textContent = 'Name is required'; errEl.style.display = 'inline'; return; }

      btn.disabled = true; btn.textContent = 'Saving...';
      errEl.style.display = 'none';
      try {
        trip = await apiFetch(`/api/trips/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nameVal, notes: notesVal || null }),
        });
        refreshDisplay();
        document.getElementById('edit-section').style.display = 'none';
      } catch (err) {
        errEl.textContent = 'Save failed: ' + err.message;
        errEl.style.display = 'inline';
      } finally {
        btn.disabled = false; btn.textContent = 'Save';
      }
    });

    document.getElementById('btn-delete').addEventListener('click', async () => {
      if (!confirm(`Delete trip "${trip.name}"? The flights will not be deleted.`)) return;
      try {
        await apiFetch(`/api/trips/${id}`, { method: 'DELETE' });
        location.href = 'index.html';
      } catch (err) {
        alert('Delete failed: ' + err.message);
      }
    });
  }

  function renderTripStats(trip) {
    const grid = document.getElementById('stats-grid');
    const stats = [
      { label: 'Total Duration', value: formatDuration(trip.total_duration_sec), unit: '' },
      { label: 'Total Distance', value: formatDistance(trip.total_distance_nm),  unit: 'nm' },
      { label: 'Peak Altitude',  value: formatAlt(trip.max_altitude_ft),          unit: 'ft' },
      { label: 'Legs',           value: trip.flight_count,                        unit: '' },
    ];
    grid.innerHTML = stats.map(s => `
      <div class="stat-card">
        <div class="stat-label">${s.label}</div>
        <div class="stat-value">${s.value}<span class="stat-unit">${s.unit}</span></div>
      </div>`).join('');
  }

  function renderTripMap(trip) {
    const flights = trip.flights || [];
    const hasPoints = flights.some(f => f.points && f.points.length > 0);
    if (!hasPoints) {
      document.getElementById('map').innerHTML = '<p style="padding:2rem;color:#4b5563">No GPS points recorded for this trip.</p>';
      return;
    }

    const map = L.map('map', { preferCanvas: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    const mkIcon = c => L.divIcon({ className: '', iconAnchor: [6, 6],
      html: `<div style="width:12px;height:12px;border-radius:50%;background:${c};border:2px solid #fff;box-shadow:0 0 4px #000"></div>` });

    const polylines = [];
    flights.forEach((f, i) => {
      const pts = f.points || [];
      if (pts.length === 0) return;
      const color   = LEG_COLORS[i % LEG_COLORS.length];
      const latlngs = pts.map(p => [p.lat, p.lon]);
      const pl = L.polyline(latlngs, { color, weight: 2.5, opacity: 0.9 }).addTo(map);
      pl.bindTooltip(`Leg ${i + 1}${f.aircraft ? ' — ' + f.aircraft : ''}`);
      polylines.push(pl);
      L.marker(latlngs[0], { icon: mkIcon('#34d399') }).addTo(map)
        .bindTooltip(`Leg ${i + 1} departure`);
      L.marker(latlngs[latlngs.length - 1], { icon: mkIcon('#f87171') }).addTo(map)
        .bindTooltip(`Leg ${i + 1} arrival`);
    });

    if (polylines.length > 0) {
      map.fitBounds(L.featureGroup(polylines).getBounds(), { padding: [30, 30] });
    }
  }

  function renderLegsTable(trip, tripId) {
    const tbody = document.getElementById('legs-body');
    const flights = trip.flights || [];
    if (flights.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="padding:1rem;color:#4b5563">No flights in this trip.</td></tr>';
      return;
    }
    tbody.innerHTML = flights.map((f, i) => {
      const color = LEG_COLORS[i % LEG_COLORS.length];
      return `
      <tr>
        <td class="td-stat"><span class="leg-color-swatch" style="background:${color}"></span>Leg ${i + 1}</td>
        <td class="td-aircraft">${escHtml(f.aircraft || 'Unknown')}</td>
        <td class="td-date">${formatDate(f.start_time)}</td>
        <td class="td-stat">${formatDuration(f.duration_sec)}</td>
        <td class="td-stat">${formatDistance(f.distance_nm)} nm</td>
        <td class="td-stat">
          ${(f.departure_icao || f.arrival_icao)
            ? `<span class="td-route" title="${escHtml(f.departure_name || '')} &#8594; ${escHtml(f.arrival_name || '')}">${escHtml(f.departure_icao || '???')} &#8594; ${escHtml(f.arrival_icao || '???')}</span>`
            : '<span style="color:#4b5563">—</span>'}
        </td>
        <td class="td-actions">
          <a href="flight.html?id=${f.id}" class="btn btn-ghost" style="font-size:0.8rem">View</a>
        </td>
        <td class="td-actions">
          <button class="btn btn-danger btn-remove-leg" data-flight-id="${f.id}" style="font-size:0.8rem">Remove</button>
        </td>
      </tr>`;
    }).join('');

    document.querySelectorAll('.btn-remove-leg').forEach(btn => {
      btn.addEventListener('click', async () => {
        const fid = parseInt(btn.dataset.flightId, 10);
        if (!confirm('Remove this leg from the trip?')) return;
        try {
          await apiFetch(`/api/trips/${tripId}/flights/${fid}`, { method: 'DELETE' });
          location.reload();
        } catch (err) {
          alert('Failed to remove leg: ' + err.message);
        }
      });
    });
  }
}
