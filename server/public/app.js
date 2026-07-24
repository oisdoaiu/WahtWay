const state = {
  skills: [],
  selected: null,
  token: localStorage.getItem("skillHubToken") || "",
  user: null,
  authMode: "login",
};

const els = {
  hubStatus: document.querySelector("#hubStatus"),
  userBadge: document.querySelector("#userBadge"),
  authBtn: document.querySelector("#authBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  searchInput: document.querySelector("#searchInput"),
  sortSelect: document.querySelector("#sortSelect"),
  skillCount: document.querySelector("#skillCount"),
  refreshBtn: document.querySelector("#refreshBtn"),
  skillsList: document.querySelector("#skillsList"),
  emptyDetail: document.querySelector("#emptyDetail"),
  skillDetail: document.querySelector("#skillDetail"),
  detailCategory: document.querySelector("#detailCategory"),
  detailName: document.querySelector("#detailName"),
  detailDesc: document.querySelector("#detailDesc"),
  detailVersion: document.querySelector("#detailVersion"),
  detailDownloads: document.querySelector("#detailDownloads"),
  detailRating: document.querySelector("#detailRating"),
  detailTags: document.querySelector("#detailTags"),
  inputList: document.querySelector("#inputList"),
  versionList: document.querySelector("#versionList"),
  downloadUrl: document.querySelector("#downloadUrl"),
  downloadBtn: document.querySelector("#downloadBtn"),
  openUploadBtn: document.querySelector("#openUploadBtn"),
  uploadModal: document.querySelector("#uploadModal"),
  uploadForm: document.querySelector("#uploadForm"),
  closeUploadBtn: document.querySelector("#closeUploadBtn"),
  cancelUploadBtn: document.querySelector("#cancelUploadBtn"),
  loadExampleBtn: document.querySelector("#loadExampleBtn"),
  uploadMsg: document.querySelector("#uploadMsg"),
  versionInput: document.querySelector("#versionInput"),
  visibilityInput: document.querySelector("#visibilityInput"),
  authorInput: document.querySelector("#authorInput"),
  categoryInput: document.querySelector("#categoryInput"),
  tagsInput: document.querySelector("#tagsInput"),
  changelogInput: document.querySelector("#changelogInput"),
  manifestInput: document.querySelector("#manifestInput"),
  authModal: document.querySelector("#authModal"),
  authForm: document.querySelector("#authForm"),
  authTitle: document.querySelector("#authTitle"),
  closeAuthBtn: document.querySelector("#closeAuthBtn"),
  cancelAuthBtn: document.querySelector("#cancelAuthBtn"),
  loginModeBtn: document.querySelector("#loginModeBtn"),
  registerModeBtn: document.querySelector("#registerModeBtn"),
  displayNameLabel: document.querySelector("#displayNameLabel"),
  authUsername: document.querySelector("#authUsername"),
  authDisplayName: document.querySelector("#authDisplayName"),
  authPassword: document.querySelector("#authPassword"),
  authMsg: document.querySelector("#authMsg"),
  submitAuthBtn: document.querySelector("#submitAuthBtn"),
};

const exampleSkill = {
  id: "essay-outline",
  name: "论文大纲助手",
  description: "根据主题、课程要求和篇幅生成论文大纲。",
  systemPrompt:
    "你是一个论文大纲助手。你需要根据用户提供的主题、课程要求和篇幅，输出结构清晰、层级明确、可执行的论文大纲，并给出每一部分的写作重点。",
  input: {
    type: "object",
    properties: {
      topic: { type: "string", description: "论文主题" },
      requirement: { type: "string", description: "课程要求或评分标准" },
      length: { type: "string", description: "目标篇幅" },
    },
    required: ["topic"],
  },
  output: {
    type: "object",
    properties: {
      outline: { type: "string", description: "Markdown 格式论文大纲" },
    },
  },
  requiredTools: [],
  keywords: ["论文", "大纲", "写作", "课程", "作业"],
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

async function requestJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${state.token}`);
  }
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function setSession(token, user) {
  state.token = token || "";
  state.user = user || null;
  if (state.token) {
    localStorage.setItem("skillHubToken", state.token);
  } else {
    localStorage.removeItem("skillHubToken");
  }
  updateAuthUi();
}

function updateAuthUi() {
  if (state.user) {
    els.userBadge.textContent = state.user.displayName || state.user.username;
    els.userBadge.classList.remove("hidden");
    els.authBtn.classList.add("hidden");
    els.logoutBtn.classList.remove("hidden");
    els.openUploadBtn.textContent = "发布 Skill";
  } else {
    els.userBadge.textContent = "";
    els.userBadge.classList.add("hidden");
    els.authBtn.classList.remove("hidden");
    els.logoutBtn.classList.add("hidden");
    els.openUploadBtn.textContent = "登录后发布";
  }
}

async function loadCurrentUser() {
  if (!state.token) {
    updateAuthUi();
    return;
  }

  try {
    const data = await requestJson("/api/auth/me");
    state.user = data.user;
  } catch {
    setSession("", null);
    return;
  }
  updateAuthUi();
}

async function loadSkills() {
  const params = new URLSearchParams();
  const q = els.searchInput.value.trim();
  if (q) params.set("q", q);
  params.set("sort", els.sortSelect.value);

  els.hubStatus.textContent = "同步中";
  const data = await requestJson(`/api/skills?${params.toString()}`);
  state.skills = data.skills || [];
  els.skillCount.textContent = `${state.skills.length} 个 Skill`;
  els.hubStatus.textContent = "已连接";
  renderSkills();

  if (state.selected && !state.skills.some((item) => item.skillId === state.selected.skillId)) {
    clearDetail();
  }
}

function renderSkills() {
  if (state.skills.length === 0) {
    els.skillsList.innerHTML = '<div class="empty-state"><h2>暂无结果</h2></div>';
    return;
  }

  els.skillsList.innerHTML = state.skills
    .map((skill) => {
      const tags = (skill.tags || skill.keywords || [])
        .slice(0, 4)
        .map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`)
        .join("");
      const active = state.selected?.skillId === skill.skillId ? " active" : "";
      return `
        <button class="skill-card${active}" type="button" data-skill-id="${escapeHtml(skill.skillId)}">
          <h3>${escapeHtml(skill.name)}</h3>
          <p>${escapeHtml(skill.description)}</p>
          <div class="card-meta">
            <span class="pill">v${escapeHtml(skill.version)}</span>
            <span class="pill">${Number(skill.downloadCount || 0)} 下载</span>
            ${tags}
          </div>
        </button>
      `;
    })
    .join("");
}

async function selectSkill(skillId) {
  const data = await requestJson(`/api/skills/${encodeURIComponent(skillId)}`);
  state.selected = data.skill;
  state.selected.versions = data.versions || [];
  renderSkills();
  renderDetail();
}

function clearDetail() {
  state.selected = null;
  els.emptyDetail.classList.remove("hidden");
  els.skillDetail.classList.add("hidden");
  renderSkills();
}

function renderDetail() {
  const skill = state.selected;
  if (!skill) return clearDetail();

  els.emptyDetail.classList.add("hidden");
  els.skillDetail.classList.remove("hidden");
  els.detailCategory.textContent = [skill.category, skill.authorName].filter(Boolean).join(" / ") || skill.skillId;
  els.detailName.textContent = skill.name;
  els.detailDesc.textContent = skill.description;
  els.detailVersion.textContent = `v${skill.version}`;
  els.detailDownloads.textContent = Number(skill.downloadCount || 0).toString();
  els.detailRating.textContent = skill.ratingCount ? `${skill.ratingAverage} / 5` : "-";
  els.downloadUrl.value = `${window.location.origin}/api/skills/${skill.skillId}/download`;

  const tags = (skill.tags || skill.keywords || [])
    .map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`)
    .join("");
  els.detailTags.innerHTML = tags || '<span class="pill">无标签</span>';

  const properties = skill.input?.properties || {};
  const required = new Set(skill.input?.required || []);
  const fields = Object.entries(properties);
  els.inputList.innerHTML =
    fields.length > 0
      ? fields
          .map(([name, item]) => {
            const mark = required.has(name) ? "必填" : "可选";
            return `<li><strong>${escapeHtml(name)} · ${escapeHtml(item.type)} · ${mark}</strong>${escapeHtml(
              item.description || ""
            )}</li>`;
          })
          .join("")
      : "<li>无特定输入字段</li>";

  els.versionList.innerHTML =
    (skill.versions || []).length > 0
      ? skill.versions
          .map((item) => {
            const date = new Date(item.createdAt).toLocaleDateString("zh-CN");
            const changelog = item.changelog ? ` · ${escapeHtml(item.changelog)}` : "";
            return `<li><strong>v${escapeHtml(item.version)}</strong>${date}${changelog}</li>`;
          })
          .join("")
      : "<li>暂无版本记录</li>";
}

async function downloadSelected() {
  if (!state.selected) return;
  els.downloadBtn.disabled = true;
  try {
    const data = await requestJson(`/api/skills/${encodeURIComponent(state.selected.skillId)}/download`);
    const fileName = `${data.skill.id || state.selected.skillId}.json`;
    const blob = new Blob([JSON.stringify(data.skill, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    await loadSkills();
    await selectSkill(state.selected.skillId);
  } finally {
    els.downloadBtn.disabled = false;
  }
}

function openUpload() {
  if (!state.user) {
    openAuth("login");
    return;
  }
  els.uploadMsg.textContent = "";
  els.authorInput.value = state.user.displayName || state.user.username;
  els.uploadModal.classList.remove("hidden");
  els.manifestInput.focus();
}

function closeUpload() {
  els.uploadModal.classList.add("hidden");
}

function parseTags(value) {
  return value
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function submitUpload(event) {
  event.preventDefault();
  els.uploadMsg.textContent = "";

  let manifest;
  try {
    const parsed = JSON.parse(els.manifestInput.value);
    manifest = parsed.manifest || parsed;
  } catch (err) {
    els.uploadMsg.textContent = "Skill JSON 格式不正确";
    return;
  }

  const body = {
    manifest,
    version: els.versionInput.value.trim() || "1.0.0",
    visibility: els.visibilityInput.value,
    category: els.categoryInput.value.trim() || undefined,
    tags: parseTags(els.tagsInput.value),
    changelog: els.changelogInput.value.trim() || undefined,
  };

  const submitBtn = els.uploadForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const created = await requestJson("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    closeUpload();
    els.uploadForm.reset();
    els.versionInput.value = "1.0.0";
    els.authorInput.value = state.user?.displayName || state.user?.username || "";
    await loadSkills();
    await selectSkill(created.skill.skillId);
  } catch (err) {
    els.uploadMsg.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
  }
}

function loadExample() {
  els.versionInput.value = "1.0.0";
  els.visibilityInput.value = "public";
  els.authorInput.value = state.user?.displayName || state.user?.username || "";
  els.categoryInput.value = "学习";
  els.tagsInput.value = "写作, 学习";
  els.changelogInput.value = "首次发布";
  els.manifestInput.value = JSON.stringify(exampleSkill, null, 2);
  els.uploadMsg.textContent = "";
}

function openAuth(mode = "login") {
  setAuthMode(mode);
  els.authMsg.textContent = "";
  els.authModal.classList.remove("hidden");
  els.authUsername.focus();
}

function closeAuth() {
  els.authModal.classList.add("hidden");
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  els.authTitle.textContent = isRegister ? "注册" : "登录";
  els.submitAuthBtn.textContent = isRegister ? "注册" : "登录";
  els.displayNameLabel.classList.toggle("hidden", !isRegister);
  els.loginModeBtn.classList.toggle("active", !isRegister);
  els.registerModeBtn.classList.toggle("active", isRegister);
  els.authPassword.setAttribute("autocomplete", isRegister ? "new-password" : "current-password");
}

async function submitAuth(event) {
  event.preventDefault();
  els.authMsg.textContent = "";
  const username = els.authUsername.value.trim();
  const password = els.authPassword.value;
  const endpoint = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
  const body = { username, password };
  if (state.authMode === "register") {
    body.displayName = els.authDisplayName.value.trim() || undefined;
  }

  els.submitAuthBtn.disabled = true;
  try {
    const data = await requestJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSession(data.token, data.user);
    els.authForm.reset();
    closeAuth();
  } catch (err) {
    els.authMsg.textContent = err.message;
  } finally {
    els.submitAuthBtn.disabled = false;
  }
}

function logout() {
  setSession("", null);
  els.hubStatus.textContent = "已退出";
}

els.skillsList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-skill-id]");
  if (!card) return;
  selectSkill(card.dataset.skillId).catch((err) => {
    els.hubStatus.textContent = err.message;
  });
});

els.refreshBtn.addEventListener("click", () => loadSkills().catch((err) => (els.hubStatus.textContent = err.message)));
els.searchInput.addEventListener("input", debounce(() => loadSkills().catch((err) => (els.hubStatus.textContent = err.message)), 220));
els.sortSelect.addEventListener("change", () => loadSkills().catch((err) => (els.hubStatus.textContent = err.message)));
els.downloadBtn.addEventListener("click", () => downloadSelected().catch((err) => (els.hubStatus.textContent = err.message)));
els.openUploadBtn.addEventListener("click", openUpload);
els.authBtn.addEventListener("click", () => openAuth("login"));
els.logoutBtn.addEventListener("click", logout);
els.closeUploadBtn.addEventListener("click", closeUpload);
els.cancelUploadBtn.addEventListener("click", closeUpload);
els.loadExampleBtn.addEventListener("click", loadExample);
els.uploadForm.addEventListener("submit", submitUpload);
els.closeAuthBtn.addEventListener("click", closeAuth);
els.cancelAuthBtn.addEventListener("click", closeAuth);
els.loginModeBtn.addEventListener("click", () => setAuthMode("login"));
els.registerModeBtn.addEventListener("click", () => setAuthMode("register"));
els.authForm.addEventListener("submit", submitAuth);
els.uploadModal.addEventListener("click", (event) => {
  if (event.target === els.uploadModal) closeUpload();
});
els.authModal.addEventListener("click", (event) => {
  if (event.target === els.authModal) closeAuth();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!els.uploadModal.classList.contains("hidden")) closeUpload();
    if (!els.authModal.classList.contains("hidden")) closeAuth();
  }
});

updateAuthUi();
loadCurrentUser()
  .catch(() => updateAuthUi())
  .finally(() => {
    loadSkills().catch((err) => {
      els.hubStatus.textContent = err.message;
    });
  });
