/* =========================================================
   ADMIN.JS
   A tiny client-side CMS for a GitHub Pages portfolio.

   How it works: you paste a GitHub personal access token
   (scoped to this repo only). This page then talks directly
   to the GitHub REST API from your browser — reading and
   writing data/projects.json and data/milestones.json, and
   uploading any images you attach — so new work appears on
   the live site after GitHub Pages rebuilds (~1 minute),
   without you touching any HTML.

   The token lives only in this browser tab's sessionStorage.
   It is never sent anywhere except https://api.github.com.
   ========================================================= */

const CONFIG = {
  owner: "BeninDeCrazyProgrammer",
  repo: "BeninDeCrazyProgrammer.github.io",
  branch: null, // resolved from the repo's default branch on connect
};

const state = {
  token: sessionStorage.getItem("gh_admin_token") || "",
};

/* ---------------------------------------------------------
   Low-level GitHub API helpers
   --------------------------------------------------------- */
function ghHeaders() {
  return {
    Authorization: `Bearer ${state.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghRepoInfo() {
  const res = await fetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}`, {
    headers: ghHeaders(),
  });
  if (!res.ok) throw new Error(`Could not reach repo (${res.status}). Check the token and repo name.`);
  return res.json();
}

async function getFile(path) {
  const res = await fetch(
    `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}?ref=${CONFIG.branch}`,
    { headers: ghHeaders() }
  );
  if (!res.ok) throw new Error(`Could not read ${path} (${res.status})`);
  const json = await res.json();
  const bytes = Uint8Array.from(atob(json.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
  const text = new TextDecoder("utf-8").decode(bytes);
  return { text, sha: json.sha };
}

async function putFile(path, contentStr, message, sha) {
  const bytes = new TextEncoder().encode(contentStr);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  const base64 = btoa(binary);

  const body = { message, content: base64, branch: CONFIG.branch };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`,
    { method: "PUT", headers: { ...ghHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Could not write ${path} (${res.status})`);
  }
  return res.json();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function uploadImage(file) {
  const base64 = await readFileAsBase64(file);
  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "-")}`;
  const path = `images/uploads/${safeName}`;
  const res = await fetch(
    `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`,
    {
      method: "PUT",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Upload image: ${safeName}`, content: base64, branch: CONFIG.branch }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Could not upload ${file.name} (${res.status})`);
  }
  return path;
}

/* ---------------------------------------------------------
   UI status helper
   --------------------------------------------------------- */
function setStatus(el, kind, message) {
  el.className = `admin-status show ${kind}`;
  el.textContent = message;
}

/* ---------------------------------------------------------
   Connect
   --------------------------------------------------------- */
async function connect(presetToken) {
  const tokenInput = document.getElementById("gh-token");
  const status = document.getElementById("connect-status");
  const token = presetToken || tokenInput.value.trim();
  if (!token) {
    setStatus(status, "err", "Paste a token first.");
    return;
  }
  state.token = token;
  setStatus(status, "pending", "Connecting…");
  try {
    const info = await ghRepoInfo();
    CONFIG.branch = info.default_branch;
    if (info.permissions && info.permissions.push === false) {
      throw new Error("This token can read the repo but not write to it. Use a token with Contents: Read and write.");
    }
    sessionStorage.setItem("gh_admin_token", token);
    setStatus(status, "ok", `Connected to ${CONFIG.owner}/${CONFIG.repo} (branch: ${CONFIG.branch}).`);
    document.getElementById("admin-forms").style.display = "block";
    tokenInput.value = "••••••••••••••••";
    await Promise.all([loadProjectsList(), loadMilestonesList()]);
  } catch (err) {
    setStatus(status, "err", err.message);
  }
}

/* ---------------------------------------------------------
   Projects: add / list / delete
   --------------------------------------------------------- */
function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function collectImageRows() {
  const rows = document.querySelectorAll("#image-repeater .image-repeater-row");
  return Array.from(rows).map((row) => ({
    fileInput: row.querySelector('input[type="file"]'),
    caption: row.querySelector('input[type="text"]').value.trim(),
  }));
}

function addImageRow() {
  const wrap = document.getElementById("image-repeater");
  const row = document.createElement("div");
  row.className = "image-repeater-row";
  row.innerHTML = `
    <input type="file" accept="image/*">
    <input type="text" placeholder="Caption, e.g. FIG. 03 — Detail view">
    <button type="button" class="btn-delete" onclick="this.parentElement.remove()">Remove</button>
  `;
  wrap.appendChild(row);
}

async function addProject(evt) {
  evt.preventDefault();
  const status = document.getElementById("project-status");
  const title = document.getElementById("p-title").value.trim();
  const type = document.getElementById("p-type").value.trim();
  const tags = document.getElementById("p-tags").value.trim();
  const description = document.getElementById("p-description").value.trim();
  const linkLabel = document.getElementById("p-link-label").value.trim();
  const linkUrl = document.getElementById("p-link-url").value.trim();

  if (!title || !description) {
    setStatus(status, "err", "Title and description are required.");
    return;
  }

  setStatus(status, "pending", "Uploading images and committing…");
  try {
    const imageRows = collectImageRows();
    const images = [];
    for (const row of imageRows) {
      const file = row.fileInput.files[0];
      if (!file) continue;
      setStatus(status, "pending", `Uploading ${file.name}…`);
      const path = await uploadImage(file);
      images.push({ src: path, caption: row.caption });
    }

    const { text, sha } = await getFile("data/projects.json");
    const projects = JSON.parse(text);
    projects.unshift({
      id: `${slugify(title)}-${Date.now()}`,
      title,
      type,
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      images,
      description,
      link: linkLabel && linkUrl ? { label: linkLabel, url: linkUrl } : null,
    });

    setStatus(status, "pending", "Saving projects.json…");
    await putFile("data/projects.json", JSON.stringify(projects, null, 2), `Add project: ${title}`, sha);

    setStatus(status, "ok", `"${title}" added. It'll appear on the live site once GitHub Pages rebuilds (~1 min).`);
    document.getElementById("project-form").reset();
    document.getElementById("image-repeater").innerHTML = "";
    addImageRow();
    addImageRow();
    await loadProjectsList();
  } catch (err) {
    setStatus(status, "err", err.message);
  }
}

async function loadProjectsList() {
  const mount = document.getElementById("projects-manage-list");
  try {
    const { text } = await getFile("data/projects.json");
    const projects = JSON.parse(text);
    mount.innerHTML = projects
      .map(
        (p) => `
        <div class="entry-row">
          <div>
            <div class="entry-title">${p.title}</div>
            <div class="entry-meta">${p.type || ""}</div>
          </div>
          <button class="btn-delete" onclick="deleteProject('${p.id}')">Delete</button>
        </div>`
      )
      .join("") || `<p class="admin-sub">No projects yet.</p>`;
  } catch (err) {
    mount.innerHTML = `<p class="admin-sub">Couldn't load list (${err.message}).</p>`;
  }
}

async function deleteProject(id) {
  if (!confirm("Delete this project? This commits directly to the repo.")) return;
  const status = document.getElementById("project-status");
  setStatus(status, "pending", "Deleting…");
  try {
    const { text, sha } = await getFile("data/projects.json");
    const projects = JSON.parse(text).filter((p) => p.id !== id);
    await putFile("data/projects.json", JSON.stringify(projects, null, 2), `Delete project: ${id}`, sha);
    setStatus(status, "ok", "Deleted.");
    await loadProjectsList();
  } catch (err) {
    setStatus(status, "err", err.message);
  }
}

/* ---------------------------------------------------------
   Milestones: add / list / delete
   --------------------------------------------------------- */
async function addMilestone(evt) {
  evt.preventDefault();
  const status = document.getElementById("milestone-status");
  const date = document.getElementById("m-date").value.trim();
  const title = document.getElementById("m-title").value.trim();
  const description = document.getElementById("m-description").value.trim();
  const tag = document.getElementById("m-tag").value;

  if (!date || !title) {
    setStatus(status, "err", "Date and title are required.");
    return;
  }

  setStatus(status, "pending", "Committing…");
  try {
    const { text, sha } = await getFile("data/milestones.json");
    const milestones = JSON.parse(text);
    milestones.push({
      id: `${slugify(title)}-${Date.now()}`,
      date,
      title,
      description,
      tag,
    });
    await putFile("data/milestones.json", JSON.stringify(milestones, null, 2), `Add milestone: ${title}`, sha);
    setStatus(status, "ok", `"${title}" added to the timeline.`);
    document.getElementById("milestone-form").reset();
    await loadMilestonesList();
  } catch (err) {
    setStatus(status, "err", err.message);
  }
}

async function loadMilestonesList() {
  const mount = document.getElementById("milestones-manage-list");
  try {
    const { text } = await getFile("data/milestones.json");
    const milestones = JSON.parse(text).sort((a, b) => (a.date < b.date ? 1 : -1));
    mount.innerHTML = milestones
      .map(
        (m) => `
        <div class="entry-row">
          <div>
            <div class="entry-title">${m.title}</div>
            <div class="entry-meta">${m.date} · ${m.tag || ""}</div>
          </div>
          <button class="btn-delete" onclick="deleteMilestone('${m.id}')">Delete</button>
        </div>`
      )
      .join("") || `<p class="admin-sub">No milestones yet.</p>`;
  } catch (err) {
    mount.innerHTML = `<p class="admin-sub">Couldn't load list (${err.message}).</p>`;
  }
}

async function deleteMilestone(id) {
  if (!confirm("Delete this milestone? This commits directly to the repo.")) return;
  const status = document.getElementById("milestone-status");
  setStatus(status, "pending", "Deleting…");
  try {
    const { text, sha } = await getFile("data/milestones.json");
    const milestones = JSON.parse(text).filter((m) => m.id !== id);
    await putFile("data/milestones.json", JSON.stringify(milestones, null, 2), `Delete milestone: ${id}`, sha);
    setStatus(status, "ok", "Deleted.");
    await loadMilestonesList();
  } catch (err) {
    setStatus(status, "err", err.message);
  }
}

/* ---------------------------------------------------------
   Init
   --------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("connect-btn").addEventListener("click", () => connect());
  document.getElementById("project-form").addEventListener("submit", addProject);
  document.getElementById("milestone-form").addEventListener("submit", addMilestone);
  document.getElementById("add-image-row").addEventListener("click", addImageRow);
  addImageRow();
  addImageRow();

  // Auto-reconnect within the same tab session
  if (state.token) {
    document.getElementById("gh-token").value = "••••••••••••••••";
    connect(state.token);
  }
});
