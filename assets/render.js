/* =========================================================
   RENDER.JS
   Reads /data/projects.json and /data/milestones.json and
   builds the same markup the hand-written pages used to use,
   so admin-added entries appear with zero code changes.
   ========================================================= */

async function fetchJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

/* ---------------------------------------------------------
   PROJECTS — used by projects.html
   --------------------------------------------------------- */
function projectCardHTML(p) {
  const tags = (p.tags || [])
    .map((t) => `<span class="badge">${escapeHTML(t)}</span>`)
    .join("");

  const visuals = (p.images || [])
    .map(
      (img) => `
        <div class="visual-item">
          <img src="${escapeHTML(img.src)}" alt="${escapeHTML(p.title)}">
          <p class="caption">${escapeHTML(img.caption || "")}</p>
        </div>`
    )
    .join("");

  const link = p.link
    ? `<div class="project-links">
         <a href="${escapeHTML(p.link.url)}" class="btn-text"><i class="fab fa-github"></i> ${escapeHTML(p.link.label)}</a>
       </div>`
    : "";

  return `
    <article class="project-card">
      <div class="project-header">
        <div class="project-meta">
          <h2>${escapeHTML(p.title)}</h2>
          <span class="project-type">${escapeHTML(p.type || "")}</span>
        </div>
        <div class="tech-stack">${tags}</div>
      </div>

      <div class="project-visuals">${visuals}</div>

      <div class="project-desc">
        <h3>Project Overview</h3>
        <p>${escapeHTML(p.description)}</p>
        ${link}
      </div>
    </article>`;
}

async function renderProjects() {
  const mount = document.getElementById("projects-list");
  if (!mount) return;
  try {
    const projects = await fetchJSON("data/projects.json");
    mount.innerHTML = projects.map(projectCardHTML).join("");
  } catch (err) {
    mount.innerHTML = `<p style="font-family: var(--font-mono); color: var(--graphite);">Couldn't load projects right now (${escapeHTML(err.message)}).</p>`;
    console.error(err);
  }
}

/* ---------------------------------------------------------
   MILESTONES — used by about.html, rendered as a
   "Revision History" table (title-block motif)
   --------------------------------------------------------- */
function revisionRowHTML(m, revNumber) {
  return `
    <tr>
      <td class="rev-num">${String(revNumber).padStart(3, "0")}</td>
      <td class="rev-date">${escapeHTML(m.date)}</td>
      <td class="rev-desc">
        <strong>${escapeHTML(m.title)}</strong>
        <p>${escapeHTML(m.description || "")}</p>
      </td>
      <td class="rev-tag-cell"><span class="rev-tag">${escapeHTML(m.tag || "")}</span></td>
    </tr>`;
}

async function renderMilestones() {
  const mount = document.getElementById("revision-history-body");
  if (!mount) return;
  try {
    const milestones = await fetchJSON("data/milestones.json");
    // Oldest first so REV numbers climb chronologically, newest at bottom
    // like a real drawing revision log — but display newest-first visually.
    const sorted = [...milestones].sort((a, b) => (a.date > b.date ? 1 : -1));
    const rows = sorted
      .map((m, i) => revisionRowHTML(m, i + 1))
      .reverse()
      .join("");
    mount.innerHTML = rows;
  } catch (err) {
    mount.innerHTML = `<tr><td colspan="4" style="font-family: var(--font-mono); color: var(--graphite); padding: 16px;">Couldn't load milestones right now (${escapeHTML(err.message)}).</td></tr>`;
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderProjects();
  renderMilestones();
});
