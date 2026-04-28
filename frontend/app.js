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
  if (!state.token) {
    renderAdminLogin();
    return;
  }

  try {
    state.me = await apiGet(API.adminMe);
  } catch (_err) {
    renderAdminLogin();
    return;
  }

  await loadAdminData();
  renderAdminLayout();
}

function renderAdminLogin() {
  const tpl = document.getElementById("admin-login-template");
  appRoot.innerHTML = "";
  appRoot.appendChild(tpl.content.cloneNode(true));

  const form = document.getElementById("admin-login-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const username = String(fd.get("username") || "").trim();
    const password = String(fd.get("password") || "");
    if (!username || !password) return;
    try {
      const res = await apiPost(API.adminLogin, { username, password }, false);
      setSession(res.token);
      await renderAdmin();
      notify("Signed in.");
    } catch (err) {
      notify(err.message, true);
    }
  });
}

async function loadAdminData() {
  state.shows = await apiGet(API.shows);

  if (!state.selectedShowId && state.shows.length) {
    state.selectedShowId = state.shows[0].id;
  }

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
  const showOptions = state.shows
    .map((s) => `<option value="${s.id}" ${s.id === state.selectedShowId ? "selected" : ""}>${escapeHtml(s.name)}</option>`)
    .join("");

  const todayRehearsal = state.attendance && state.attendance.today_rehearsal;
  const activeSession = state.attendance && state.attendance.active_session;
  const noRehearsalMessage = state.attendance && state.attendance.no_rehearsal_today
    ? `<p class="status warning">No rehearsal today.</p>`
    : "";

  const castRows = state.people
    .filter((p) => p.type === "cast")
    .map(renderPersonCard)
    .join("");
  const crewRows = state.people
    .filter((p) => p.type === "crew")
    .map(renderPersonCard)
    .join("");

  const attendanceCast = renderAttendanceTab("cast");
  const attendanceCrew = renderAttendanceTab("crew");

  const rehearsalOptions = state.rehearsals
    .map((r) => `<option value="${r.id}" ${r.id === state.selectedRehearsalId ? "selected" : ""}>${escapeHtml(r.date)} ${escapeHtml(r.start_time || "")}-${escapeHtml(r.end_time || "")}</option>`)
    .join("");

  const historyCards = state.history
    .map((s) => {
      const rows = (s.records || [])
        .map((r) => {
          const presentLabel = r.present ? "Present" : "Absent";
          const preExcusedBadge = r.pre_excused ? "<span class=\"pill\">Pre-excused</span>" : "";
          return `<li>${escapeHtml(`${r.first_name} ${r.last_name}`)} - ${presentLabel} ${preExcusedBadge}</li>`;
        })
        .join("");
      return `
        <article class="history-card">
          <h4>${escapeHtml(s.date)} ${s.active ? "(Active)" : ""}</h4>
          <ul>${rows || "<li>No records.</li>"}</ul>
        </article>
      `;
    })
    .join("");

  appRoot.innerHTML = `
    <section class="admin-grid">
      <aside class="panel sidebar-panel">
        <h2>Admin View</h2>
        <p class="muted">Signed in as ${escapeHtml(state.me.username)} (${escapeHtml(state.me.role)})</p>

        <label>Show</label>
        <div class="inline-row">
          <select id="show-select">${showOptions}</select>
          <button id="refresh-show">Refresh</button>
        </div>

        <form id="new-show-form" class="stack-form compact">
          <label>
            New Show Name
            <input name="name" required>
          </label>
          <button type="submit">Create Show</button>
        </form>

        <form id="edit-show-form" class="stack-form compact">
          <label>
            Rename Current Show
            <input name="name" value="${escapeHtml(state.showDetail ? state.showDetail.name : "")}" required>
          </label>
          <div class="inline-row">
            <button type="submit">Save Name</button>
            <button type="button" id="delete-show" class="danger">Delete Show</button>
          </div>
        </form>

        <button id="logout-btn" class="ghost">Log Out</button>
      </aside>

      <section class="panel">
        <h2>Rehearsal Page</h2>
        <p class="muted">Left: cast/crew with advanced info dropdown. Right: active attendance control.</p>

        <div class="split-layout">
          <section>
            <div class="section-header">
              <h3>Cast & Crew</h3>
              <button id="add-person-btn">Add Person</button>
            </div>
            <h4>Cast</h4>
            <div class="person-list">${castRows || "<p class='muted'>No cast added.</p>"}</div>
            <h4>Crew</h4>
            <div class="person-list">${crewRows || "<p class='muted'>No crew added.</p>"}</div>
          </section>

          <section>
            <h3>Active Attendance</h3>
            <p class="muted">System date: ${escapeHtml(state.todayDate)}</p>
            ${todayRehearsal ? `<p class="status ok">Today rehearsal: ${escapeHtml(todayRehearsal.date)} ${escapeHtml(todayRehearsal.start_time || "")}-${escapeHtml(todayRehearsal.end_time || "")}</p>` : ""}
            ${noRehearsalMessage}
            ${activeSession ? `<p class="status ok">Recording active (session #${activeSession.id})</p>` : `<p class="status">Attendance currently not recording.</p>`}

            <div class="inline-row">
              <button id="start-recording" ${!todayRehearsal || activeSession ? "disabled" : ""}>Record Attendance</button>
              <button id="stop-recording" class="danger" ${activeSession ? "" : "disabled"}>Stop Recording Attendance</button>
            </div>

            <div class="tabs">
              <button data-tab="cast" class="tab-btn active">Cast</button>
              <button data-tab="crew" class="tab-btn">Crew</button>
            </div>
            <div id="attendance-tab-cast" class="tab-panel active">${attendanceCast}</div>
            <div id="attendance-tab-crew" class="tab-panel">${attendanceCrew}</div>

            <section class="block">
              <h4>Groups</h4>
              <p class="muted">Create/edit/move groupings in cast or crew tabs.</p>
              <form id="create-group-form" class="stack-form compact">
                <div class="inline-row">
                  <input name="name" placeholder="Group name" required>
                  <select name="type">
                    <option value="cast">Cast</option>
                    <option value="crew">Crew</option>
                  </select>
                  <button type="submit">Create Group</button>
                </div>
              </form>
              <div id="group-list">${renderGroupList()}</div>
            </section>
          </section>
        </div>

        <section class="block">
          <h3>Rehearsal Schedule</h3>
          <form id="new-rehearsal-form" class="stack-form compact">
            <div class="inline-row">
              <input name="date" type="date" required>
              <input name="start_time" type="time">
              <input name="end_time" type="time">
              <button type="submit">Add Rehearsal</button>
            </div>
          </form>

          <div class="inline-row">
            <label>Selected rehearsal</label>
            <select id="rehearsal-select">${rehearsalOptions}</select>
          </div>

          <form id="edit-rehearsal-form" class="stack-form compact">
            <div class="inline-row">
              <input name="date" type="date" value="${escapeHtml(currentRehearsalValue("date"))}">
              <input name="start_time" type="time" value="${escapeHtml(currentRehearsalValue("start_time"))}">
              <input name="end_time" type="time" value="${escapeHtml(currentRehearsalValue("end_time"))}">
              <button type="submit">Update Rehearsal</button>
              <button type="button" id="delete-rehearsal" class="danger">Delete</button>
            </div>
          </form>

          <section>
            <h4>Pre-Excused Absences</h4>
            <p class="muted">Mark students who will be absent ahead of time.</p>
            <div class="pre-excused-grid">${renderPreExcusedList()}</div>
            <button id="save-pre-excused">Save Pre-Excused</button>
          </section>
        </section>

        <section class="block">
          <h3>Attendance History</h3>
          <div class="history-grid">${historyCards || "<p class='muted'>No attendance sessions yet.</p>"}</div>
        </section>
      </section>
    </section>

    <div id="modal-root"></div>
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
        <div class="inline-row">
          <button class="edit-person-btn" data-person-id="${person.id}">Edit</button>
          <button class="delete-person-btn danger" data-person-id="${person.id}">Delete</button>
        </div>
      </div>
    </details>
  `;
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

  document.getElementById("new-show-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const name = String(fd.get("name") || "").trim();
    if (!name) return;
    try {
      const show = await apiPost(API.shows, { name });
      state.selectedShowId = show.id;
      await loadAdminData();
      renderAdminLayout();
      notify("Show created.");
    } catch (err) {
      notify(err.message, true);
    }
  });

  document.getElementById("edit-show-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state.selectedShowId) return;
    const fd = new FormData(ev.target);
    const name = String(fd.get("name") || "").trim();
    if (!name) return;
    try {
      await apiPut(`${API.shows}/${state.selectedShowId}`, { name });
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

  document.getElementById("add-person-btn")?.addEventListener("click", () => openPersonModal());

  appRoot.querySelectorAll(".edit-person-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const personId = Number(btn.dataset.personId);
      const person = state.people.find((p) => p.id === personId);
      if (person) openPersonModal(person);
    });
  });

  appRoot.querySelectorAll(".delete-person-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this person?")) return;
      const personId = Number(btn.dataset.personId);
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

  document.getElementById("start-recording")?.addEventListener("click", async () => {
    if (!state.selectedShowId) return;
    try {
      await apiPost(`${API.shows}/${state.selectedShowId}/attendance/start`, {
        rehearsal_id: state.attendance && state.attendance.today_rehearsal ? state.attendance.today_rehearsal.id : null
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

  appRoot.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      appRoot.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      appRoot.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      const panel = document.getElementById(`attendance-tab-${tab}`);
      if (panel) panel.classList.add("active");
    });
  });

  appRoot.querySelectorAll(".present-toggle").forEach((input) => {
    input.addEventListener("change", async () => {
      const recordId = Number(input.dataset.recordId);
      if (!recordId) return;
      try {
        await apiPatch(`${API_BASE}/api/admin/attendance/records/${recordId}`, { present: input.checked });
      } catch (err) {
        notify(err.message, true);
      }
    });
  });

  appRoot.querySelectorAll(".preexcused-toggle").forEach((input) => {
    input.addEventListener("change", async () => {
      const recordId = Number(input.dataset.recordId);
      if (!recordId) return;
      try {
        await apiPatch(`${API_BASE}/api/admin/attendance/records/${recordId}`, { pre_excused: input.checked });
      } catch (err) {
        notify(err.message, true);
      }
    });
  });

  document.getElementById("create-group-form")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state.selectedShowId) return;
    const fd = new FormData(ev.target);
    const name = String(fd.get("name") || "").trim();
    const type = String(fd.get("type") || "cast");
    if (!name) return;
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
      if (!card) return;
      const name = card.querySelector(".group-name-input").value.trim();
      const type = card.querySelector(".group-type-select").value;
      const memberSelect = card.querySelector(".group-members-select");
      const memberIds = Array.from(memberSelect.selectedOptions).map((opt) => Number(opt.value));
      if (!name) return;

      try {
        await apiPut(`${API_BASE}/api/admin/groups/${groupId}`, { name, type, member_ids: memberIds });
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
  await refreshStudentView();
  if (state.pollingHandle) { clearInterval(state.pollingHandle); state.pollingHandle = null; }
  if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
  state.eventSource = new EventSource(`${API_BASE}/api/student/events`);
  state.eventSource.onmessage = (ev) => {
    try {
      state.studentSession = JSON.parse(ev.data);
      renderStudentLayout();
    } catch (_e) {}
  };
  state.eventSource.onerror = () => {
    // Fall back to polling if SSE fails
    if (!state.pollingHandle) state.pollingHandle = setInterval(refreshStudentView, 5000);
  };
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
