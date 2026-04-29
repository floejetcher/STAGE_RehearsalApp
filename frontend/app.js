const API_BASE = window.API_BASE || "";

const API = {
  adminLogin: `${API_BASE}/api/admin/login`,
  adminLogout: `${API_BASE}/api/admin/logout`,
  adminMe: `${API_BASE}/api/admin/me`,
  users: `${API_BASE}/api/admin/users`,
  shows: `${API_BASE}/api/admin/shows`,
  studentActiveSession: `${API_BASE}/api/student/active-session`,
  studentCheckIn: `${API_BASE}/api/student/check-in`
};

const appRoot = document.getElementById("app");
const state = {
  mode: location.pathname.startsWith("/student") ? "student" : "admin",
  adminScreen: "catalog",
  workspaceTab: "castcrew",
  calendarVisible: false,
  calendarMinimized: false,
  calendarMonthOffset: 0,
  dragPayload: null,
  token: localStorage.getItem("stage_admin_token") || "",
  me: null,
  shows: [],
  selectedShowId: null,
  showDetail: null,
  rehearsals: [],
  people: [],
  groups: [],
  attendance: null,
  history: [],
  selectedPreExcusedIds: [],
  todayDate: new Date().toISOString().slice(0, 10),
  selectedRehearsalId: null,
  studentSession: null,
  pollingHandle: null,
  eventSource: null,
  adminEventSource: null
};

function headers(includeJson = false) {
  const h = {};
  if (state.token) h.Authorization = `Bearer ${state.token}`;
  if (includeJson) h["Content-Type"] = "application/json";
  return h;
}

async function apiGet(url, auth = true) {
  const res = await fetch(url, { headers: auth ? headers() : {} });
  return handleResponse(res);
}

async function apiPost(url, body, auth = true) {
  const res = await fetch(url, {
    method: "POST",
    headers: auth ? headers(true) : { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return handleResponse(res);
}

async function apiPut(url, body) {
  const res = await fetch(url, {
    method: "PUT",
    headers: headers(true),
    body: JSON.stringify(body || {})
  });
  return handleResponse(res);
}

async function apiPatch(url, body) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(true),
    body: JSON.stringify(body || {})
  });
  return handleResponse(res);
}

async function apiDelete(url) {
  const res = await fetch(url, {
    method: "DELETE",
    headers: headers()
  });
  return handleResponse(res);
}

async function handleResponse(res) {
  let payload = null;
  try {
    payload = await res.json();
  } catch (_err) {
    payload = null;
  }
  if (!res.ok) {
    if (res.status === 401) {
      clearSession();
      if (state.mode === "admin") {
        renderAdmin();
      }
    }
    const message = payload && payload.error ? payload.error : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return payload;
}

function clearSession() {
  state.token = "";
  state.me = null;
  state.adminScreen = "catalog";
  state.workspaceTab = "castcrew";
  state.selectedShowId = null;
  state.showDetail = null;
  state.rehearsals = [];
  state.people = [];
  state.groups = [];
  state.attendance = null;
  state.history = [];
  state.selectedPreExcusedIds = [];
  state.selectedRehearsalId = null;
  state.calendarVisible = false;
  state.calendarMinimized = false;
  state.calendarMonthOffset = 0;
  state.dragPayload = null;
  localStorage.removeItem("stage_admin_token");
}

function setSession(token) {
  state.token = token;
  localStorage.setItem("stage_admin_token", token);
}

function notify(text, isError = false) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const toast = document.createElement("div");
  toast.className = `toast ${isError ? "error" : "ok"}`;
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function escapeHtml(raw) {
  return (raw || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fullName(person) {
  return `${person.first_name} ${person.last_name}`.trim();
}

async function init() {
  if (state.mode === "admin") {
    await renderAdmin();
  } else {
    await renderStudent();
  }
}

async function renderAdmin() {
  try {
    state.me = await apiGet(API.adminMe);
  } catch (_err) {
    state.me = { username: "admin-unlocked", role: "director" };
  }

  await loadAdminData();
  renderAdminLayout();
}

async function loadAdminData() {
  state.shows = await apiGet(API.shows);

  if (!state.selectedShowId) {
    state.showDetail = null;
    state.rehearsals = [];
    state.people = [];
    state.groups = [];
    state.attendance = null;
    state.history = [];
    state.selectedPreExcusedIds = [];
    state.selectedRehearsalId = null;
    return;
  }

  const showId = state.selectedShowId;
  state.showDetail = null;
  state.rehearsals = [];
  state.people = [];
  state.groups = [];
  state.attendance = null;
  state.history = [];
  state.selectedPreExcusedIds = [];
  state.showDetail = await apiGet(`${API.shows}/${showId}`);
  state.rehearsals = await apiGet(`${API.shows}/${showId}/rehearsals`);
  state.people = await apiGet(`${API.shows}/${showId}/people`);
  state.groups = await apiGet(`${API.shows}/${showId}/groups`);
  state.attendance = await apiGet(`${API.shows}/${showId}/active-attendance?date=${state.todayDate}`);
  state.history = await apiGet(`${API.shows}/${showId}/attendance/history`);

  if (!state.selectedRehearsalId && state.rehearsals.length) {
    const today = state.rehearsals.find((r) => r.date === state.todayDate);
    state.selectedRehearsalId = today ? today.id : state.rehearsals[0].id;
  }

  if (state.selectedRehearsalId) {
    const preExcused = await apiGet(`${API_BASE}/api/admin/rehearsals/${state.selectedRehearsalId}/pre-excused`);
    state.selectedPreExcusedIds = preExcused.map((p) => p.person_id);
  } else {
    state.selectedPreExcusedIds = [];
  }
}

function renderAdminLayout() {
  if (state.adminScreen === "catalog") {
    renderShowCatalog();
    return;
  }

  if (state.adminScreen === "setup") {
    renderShowSetup();
    return;
  }

  if (state.adminScreen === "edit") {
    renderShowEditScreen();
    return;
  }

  const showOptions = state.shows
    .map((s) => `<option value="${s.id}" ${s.id === state.selectedShowId ? "selected" : ""}>${escapeHtml(s.name)}</option>`)
    .join("");

  const todayRehearsal = state.attendance && state.attendance.today_rehearsal;
  const activeSession = state.attendance && state.attendance.active_session;
  const selectedRehearsal = currentRehearsal();

  const castRows = state.people
    .filter((p) => p.type === "cast")
    .map(renderPersonCard)
    .join("");
  const crewRows = state.people
    .filter((p) => p.type === "crew")
    .map(renderPersonCard)
    .join("");

  const groupTables = renderGroupTables();

  const coverPreview = state.showDetail && state.showDetail.cover_image_url
    ? `<img src="${escapeHtml(state.showDetail.cover_image_url)}" alt="${escapeHtml(state.showDetail.name)} cover">`
    : `<div class="catalog-placeholder">${escapeHtml((state.showDetail && state.showDetail.name ? state.showDetail.name : "S").slice(0, 1).toUpperCase())}</div>`;

  appRoot.innerHTML = `
    <section class="admin-grid">
      <aside class="panel sidebar-panel">
        <div class="section-header">
          <h2>Admin View</h2>
          <button id="back-to-catalog" class="ghost" type="button">Back to Catalog</button>
        </div>
        <p class="muted">Signed in as ${escapeHtml(state.me.username)} (${escapeHtml(state.me.role)})</p>

        <label>Show</label>
        <div class="inline-row">
          <select id="show-select">${showOptions}</select>
          <button id="refresh-show">Refresh</button>
        </div>
      </aside>

      <section class="panel">
        <h2>Rehearsal Page</h2>

        <section class="panel attendance-top-panel">
          <h3>Active Attendance</h3>
          <p class="muted">System date: ${escapeHtml(state.todayDate)}</p>
          ${selectedRehearsal ? `<p class="status ok">Selected rehearsal: ${escapeHtml(selectedRehearsal.date)} ${escapeHtml(selectedRehearsal.start_time || "")}-${escapeHtml(selectedRehearsal.end_time || "")}</p>` : "<p class='status warning'>No rehearsal selected. Add one in Edit Show.</p>"}
          ${todayRehearsal ? `<p class="muted">Today rehearsal: ${escapeHtml(todayRehearsal.date)} ${escapeHtml(todayRehearsal.start_time || "")}-${escapeHtml(todayRehearsal.end_time || "")}</p>` : ""}
          ${activeSession ? `<p class="status ok">Recording active (session #${activeSession.id})</p>` : ""}
          <div class="inline-row">
            <button id="start-recording" ${!selectedRehearsal || activeSession ? "disabled" : ""}>Record Attendance</button>
            <button id="stop-recording" class="danger" ${activeSession ? "" : "disabled"}>Stop Recording Attendance</button>
            <button id="open-attendance-history" class="ghost" type="button">Attendance History</button>
          </div>
        </section>

        <div class="tabs workspace-main-tabs">
          <button class="tab-btn ${state.workspaceTab === "castcrew" ? "active" : ""}" data-workspace-tab="castcrew" type="button">Cast & Crew Info</button>
          <button class="tab-btn ${state.workspaceTab === "groupings" ? "active" : ""}" data-workspace-tab="groupings" type="button">Groupings</button>
        </div>

        <div class="split-layout workspace-layout ${state.workspaceTab === "castcrew" ? "" : "hidden"}" id="workspace-castcrew-panel">
          <section>
            <h3>Cast & Crew</h3>
            <h4>Cast</h4>
            <div class="person-list">${castRows || "<p class='muted'>No cast added.</p>"}</div>
            <h4>Crew</h4>
            <div class="person-list">${crewRows || "<p class='muted'>No crew added.</p>"}</div>
          </section>
        </div>

        <section class="block ${state.workspaceTab === "groupings" ? "" : "hidden"}" id="workspace-groupings-panel">
          <h4>Groups</h4>
          <p class="muted">Drag a person row and drop into another group table to rearrange. Right-click a row for multi-group assignment.</p>
          <div id="group-list">${groupTables}</div>
        </div>
      </section>

      <aside class="show-floating-controls">
        <div class="show-cover-panel panel">
          <h4>${escapeHtml(state.showDetail ? state.showDetail.name : "Selected Show")}</h4>
          <div class="show-cover-preview">${coverPreview}</div>
          <button id="open-show-edit" type="button">Edit Show</button>
          <button id="logout-btn" class="ghost">Log Out</button>
        </div>
      </aside>
    </section>

    <div id="modal-root"></div>
  `;

  bindAdminEvents();
}

function renderShowSetup() {
  appRoot.innerHTML = `
    <section class="panel catalog-panel">
      <div class="section-header">
        <div>
          <h2>Create Show</h2>
          <p class="muted">Add a new show name and optional cover image.</p>
        </div>
        <div class="inline-row">
          <button id="setup-back-to-catalog" class="ghost" type="button">Back to Catalog</button>
          <button id="setup-logout-btn" class="ghost" type="button">Log Out</button>
        </div>
      </div>

      <section class="panel narrow admin-login-card">
        <form id="new-show-form" class="stack-form compact">
          <label>
            New Show Name
            <input name="name" required>
          </label>
          <label>
            Cover Image (optional)
            <input name="cover_image" type="file" accept=".png,.jpg,.jpeg,.webp,.gif">
          </label>
          <label>
            Cast & Crew CSV (optional)
            <input name="cast_crew_csv" type="file" accept=".csv,text/csv">
          </label>
          <button type="submit">Create Show</button>
        </form>
      </section>
    </section>
  `;

  bindAdminEvents();
}

function renderShowEditScreen() {
  if (!state.selectedShowId || !state.showDetail) {
    state.adminScreen = "catalog";
    renderAdminLayout();
    return;
  }

  const rehearsalRows = (state.rehearsals || [])
    .map((r) => `
      <form class="rehearsal-row-form panel" data-rehearsal-id="${r.id}">
        <div class="inline-row">
          <label>Date<input name="date" type="date" value="${escapeHtml(r.date || "")}" required></label>
          <label>Start<input name="start_time" type="time" value="${escapeHtml(r.start_time || "")}"></label>
          <label>End<input name="end_time" type="time" value="${escapeHtml(r.end_time || "")}"></label>
        </div>
        <div class="inline-row">
          <button type="submit">Save Rehearsal</button>
          <button type="button" class="danger delete-rehearsal-row-btn" data-rehearsal-id="${r.id}">Delete</button>
        </div>
      </form>
    `)
    .join("");

  const castRows = (state.people || [])
    .filter((p) => p.type === "cast")
    .map((p) => `
      <tr>
        <td>${escapeHtml(fullName(p))}</td>
        <td>${escapeHtml(p.role)}</td>
        <td>${escapeHtml(p.pronouns || "-")}</td>
        <td>
          <div class="inline-row">
            <button type="button" class="edit-person-btn" data-person-id="${p.id}">Edit</button>
            <button type="button" class="danger delete-person-btn" data-person-id="${p.id}">Delete</button>
          </div>
        </td>
      </tr>
    `)
    .join("");

  const crewRows = (state.people || [])
    .filter((p) => p.type === "crew")
    .map((p) => `
      <tr>
        <td>${escapeHtml(fullName(p))}</td>
        <td>${escapeHtml(p.role)}</td>
        <td>${escapeHtml(p.pronouns || "-")}</td>
        <td>
          <div class="inline-row">
            <button type="button" class="edit-person-btn" data-person-id="${p.id}">Edit</button>
            <button type="button" class="danger delete-person-btn" data-person-id="${p.id}">Delete</button>
          </div>
        </td>
      </tr>
    `)
    .join("");

  const groupingCards = renderGroupList();

  appRoot.innerHTML = `
    <section class="panel catalog-panel">
      <div class="section-header">
        <div>
          <h2>Edit Show</h2>
          <p class="muted">Update show title or cover image.</p>
        </div>
        <div class="inline-row">
          <button id="edit-back-to-workspace" class="ghost" type="button">Back to Show</button>
          <button id="setup-logout-btn" class="ghost" type="button">Log Out</button>
        </div>
      </div>

      <section class="panel narrow admin-login-card">
        <form id="edit-show-form" class="stack-form compact">
          <label>
            Show Name
            <input name="name" value="${escapeHtml(state.showDetail.name)}" required>
          </label>
          <label>
            Replace Cover Image (optional)
            <input name="cover_image" type="file" accept=".png,.jpg,.jpeg,.webp,.gif">
          </label>
          <div class="inline-row">
            <button type="submit">Save Changes</button>
            <button id="delete-show" class="danger" type="button">Delete Show</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="section-header">
          <h3>Rehearsals</h3>
        </div>
        <form id="new-rehearsal-form" class="stack-form compact">
          <div class="inline-row">
            <label>Date<input name="date" type="date" required></label>
            <label>Start<input name="start_time" type="time"></label>
            <label>End<input name="end_time" type="time"></label>
          </div>
          <button type="submit">Add Rehearsal</button>
        </form>
        <form id="import-rehearsal-csv-form" class="stack-form compact">
          <label>
            Import Rehearsal CSV (Template Rehearsals format)
            <input name="rehearsal_csv" type="file" accept=".csv,text/csv" required>
          </label>
          <button type="submit">Import Rehearsal CSV</button>
        </form>
        <div class="stack-form compact">${rehearsalRows || "<p class='muted'>No rehearsals added yet.</p>"}</div>
      </section>

      <section class="panel">
        <div class="section-header">
          <h3>Cast & Crew Members</h3>
          <div class="inline-row">
            <button id="add-cast-member" type="button">Add Cast Member</button>
            <button id="add-crew-member" type="button">Add Crew Member</button>
          </div>
        </div>

        <div class="split-layout">
          <section>
            <h4>Cast CSV Import</h4>
            <form id="import-cast-csv-form" class="stack-form compact">
              <label>Cast CSV
                <input name="cast_csv" type="file" accept=".csv,text/csv" required>
              </label>
              <button type="submit">Import Cast CSV</button>
            </form>

            <h4>Cast Members</h4>
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Pronouns</th><th>Actions</th></tr></thead>
              <tbody>${castRows || "<tr><td colspan='4'>No cast members.</td></tr>"}</tbody>
            </table>
          </section>

          <section>
            <h4>Crew CSV Import</h4>
            <form id="import-crew-csv-form" class="stack-form compact">
              <label>Crew CSV
                <input name="crew_csv" type="file" accept=".csv,text/csv" required>
              </label>
              <button type="submit">Import Crew CSV</button>
            </form>

            <h4>Crew Members</h4>
            <table>
              <thead><tr><th>Name</th><th>Role</th><th>Pronouns</th><th>Actions</th></tr></thead>
              <tbody>${crewRows || "<tr><td colspan='4'>No crew members.</td></tr>"}</tbody>
            </table>
          </section>
        </div>
      </section>

      <section class="panel">
        <div class="section-header">
          <h3>Manage Groupings</h3>
        </div>
        <form id="new-group-form" class="stack-form compact">
          <div class="inline-row">
            <label>Group Name<input name="name" required></label>
            <label>Type
              <select name="type">
                <option value="cast">Cast</option>
                <option value="crew">Crew</option>
              </select>
            </label>
          </div>
          <button type="submit">Create Group</button>
        </form>
        <div id="group-editor-list">${groupingCards}</div>
      </section>
    </section>

    <div id="modal-root"></div>
  `;

  bindAdminEvents();
}

async function importCsvForShow(showId, csvFile, personType = "") {
  if (!csvFile || typeof csvFile !== "object" || csvFile.size <= 0) {
    return null;
  }

  const csvPayload = new FormData();
  csvPayload.append("file", csvFile);
  if (personType) {
    csvPayload.append("person_type", personType);
  }
  const res = await fetch(`${API.shows}/${showId}/people/import-csv`, {
    method: "POST",
    headers: headers(false),
    body: csvPayload
  });
  return handleResponse(res);
}

async function loadAdminDataWithShowRetry(attempts = 8, delayMs = 250) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await loadAdminData();
      return;
    } catch (err) {
      lastError = err;
      const isShowNotFound = (err.message || "").toLowerCase().includes("show not found");
      if (!isShowNotFound || attempt === attempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  if (lastError) {
    throw lastError;
  }
}

function renderRehearsalCalendar() {
  if (!state.calendarVisible) return "";

  const baseDate = state.selectedRehearsalId
    ? new Date(`${(currentRehearsal() || {}).date || state.todayDate}T00:00:00`)
    : new Date(`${state.todayDate}T00:00:00`);
  if (Number.isNaN(baseDate.getTime())) return "";

  const viewDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + state.calendarMonthOffset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rehearsalDates = new Set((state.rehearsals || []).map((r) => r.date));

  const cells = [];
  for (let i = 0; i < startWeekday; i += 1) {
    cells.push('<div class="calendar-cell empty"></div>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hasRehearsal = rehearsalDates.has(iso);
    cells.push(`<div class="calendar-cell ${hasRehearsal ? "has-rehearsal" : ""}"><span>${day}</span></div>`);
  }

  const monthLabel = viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return `
    <section class="calendar-panel panel">
      <div class="section-header">
        <h4>Calendar View</h4>
        <div class="inline-row">
          <button id="calendar-prev-month" type="button" class="ghost">Prev</button>
          <button id="calendar-next-month" type="button" class="ghost">Next</button>
          <button id="calendar-size-toggle" type="button" class="ghost">${state.calendarMinimized ? "Maximize" : "Minimize"}</button>
        </div>
      </div>
      <p class="muted">${escapeHtml(monthLabel)}</p>
      ${state.calendarMinimized ? "" : `<div class="calendar-grid">${cells.join("")}</div>`}
    </section>
  `;
}

function renderShowCatalog() {
  const cards = state.shows
    .map((show) => {
      const cover = show.cover_image_url
        ? `<img src="${escapeHtml(show.cover_image_url)}" alt="${escapeHtml(show.name)} cover">`
        : `<div class="catalog-placeholder">${escapeHtml(show.name.slice(0, 1).toUpperCase() || "S")}</div>`;
      return `
        <article class="catalog-card" data-show-id="${show.id}">
          <div class="catalog-cover">${cover}</div>
          <div class="catalog-overlay">
            <button type="button" class="open-show-btn" data-show-id="${show.id}">Open</button>
          </div>
        </article>
      `;
    })
    .join("");

  appRoot.innerHTML = `
    <section class="panel catalog-panel">
      <div class="catalog-header">
        <div class="catalog-left-actions">
          <button id="catalog-create-show-btn" type="button">Create Show</button>
        </div>
        <div class="catalog-title-block">
          <h2>Show Catalog</h2>
          <p class="muted">Signed in as ${escapeHtml(state.me.username)} (${escapeHtml(state.me.role)})</p>
        </div>
        <div class="inline-row catalog-right-actions">
          <button id="catalog-refresh-btn" class="ghost" type="button">Refresh</button>
          <button id="catalog-logout-btn" class="ghost" type="button">Log Out</button>
        </div>
      </div>
      <div class="catalog-grid">
        ${cards || "<p class='muted'>No shows yet. Click Create Show to add your first production.</p>"}
      </div>
    </section>
  `;

  bindAdminEvents();
}

function currentRehearsal() {
  return state.rehearsals.find((r) => r.id === state.selectedRehearsalId) || null;
}

function currentRehearsalValue(field) {
  const r = currentRehearsal();
  return r ? (r[field] || "") : "";
}

function renderPersonCard(person) {
  const advanced = person.advanced || {};
  return `
    <details class="person-card" data-person-id="${person.id}">
      <summary>
        <span>${escapeHtml(fullName(person))}</span>
        <span class="muted">${escapeHtml(person.pronouns || "")}</span>
        <span class="pill">${escapeHtml(person.role)}</span>
      </summary>
      <div class="person-body">
        <p><strong>Phone:</strong> ${escapeHtml(advanced.phone || "-")}</p>
        <p><strong>Email:</strong> ${escapeHtml(advanced.email || "-")}</p>
        <p><strong>Grade:</strong> ${escapeHtml(advanced.grade || "-")}</p>
        <p><strong>Guardian:</strong> ${escapeHtml(advanced.guardian_name || "-")}</p>
        <p><strong>Guardian Email:</strong> ${escapeHtml(advanced.guardian_email || "-")}</p>
        <p><strong>Guardian Phone:</strong> ${escapeHtml(advanced.guardian_phone || "-")}</p>
      </div>
    </details>
  `;
}

function attendanceRecordMap() {
  const map = new Map();
  (state.attendance && state.attendance.records ? state.attendance.records : []).forEach((r) => {
    map.set(r.person_id, r);
  });
  return map;
}

function renderGroupTables() {
  const groups = state.groups || [];
  const recordByPerson = attendanceRecordMap();
  const showStatusColumn = !!(state.attendance && state.attendance.active_session);
  const byType = {
    cast: groups.filter((g) => g.type === "cast"),
    crew: groups.filter((g) => g.type === "crew")
  };

  const renderTypeBoard = (type) => {
    const groupMemberIds = new Set(
      byType[type].flatMap((g) => (g.members || []).map((m) => m.id))
    );
    const ungrouped = state.people
      .filter((p) => p.type === type && !groupMemberIds.has(p.id))
      .map((p) => ({ ...p, _groupId: "" }));

    const renderRows = (people, sourceGroupId) => people
      .map((p) => {
        const rec = recordByPerson.get(p.id);
        const status = rec
          ? (rec.present ? "Present" : (rec.pre_excused ? "Pre-Excused" : "Absent"))
          : "";
        return `
          <tr class="group-member-row" draggable="true" data-person-id="${p.id}" data-source-group-id="${sourceGroupId}" data-person-type="${type}">
            <td>${escapeHtml(fullName(p))}</td>
            <td>${escapeHtml(p.role)}</td>
            ${showStatusColumn ? `<td>${escapeHtml(status)}</td>` : ""}
          </tr>
        `;
      })
      .join("");

    const groupTables = byType[type]
      .map((g) => {
        const rows = renderRows(g.members || [], g.id);
        return `
          <article class="group-table-card" data-group-id="${g.id}">
            <h5>${escapeHtml(g.name)}</h5>
            <table>
              <thead>
                <tr><th>Name</th><th>Role</th>${showStatusColumn ? "<th>Status</th>" : ""}</tr>
              </thead>
              <tbody class="group-dropzone" data-target-group-id="${g.id}" data-group-type="${type}">
                ${rows || `<tr class="group-empty-row"><td colspan="${showStatusColumn ? "3" : "2"}">Drop ${escapeHtml(type)} members here</td></tr>`}
              </tbody>
            </table>
          </article>
        `;
      })
      .join("");

    const ungroupedSection = ungrouped.length
      ? `
          <article class="group-table-card ungrouped">
            <h5>Ungrouped ${escapeHtml(type === "cast" ? "Cast" : "Crew")}</h5>
            <table>
              <thead>
                <tr><th>Name</th><th>Role</th>${showStatusColumn ? "<th>Status</th>" : ""}</tr>
              </thead>
              <tbody class="group-dropzone" data-target-group-id="" data-group-type="${type}">
                ${renderRows(ungrouped, "")}
              </tbody>
            </table>
          </article>
        `
      : "";

    return `
      <section class="group-type-section">
        <h5>${escapeHtml(type === "cast" ? "Cast" : "Crew")} Groupings</h5>
        <div class="group-table-grid">
          ${ungroupedSection}
          ${groupTables || `<article class="group-table-card"><h5>No ${escapeHtml(type)} groups</h5><p class="muted">Create groups in setup mode if needed.</p></article>`}
        </div>
      </section>
    `;
  };

  return `${renderTypeBoard("cast")}${renderTypeBoard("crew")}`;
}

function renderAttendanceTab(type) {
  const people = state.people.filter((p) => p.type === type);
  const recordByPerson = new Map();
  (state.attendance && state.attendance.records ? state.attendance.records : []).forEach((r) => recordByPerson.set(r.person_id, r));

  const rows = people
    .map((p) => {
      const rec = recordByPerson.get(p.id);
      const present = rec ? !!rec.present : false;
      const preExcused = rec ? !!rec.pre_excused : false;
      const rowId = rec ? rec.id : "";
      return `
        <tr>
          <td>${escapeHtml(fullName(p))}</td>
          <td>${escapeHtml(p.role)}</td>
          <td><input type="checkbox" class="present-toggle" data-record-id="${rowId}" ${present ? "checked" : ""} ${rowId ? "" : "disabled"}></td>
          <td><input type="checkbox" class="preexcused-toggle" data-record-id="${rowId}" ${preExcused ? "checked" : ""} ${rowId ? "" : "disabled"}></td>
        </tr>
      `;
    })
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Role</th>
          <th>Present</th>
          <th>Pre-Excused</th>
        </tr>
      </thead>
      <tbody>${rows || "<tr><td colspan='4'>No entries.</td></tr>"}</tbody>
    </table>
  `;
}

function renderGroupList() {
  if (!state.groups.length) return "<p class='muted'>No groups created.</p>";

  return state.groups
    .map((g) => {
      const memberIds = (g.members || []).map((m) => m.id);
      const pool = state.people.filter((p) => p.type === g.type);
      const options = pool
        .map(
          (p) => `<option value="${p.id}" ${memberIds.includes(p.id) ? "selected" : ""}>${escapeHtml(fullName(p))}</option>`
        )
        .join("");
      return `
        <article class="group-card" data-group-id="${g.id}">
          <h5>${escapeHtml(g.name)} <span class="pill">${escapeHtml(g.type)}</span></h5>
          <div class="inline-row">
            <input class="group-name-input" value="${escapeHtml(g.name)}">
            <select class="group-type-select">
              <option value="cast" ${g.type === "cast" ? "selected" : ""}>Cast</option>
              <option value="crew" ${g.type === "crew" ? "selected" : ""}>Crew</option>
            </select>
          </div>
          <label>Members</label>
          <select class="group-members-select" multiple>${options}</select>
          <div class="inline-row">
            <button class="save-group-btn" data-group-id="${g.id}">Save Group</button>
            <button class="delete-group-btn danger" data-group-id="${g.id}">Delete Group</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderPreExcusedList() {
  if (!state.selectedRehearsalId) return "<p class='muted'>Create a rehearsal first.</p>";
  const selected = new Set(state.selectedPreExcusedIds || []);
  return state.people
    .map((p) => {
      const checked = selected.has(p.id) ? "checked" : "";
      return `<label><input type="checkbox" class="pre-excused-person" value="${p.id}" ${checked}> ${escapeHtml(fullName(p))} (${escapeHtml(p.type)})</label>`;
    })
    .join("");
}

function bindAdminEvents() {
  document.getElementById("catalog-create-show-btn")?.addEventListener("click", async () => {
    state.adminScreen = "setup";
    state.selectedShowId = null;
    state.calendarVisible = false;
    state.calendarMinimized = false;
    state.calendarMonthOffset = 0;
    await loadAdminData();
    renderAdminLayout();
  });

  document.getElementById("catalog-refresh-btn")?.addEventListener("click", async () => {
    await loadAdminData();
    renderAdminLayout();
  });

  document.getElementById("catalog-logout-btn")?.addEventListener("click", async () => {
    try {
      await apiPost(API.adminLogout, {});
    } catch (_err) {
      // Ignore logout API failures and clear local session anyway.
    }
    clearSession();
    renderAdmin();
  });

  appRoot.querySelectorAll(".open-show-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.selectedShowId = Number(btn.dataset.showId);
      state.adminScreen = "workspace";
      state.calendarVisible = false;
      state.calendarMinimized = false;
      state.calendarMonthOffset = 0;
      await loadAdminData();
      renderAdminLayout();
    });
  });

  document.getElementById("back-to-catalog")?.addEventListener("click", async () => {
    state.adminScreen = "catalog";
    state.calendarVisible = false;
    state.calendarMinimized = false;
    state.calendarMonthOffset = 0;
    await loadAdminData();
    renderAdminLayout();
  });

  document.getElementById("setup-back-to-catalog")?.addEventListener("click", async () => {
    state.adminScreen = "catalog";
    await loadAdminData();
    renderAdminLayout();
  });

  document.getElementById("edit-back-to-workspace")?.addEventListener("click", async () => {
    state.adminScreen = "workspace";
    await loadAdminData();
    renderAdminLayout();
  });

  document.getElementById("setup-logout-btn")?.addEventListener("click", async () => {
    try {
      await apiPost(API.adminLogout, {});
    } catch (_err) {
      // Ignore logout API failures and clear local session anyway.
    }
    clearSession();
    renderAdmin();
  });

  document.getElementById("show-select")?.addEventListener("change", async (ev) => {
    state.selectedShowId = Number(ev.target.value);
    await loadAdminData();
    renderAdminLayout();
  });

  document.getElementById("refresh-show")?.addEventListener("click", async () => {
    await loadAdminData();
    renderAdminLayout();
  });

  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    try {
      await apiPost(API.adminLogout, {});
    } catch (_err) {
      // Ignore logout API failures and clear local session anyway.
    }
    clearSession();
    renderAdmin();
  });

  document.getElementById("open-show-edit")?.addEventListener("click", () => {
    state.adminScreen = "edit";
    renderAdminLayout();
  });

  document.getElementById("new-show-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const formData = new FormData(ev.target);
    const name = String(formData.get("name") || "").trim();
    const coverImage = formData.get("cover_image");
    const castCrewCsv = formData.get("cast_crew_csv");
    if (!name) return;
    try {
      const payload = new FormData();
      payload.append("name", name);
      if (coverImage && typeof coverImage === "object" && coverImage.size > 0) {
        payload.append("cover_image", coverImage);
      }

      const res = await fetch(API.shows, {
        method: "POST",
        headers: headers(false),
        body: payload
      });
      const show = await handleResponse(res);
      state.selectedShowId = show.id;
      state.showDetail = show;
      state.shows = [
        ...state.shows.filter((s) => s.id !== show.id),
        show
      ].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

      let importSummary = null;
      if (castCrewCsv && typeof castCrewCsv === "object" && castCrewCsv.size > 0) {
        importSummary = await importCsvForShow(show.id, castCrewCsv);
      }

      state.adminScreen = "workspace";

      await loadAdminDataWithShowRetry();

      renderAdminLayout();
      if (importSummary) {
        notify(`Show created. CSV imported ${importSummary.imported}, updated ${importSummary.updated}, skipped ${importSummary.skipped}.`);
      } else {
        notify("Show created.");
      }
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("edit-show-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state.selectedShowId) return;
    const fd = new FormData(ev.target);
    const name = String(fd.get("name") || "").trim();
    const coverImage = fd.get("cover_image");
    if (!name) return;
    try {
      const payload = new FormData();
      payload.append("name", name);
      if (coverImage && typeof coverImage === "object" && coverImage.size > 0) {
        payload.append("cover_image", coverImage);
      }

      const res = await fetch(`${API.shows}/${state.selectedShowId}`, {
        method: "PUT",
        headers: headers(false),
        body: payload
      });
      await handleResponse(res);
      await loadAdminData();
      renderAdminLayout();
      notify("Show updated.");
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("delete-show")?.addEventListener("click", async () => {
    if (!state.selectedShowId) return;
    if (!confirm("Delete this show and all related data?")) return;
    try {
      await apiDelete(`${API.shows}/${state.selectedShowId}`);
      state.selectedShowId = null;
      await loadAdminData();
      renderAdminLayout();
      notify("Show deleted.");
    } catch (err) {
      notify(err.message, true);
    }
  });

  appRoot.querySelectorAll(".rehearsal-row-form").forEach((form) => {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const rehearsalId = Number(form.dataset.rehearsalId);
      if (!rehearsalId) return;
      const fd = new FormData(form);
      try {
        await apiPut(`${API_BASE}/api/admin/rehearsals/${rehearsalId}`, {
          date: String(fd.get("date") || ""),
          start_time: String(fd.get("start_time") || ""),
          end_time: String(fd.get("end_time") || "")
        });
        await loadAdminData();
        renderAdminLayout();
        notify("Rehearsal updated.");
      } catch (err) {
        notify(err.message, true);
      }
    });
  });

  appRoot.querySelectorAll(".delete-rehearsal-row-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const rehearsalId = Number(btn.dataset.rehearsalId);
      if (!rehearsalId) return;
      if (!confirm("Delete this rehearsal?")) return;
      try {
        await apiDelete(`${API_BASE}/api/admin/rehearsals/${rehearsalId}`);
        if (state.selectedRehearsalId === rehearsalId) {
          state.selectedRehearsalId = null;
        }
        await loadAdminData();
        renderAdminLayout();
        notify("Rehearsal deleted.");
      } catch (err) {
        notify(err.message, true);
      }
    });
  });

  document.getElementById("add-cast-member")?.addEventListener("click", () => {
    openPersonModal({ first_name: "", last_name: "", pronouns: "", role: "", type: "cast", advanced: {} });
  });

  document.getElementById("add-crew-member")?.addEventListener("click", () => {
    openPersonModal({ first_name: "", last_name: "", pronouns: "", role: "", type: "crew", advanced: {} });
  });

  appRoot.querySelectorAll(".edit-person-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const personId = Number(btn.dataset.personId);
      const person = state.people.find((p) => p.id === personId);
      if (!person) return;
      openPersonModal(person);
    });
  });

  appRoot.querySelectorAll(".delete-person-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const personId = Number(btn.dataset.personId);
      if (!personId) return;
      if (!confirm("Delete this person?")) return;
      try {
        await apiDelete(`${API_BASE}/api/admin/people/${personId}`);
        await loadAdminData();
        renderAdminLayout();
        notify("Person deleted.");
      } catch (err) {
        notify(err.message, true);
      }
    });
  });

  document.getElementById("import-cast-csv-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state.selectedShowId) return;
    const fd = new FormData(ev.target);
    const castFile = fd.get("cast_csv");
    try {
      const result = await importCsvForShow(state.selectedShowId, castFile, "cast");
      await loadAdminData();
      renderAdminLayout();
      notify(`Cast CSV imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}.`);
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("import-crew-csv-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state.selectedShowId) return;
    const fd = new FormData(ev.target);
    const crewFile = fd.get("crew_csv");
    try {
      const result = await importCsvForShow(state.selectedShowId, crewFile, "crew");
      await loadAdminData();
      renderAdminLayout();
      notify(`Crew CSV imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}.`);
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("import-rehearsal-csv-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state.selectedShowId) return;
    const fd = new FormData(ev.target);
    const file = fd.get("rehearsal_csv");
    if (!file || typeof file !== "object" || file.size <= 0) return;
    try {
      const payload = new FormData();
      payload.append("file", file);
      const res = await fetch(`${API.shows}/${state.selectedShowId}/rehearsals/import-csv`, {
        method: "POST",
        headers: headers(false),
        body: payload
      });
      const result = await handleResponse(res);
      await loadAdminData();
      renderAdminLayout();
      notify(`Rehearsal CSV imported ${result.imported}, existing ${result.existing}, skipped ${result.skipped}.`);
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("new-group-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state.selectedShowId) return;
    const fd = new FormData(ev.target);
    const name = String(fd.get("name") || "").trim();
    const type = String(fd.get("type") || "cast").trim().toLowerCase();
    if (!name || !["cast", "crew"].includes(type)) return;
    try {
      await apiPost(`${API.shows}/${state.selectedShowId}/groups`, { name, type });
      await loadAdminData();
      renderAdminLayout();
      notify("Group created.");
    } catch (err) {
      notify(err.message, true);
    }
  });

  appRoot.querySelectorAll(".save-group-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const groupId = Number(btn.dataset.groupId);
      const card = btn.closest(".group-card");
      if (!groupId || !card) return;

      const name = String(card.querySelector(".group-name-input")?.value || "").trim();
      const type = String(card.querySelector(".group-type-select")?.value || "cast").trim().toLowerCase();
      const selected = Array.from(card.querySelectorAll(".group-members-select option:checked")).map((o) => Number(o.value));

      if (!name || !["cast", "crew"].includes(type)) return;

      try {
        await apiPut(`${API_BASE}/api/admin/groups/${groupId}`, { name, type, member_ids: selected });
        await loadAdminData();
        renderAdminLayout();
        notify("Group updated.");
      } catch (err) {
        notify(err.message, true);
      }
    });
  });

  appRoot.querySelectorAll(".delete-group-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const groupId = Number(btn.dataset.groupId);
      if (!groupId) return;
      if (!confirm("Delete this group?")) return;
      try {
        await apiDelete(`${API_BASE}/api/admin/groups/${groupId}`);
        await loadAdminData();
        renderAdminLayout();
        notify("Group deleted.");
      } catch (err) {
        notify(err.message, true);
      }
    });
  });

  document.getElementById("start-recording")?.addEventListener("click", async () => {
    if (!state.selectedShowId) return;
    try {
      await apiPost(`${API.shows}/${state.selectedShowId}/attendance/start`, {
        rehearsal_id: state.selectedRehearsalId || (state.attendance && state.attendance.today_rehearsal ? state.attendance.today_rehearsal.id : null)
      });
      await loadAdminData();
      renderAdminLayout();
      notify("Attendance recording started.");
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("stop-recording")?.addEventListener("click", async () => {
    if (!state.selectedShowId) return;
    try {
      await apiPost(`${API.shows}/${state.selectedShowId}/attendance/stop`, {});
      await loadAdminData();
      renderAdminLayout();
      notify("Attendance recording stopped.");
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("open-attendance-history")?.addEventListener("click", () => {
    openAttendanceHistoryModal();
  });

  appRoot.querySelectorAll(".workspace-main-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.workspaceTab = String(btn.dataset.workspaceTab || "castcrew");
      renderAdminLayout();
    });
  });

  bindGroupDragDropEvents();

  document.getElementById("new-rehearsal-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state.selectedShowId) return;
    const fd = new FormData(ev.target);
    try {
      await apiPost(`${API.shows}/${state.selectedShowId}/rehearsals`, {
        date: String(fd.get("date") || ""),
        start_time: String(fd.get("start_time") || ""),
        end_time: String(fd.get("end_time") || "")
      });
      await loadAdminData();
      renderAdminLayout();
      notify("Rehearsal added.");
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("rehearsal-select")?.addEventListener("change", async (ev) => {
    state.selectedRehearsalId = Number(ev.target.value);
    renderAdminLayout();
  });

  document.getElementById("edit-rehearsal-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state.selectedRehearsalId) return;
    const fd = new FormData(ev.target);
    try {
      await apiPut(`${API_BASE}/api/admin/rehearsals/${state.selectedRehearsalId}`, {
        date: String(fd.get("date") || ""),
        start_time: String(fd.get("start_time") || ""),
        end_time: String(fd.get("end_time") || "")
      });
      await loadAdminData();
      renderAdminLayout();
      notify("Rehearsal updated.");
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("delete-rehearsal")?.addEventListener("click", async () => {
    if (!state.selectedRehearsalId) return;
    if (!confirm("Delete this rehearsal?")) return;
    try {
      await apiDelete(`${API_BASE}/api/admin/rehearsals/${state.selectedRehearsalId}`);
      state.selectedRehearsalId = null;
      await loadAdminData();
      renderAdminLayout();
      notify("Rehearsal deleted.");
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("save-pre-excused")?.addEventListener("click", async () => {
    if (!state.selectedRehearsalId) return;
    const ids = Array.from(appRoot.querySelectorAll(".pre-excused-person:checked")).map((el) => Number(el.value));
    try {
      await apiPut(`${API_BASE}/api/admin/rehearsals/${state.selectedRehearsalId}/pre-excused`, { person_ids: ids });
      await loadAdminData();
      renderAdminLayout();
      notify("Pre-excused list updated.");
    } catch (err) {
      notify(err.message, true);
    }
  });
}

function openAttendanceHistoryModal() {
  const modalRoot = document.getElementById("modal-root");
  if (!modalRoot) return;

  const historyRows = (state.history || [])
    .map((session) => {
      const present = (session.records || []).filter((r) => r.present).length;
      const total = (session.records || []).length;
      return `
        <article class="history-card">
          <h5>${escapeHtml(session.date || "Unknown Date")}</h5>
          <p class="muted">Session #${escapeHtml(String(session.id || ""))} • ${escapeHtml(session.start_time || "")}-${escapeHtml(session.end_time || "")}</p>
          <p>${present}/${total} present</p>
        </article>
      `;
    })
    .join("");

  modalRoot.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal">
      <h3>Attendance History</h3>
      <div class="history-grid">${historyRows || "<p class='muted'>No attendance history yet.</p>"}</div>
      <div class="inline-row">
        <button id="close-history-modal" class="ghost" type="button">Close</button>
      </div>
    </div>
  `;

  document.getElementById("close-history-modal")?.addEventListener("click", () => {
    modalRoot.innerHTML = "";
  });
}

function bindGroupDragDropEvents() {
  appRoot.querySelectorAll(".group-member-row[draggable='true']").forEach((row) => {
    row.addEventListener("dragstart", (ev) => {
      state.dragPayload = {
        personId: Number(row.dataset.personId),
        sourceGroupId: row.dataset.sourceGroupId || "",
        personType: row.dataset.personType || ""
      };
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = "move";
      }
    });

    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const personId = Number(row.dataset.personId);
      const personType = String(row.dataset.personType || "");
      if (!personId || !personType) return;
      openGroupingMembershipModal(personId, personType);
    });
  });

  appRoot.querySelectorAll(".group-dropzone").forEach((zone) => {
    zone.addEventListener("dragover", (ev) => {
      const payload = state.dragPayload;
      if (!payload) return;
      if ((zone.dataset.groupType || "") !== payload.personType) return;
      ev.preventDefault();
      zone.classList.add("group-dropzone-active");
    });

    zone.addEventListener("dragleave", () => {
      zone.classList.remove("group-dropzone-active");
    });

    zone.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      zone.classList.remove("group-dropzone-active");
      const payload = state.dragPayload;
      state.dragPayload = null;
      if (!payload) return;

      const targetGroupId = zone.dataset.targetGroupId || "";
      const sourceGroupId = payload.sourceGroupId || "";
      if (targetGroupId === sourceGroupId) return;

      const person = state.people.find((p) => p.id === payload.personId);
      if (!person) return;

      if (sourceGroupId) {
        const sourceGroup = state.groups.find((g) => g.id === Number(sourceGroupId));
        if (sourceGroup) {
          sourceGroup.members = (sourceGroup.members || []).filter((m) => m.id !== person.id);
        }
      }

      if (targetGroupId) {
        const targetGroup = state.groups.find((g) => g.id === Number(targetGroupId));
        if (targetGroup && targetGroup.type === payload.personType) {
          targetGroup.members = targetGroup.members || [];
          if (!targetGroup.members.some((m) => m.id === person.id)) {
            targetGroup.members.push({
              id: person.id,
              first_name: person.first_name,
              last_name: person.last_name,
              type: person.type,
              role: person.role
            });
          }
        }
      }

      const groupsToSave = [];
      if (sourceGroupId) groupsToSave.push(Number(sourceGroupId));
      if (targetGroupId) groupsToSave.push(Number(targetGroupId));

      try {
        for (const groupId of [...new Set(groupsToSave)]) {
          const group = state.groups.find((g) => g.id === groupId);
          if (!group) continue;
          const memberIds = (group.members || []).map((m) => m.id);
          await apiPut(`${API_BASE}/api/admin/groups/${groupId}`, {
            name: group.name,
            type: group.type,
            member_ids: memberIds
          });
        }
        renderAdminLayout();
      } catch (err) {
        notify(err.message, true);
        await loadAdminData();
        renderAdminLayout();
      }
    });
  });
}

function openGroupingMembershipModal(personId, personType) {
  const modalRoot = document.getElementById("modal-root");
  if (!modalRoot) return;

  const person = state.people.find((p) => p.id === personId);
  if (!person) return;

  const groups = (state.groups || [])
    .filter((g) => g.type === personType)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

  if (!groups.length) {
    notify(`No ${personType} groups available. Create one in Edit Show first.`, true);
    return;
  }

  const selectedSet = new Set(
    groups
      .filter((g) => (g.members || []).some((m) => m.id === personId))
      .map((g) => g.id)
  );

  const options = groups
    .map((g) => {
      const checked = selectedSet.has(g.id) ? "checked" : "";
      return `<label><input type="checkbox" class="membership-group-checkbox" value="${g.id}" ${checked}> ${escapeHtml(g.name)}</label>`;
    })
    .join("");

  modalRoot.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal">
      <h3>Group Membership</h3>
      <p class="muted">${escapeHtml(fullName(person))} (${escapeHtml(personType)})</p>
      <form id="group-membership-form" class="stack-form compact">
        <div class="pre-excused-grid">${options}</div>
        <div class="inline-row">
          <button type="submit">Save Membership</button>
          <button type="button" id="cancel-membership-modal" class="ghost">Cancel</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("cancel-membership-modal")?.addEventListener("click", () => {
    modalRoot.innerHTML = "";
  });

  document.getElementById("group-membership-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    const selectedGroupIds = new Set(
      Array.from(modalRoot.querySelectorAll(".membership-group-checkbox:checked")).map((el) => Number(el.value))
    );

    try {
      for (const group of groups) {
        const memberIds = new Set((group.members || []).map((m) => m.id));
        if (selectedGroupIds.has(group.id)) {
          memberIds.add(personId);
        } else {
          memberIds.delete(personId);
        }

        await apiPut(`${API_BASE}/api/admin/groups/${group.id}`, {
          name: group.name,
          type: group.type,
          member_ids: [...memberIds]
        });
      }

      modalRoot.innerHTML = "";
      await loadAdminData();
      renderAdminLayout();
      notify("Group memberships updated.");
    } catch (err) {
      notify(err.message, true);
    }
  });
}

function openPersonModal(person = null) {
  const modalRoot = document.getElementById("modal-root");
  const p = person || {
    first_name: "",
    last_name: "",
    pronouns: "",
    role: "",
    type: "cast",
    advanced: {}
  };

  modalRoot.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal">
      <h3>${person ? "Edit Person" : "Add Person"}</h3>
      <form id="person-form" class="stack-form">
        <div class="two-col">
          <label>First Name<input name="first_name" value="${escapeHtml(p.first_name)}" required></label>
          <label>Last Name<input name="last_name" value="${escapeHtml(p.last_name)}" required></label>
        </div>
        <div class="two-col">
          <label>Pronouns<input name="pronouns" value="${escapeHtml(p.pronouns || "")}"></label>
          <label>Role<input name="role" value="${escapeHtml(p.role)}" required></label>
        </div>
        <label>Type
          <select name="type">
            <option value="cast" ${p.type === "cast" ? "selected" : ""}>Cast</option>
            <option value="crew" ${p.type === "crew" ? "selected" : ""}>Crew</option>
          </select>
        </label>

        <h4>Advanced Info</h4>
        <div class="two-col">
          <label>Phone<input name="phone" value="${escapeHtml((p.advanced || {}).phone || "")}"></label>
          <label>Email<input name="email" value="${escapeHtml((p.advanced || {}).email || "")}"></label>
        </div>
        <div class="two-col">
          <label>Grade<input name="grade" value="${escapeHtml((p.advanced || {}).grade || "")}"></label>
          <label>Guardian Name<input name="guardian_name" value="${escapeHtml((p.advanced || {}).guardian_name || "")}"></label>
        </div>
        <div class="two-col">
          <label>Guardian Email<input name="guardian_email" value="${escapeHtml((p.advanced || {}).guardian_email || "")}"></label>
          <label>Guardian Phone<input name="guardian_phone" value="${escapeHtml((p.advanced || {}).guardian_phone || "")}"></label>
        </div>

        <div class="inline-row">
          <button type="submit">Save</button>
          <button type="button" id="cancel-person-modal" class="ghost">Cancel</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("cancel-person-modal").addEventListener("click", () => {
    modalRoot.innerHTML = "";
  });

  document.getElementById("person-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state.selectedShowId) return;
    const fd = new FormData(ev.target);
    const payload = {
      first_name: String(fd.get("first_name") || "").trim(),
      last_name: String(fd.get("last_name") || "").trim(),
      pronouns: String(fd.get("pronouns") || "").trim(),
      role: String(fd.get("role") || "").trim(),
      type: String(fd.get("type") || "cast"),
      advanced: {
        phone: String(fd.get("phone") || "").trim(),
        email: String(fd.get("email") || "").trim(),
        grade: String(fd.get("grade") || "").trim(),
        guardian_name: String(fd.get("guardian_name") || "").trim(),
        guardian_email: String(fd.get("guardian_email") || "").trim(),
        guardian_phone: String(fd.get("guardian_phone") || "").trim()
      }
    };

    try {
      if (person) {
        await apiPut(`${API_BASE}/api/admin/people/${person.id}`, payload);
      } else {
        await apiPost(`${API.shows}/${state.selectedShowId}/people`, payload);
      }
      await loadAdminData();
      renderAdminLayout();
      notify("Person saved.");
    } catch (err) {
      notify(err.message, true);
    }
  });
}

async function renderStudent() {
  if (state.pollingHandle) {
    clearInterval(state.pollingHandle);
    state.pollingHandle = null;
  }
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  appRoot.innerHTML = `
    <section class="panel student-panel offline-panel">
      <h2>Student View</h2>
      <p class="status warning">Currently Offline</p>
      <p class="muted">This page is temporarily unavailable. Please check back shortly.</p>
    </section>
  `;
}

async function refreshStudentView() {
  try {
    state.studentSession = await apiGet(API.studentActiveSession, false);
    renderStudentLayout();
  } catch (err) {
    appRoot.innerHTML = `<section class="panel"><h2>Student View</h2><p class="status warning">${escapeHtml(err.message)}</p></section>`;
  }
}

function renderStudentLayout() {
  const session = state.studentSession;
  if (!session || !session.active) {
    appRoot.innerHTML = `
      <section class="panel student-panel">
        <h2>Student View</h2>
        <p class="status">Attendance not active</p>
        <p class="muted">Wait for stage management to start recording attendance.</p>
      </section>
    `;
    return;
  }

  const names = (session.people || [])
    .map((p) => {
      const checked = p.present ? "checked" : "";
      const preExcused = p.pre_excused ? `<span class="pill">Pre-excused</span>` : "";
      return `
        <label class="student-check-row">
          <input type="checkbox" data-person-id="${p.person_id}" data-session-id="${session.session.id}" ${checked}>
          <span>${escapeHtml(p.name)}</span>
          <small>${escapeHtml(p.role)} (${escapeHtml(p.type)})</small>
          ${preExcused}
        </label>
      `;
    })
    .join("");

  appRoot.innerHTML = `
    <section class="panel student-panel">
      <h2>Student Attendance Check-In</h2>
      <p class="status ok">Active for ${escapeHtml(session.session.show_name)} on ${escapeHtml(session.session.date)}</p>
      <div class="student-list">${names || "<p>No roster loaded.</p>"}</div>
      <p class="muted">Select your name once. Multiple clicks are safe.</p>
    </section>
  `;

  appRoot.querySelectorAll(".student-check-row input[type='checkbox']").forEach((box) => {
    box.addEventListener("change", async () => {
      if (!box.checked) {
        box.checked = true;
        return;
      }
      const personId = Number(box.dataset.personId);
      const sessionId = Number(box.dataset.sessionId);
      try {
        await apiPost(API.studentCheckIn, { session_id: sessionId, person_id: personId }, false);
        notify("Checked in.");
      } catch (err) {
        notify(err.message, true);
      }
    });
  });
}

init();
