(() => {
  "use strict";

  const app = window.EgeaApp;
  if (!app) {
    console.error("No se ha podido iniciar el adaptador central.");
    return;
  }

  const central = {
    user: null,
    versions: new Map(),
    orders: [],
    saveTimers: new Map(),
    pendingSaves: new Map(),
    saveChains: new Map(),
    hydrating: false,
    conflict: null,
    users: [],
    csrf: null,
    jobs: new Map(),
    others: new Map(),
    othersLoaded: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  // Réplicas locales de helpers definidos en el IIFE de index.html.
  // Esas funciones no son globales, así que central.js necesita su propia copia
  // para abrir/cerrar modales y mostrar toasts sin acoplarse a detalles del DOM.
  const q = (selector, root = document) => root.querySelector(selector);
  const openModal = (id) => document.getElementById(id)?.classList.add("open");
  const closeModal = (id) =>
    document.getElementById(id)?.classList.remove("open");
  const toast = (text, bad = false) => {
    const wrap = document.getElementById("toasts");
    if (!wrap) return;
    const el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : "");
    el.textContent = text;
    wrap.append(el);
    setTimeout(() => el.remove(), 2800);
  };
  // Alias para que las funciones añadidas (matriz, impersonación) usen el
  // nombre corto que se usa en el resto del IIFE de index.html.
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>'"]/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[c],
    );
  const esc = escapeHtml;
  const number = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const parsed = parseFloat(
      String(value ?? "")
        .trim()
        .replace(",", "."),
    );
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const formatNumber = (value, digits = 2) =>
    number(value).toLocaleString("es-ES", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  const formatDateTime = (value) =>
    value
      ? new Date(value).toLocaleString("es-ES", {
          dateStyle: "short",
          timeStyle: "short",
        })
      : "—";
  const hasData = (row) =>
    Boolean(
      String(row?.room ?? "").trim() ||
      number(row?.width) ||
      number(row?.height) ||
      String(row?.notes ?? "").trim(),
    );
  const readyRows = (state) =>
    (state?.rows || []).filter(
      (row) =>
        String(row.room ?? "").trim() &&
        number(row.width) > 0 &&
        number(row.height) > 0,
    );
  const dataRows = (state) => (state?.rows || []).filter(hasData);
  const debounce = (fn, ms = 150) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  const STATUS_LABELS = {
    sent: "Enviada",
    received: "Recibida",
    printed: "Impresa",
    in_process: "En proceso",
    completed: "Finalizada",
    cancelled: "Cancelada",
  };

  let PERMISSIONS = [
    ["jobs_view", "Ver trabajos", "Trabajos"],
    ["jobs_create", "Crear trabajos", "Trabajos"],
    ["jobs_edit", "Editar trabajos", "Trabajos"],
    ["jobs_delete", "Eliminar trabajos", "Trabajos"],
    ["jobs_restore", "Restaurar trabajos", "Trabajos"],
    ["excel_import", "Importar Excel o CSV", "Importación"],
    ["history_view", "Consultar historial", "Trabajos"],
    ["orders_view", "Ver órdenes de corte", "Órdenes"],
    ["orders_create", "Crear órdenes de corte", "Órdenes"],
    ["orders_approve", "Aprobar, reabrir o cancelar órdenes", "Órdenes"],
    ["orders_print", "Imprimir órdenes", "Órdenes"],
    ["orders_receive", "Confirmar recepción en corte", "Taller"],
    ["orders_complete", "Finalizar órdenes de corte", "Taller"],
    ["users_manage", "Administrar usuarios", "Administración"],
    ["permissions_manage", "Administrar roles y permisos", "Administración"],
  ];

  let ROLE_DEFAULTS = {
    admin: PERMISSIONS.map(([key]) => key),
    office: [
      "jobs_view",
      "jobs_create",
      "jobs_edit",
      "excel_import",
      "history_view",
      "orders_view",
      "orders_create",
    ],
    cut: ["orders_view", "orders_print", "orders_receive", "orders_complete"],
  };

  const can = (permission) =>
    Boolean(central.user?.permissions?.includes(permission));
  const permissionLabel = (key) =>
    PERMISSIONS.find(([id]) => id === key)?.[1] || key;

  function setSync(status, text) {
    const el = $("#centralSyncStatus");
    if (!el) return;
    el.className = `central-sync ${status}`;
    el.textContent = text;
  }

  function detailMessage(detail) {
    if (!detail) return "Se ha producido un error.";
    if (typeof detail === "string") return detail;
    if (detail.message) return detail.message;
    return JSON.stringify(detail);
  }

  async function api(path, options = {}) {
    const init = { ...options, headers: { ...(options.headers || {}) } };
    const method = String(init.method || "GET").toUpperCase();
    if (
      !["GET", "HEAD", "OPTIONS"].includes(method) &&
      central.csrf &&
      path !== "/api/auth/login"
    ) {
      init.headers["X-CSRF-Token"] = central.csrf;
    }
    if (init.body && typeof init.body !== "string") {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(init.body);
    }
    try {
      const response = await fetch(path, init);
      const type = response.headers.get("content-type") || "";
      const payload = type.includes("application/json")
        ? await response.json()
        : null;
      if (!response.ok) {
        const error = new Error(
          detailMessage(payload?.detail) || `Error ${response.status}`,
        );
        error.status = response.status;
        error.payload = payload;
        if (
          response.status === 401 &&
          !["/api/auth/login", "/api/auth/me"].includes(path)
        )
          sessionExpired();
        throw error;
      }
      return payload;
    } catch (error) {
      if (!error.status) setSync("offline", "Sin conexión");
      throw error;
    }
  }

  function injectSessionControls() {
    if ($("#centralSession")) return;
    const container = document.createElement("div");
    container.className = "central-session";
    container.id = "centralSession";
    container.innerHTML = `
      <button class="central-sync saved" id="centralSyncStatus" title="Actualizar trabajos del servidor">Sincronizado</button>
      <div class="central-user-chip"><div class="central-avatar" id="centralAvatar">U</div><div><span id="centralUserName"></span><small id="centralUserRole"></small></div></div>
      <button class="btn small" id="centralLogoutBtn">Salir</button>`;
    $(".top-actions")?.append(container);
    $("#centralSyncStatus").addEventListener("click", async () => {
      try {
        await flushCurrentSave();
        await refreshCentralJobs();
        app.toast("Trabajos actualizados desde el servidor");
      } catch (error) {
        app.toast(error.message, true);
      }
    });
    $("#centralLogoutBtn").addEventListener("click", logout);
  }

  function applyRole(user) {
    document.body.classList.remove(
      "role-admin",
      "role-office",
      "role-cut",
      "workshop-shell",
    );
    document.body.classList.add(`role-${user.role}`);
    const workshopOnly =
      user.role === "cut" &&
      !can("jobs_view") &&
      !can("orders_create") &&
      !can("users_manage");
    if (workshopOnly) document.body.classList.add("workshop-shell");
    $("#centralUserName").textContent = user.full_name || user.username;
    $("#centralUserRole").textContent =
      user.role === "admin"
        ? "Administrador"
        : user.role === "office"
          ? "Oficina"
          : "Operario de corte";
    $("#centralAvatar").textContent = (user.full_name || user.username)
      .slice(0, 2)
      .toUpperCase();

    const visibility = {
      jobsBtn: can("jobs_view"),
      templatesBtn: can("jobs_edit"),
      saveBtn: can("jobs_edit"),
      importBtn: can("excel_import"),
      exportBtn: can("jobs_view"),
      printActiveBtn: can("orders_print") || can("jobs_view"),
      historyBtn: can("history_view"),
      centralCreateOrderBtn: can("orders_create"),
    };
    Object.entries(visibility).forEach(([id, visible]) => {
      const el = $(`#${id}`);
      if (el) el.hidden = !visible;
    });
    $$("[data-view]").forEach((button) => {
      const view = button.dataset.view;
      const allowed =
        view === "usuarios"
          ? can("users_manage")
          : view === "ordenes"
            ? can("orders_view")
            : view === "taller"
              ? can("orders_view")
              : [
                    "relacion",
                    "resumen",
                    "confeccion",
                    "corte",
                    "revisar",
                    "produccion",
                    "etiquetas",
                    "rieles",
                    "rielesdobles",
                    "checklist",
                  ].includes(view)
                ? can("jobs_view")
                : true;
      button.hidden = !allowed;
    });
    if (!can("jobs_edit")) document.body.classList.add("role-cut");
    if (workshopOnly || (!can("jobs_view") && can("orders_view")))
      app.switchView("taller");
    const brandTitle = $(".brand strong");
    const brandSub = $(".brand small");
    if (workshopOnly) {
      if (brandTitle) brandTitle.textContent = "Puesto de corte";
      if (brandSub) brandSub.textContent = "Órdenes de producción";
    }
  }

  function loginOverlay() {
    let overlay = $("#centralLoginOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "central-login-overlay";
    overlay.id = "centralLoginOverlay";
    overlay.innerHTML = `
      <div class="central-login-card">
        <div class="central-login-logo"><div class="mark">HC</div><div><h1>Confección Central</h1><p>Decoraciones Egea</p></div></div>
        <form id="centralLoginForm">
          <div class="error" id="centralLoginError"></div>
          <label class="field"><span>Usuario</span><input id="centralLoginUser" autocomplete="username" required></label>
          <label class="field"><span>Contraseña</span><input id="centralLoginPassword" type="password" autocomplete="current-password" required></label>
          <button class="btn primary" type="submit">Entrar</button>
        </form>
        <div class="central-login-foot">Los trabajos, órdenes e historial se guardan en el servidor central.</div>
      </div>`;
    document.body.append(overlay);
    $("#centralLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const errorEl = $("#centralLoginError");
      errorEl.classList.remove("show");
      try {
        const result = await api("/api/auth/login", {
          method: "POST",
          body: {
            username: $("#centralLoginUser").value,
            password: $("#centralLoginPassword").value,
          },
        });
        central.user = result.user;
        central.csrf = result.csrf_token;
        overlay.remove();
        await bootstrapSession();
        flushAllPendingSaves();
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.classList.add("show");
      }
    });
    setTimeout(() => $("#centralLoginUser")?.focus(), 0);
    return overlay;
  }

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (_) {}
    central.user = null;
    central.csrf = null;
    central.versions.clear();
    central.jobs.clear();
    app.clearSensitiveState?.();
    $("#centralSession")?.remove();
    loginOverlay();
  }

  // Sesión caducada en caliente (p. ej. tras un deploy/restart del servidor):
  // mostramos el login sin perder los cambios pendientes y, al re-autenticar,
  // reenviamos los guardados en cola.
  let sessionExpiredNoticeAt = 0;
  function sessionExpired() {
    const now = Date.now();
    if (now - sessionExpiredNoticeAt < 1500) return;
    sessionExpiredNoticeAt = now;
    central.csrf = null;
    setSync("error", "Sesión caducada");
    loginOverlay();
  }
  function flushAllPendingSaves() {
    for (const jobId of [...central.pendingSaves.keys()]) flushJob(jobId);
  }

  function mapRemoteJobs(items) {
    const localCurrent = app.getJobsData()?.currentId;
    items.forEach((item) => {
      central.versions.set(item.id, item.version);
      central.jobs.set(item.id, item);
    });
    const jobs = items.map((item) => ({
      id: item.id,
      name: item.name,
      updatedAt: item.updated_at,
      state: item.state,
      versions: item.versions || [],
    }));
    const currentId = jobs.some((job) => job.id === localCurrent)
      ? localCurrent
      : jobs[0]?.id;
    return { currentId, jobs };
  }

  function applyJobLock() {
    const jobId = app.getState()?.jobId;
    // Bloqueado por una orden aprobada o por ser un trabajo de un compañero
    // (solo lectura): en ambos casos la edición queda deshabilitada.
    const locked = Boolean(
      jobId &&
      (central.jobs.get(jobId)?.locked ||
        central.others.has(jobId) ||
        app.isReadOnlyJob(jobId)),
    );
    document.body.classList.toggle("job-locked", locked);
    const controls = [
      "#view-relacion [data-project]",
      "#view-relacion input[data-row]",
      "#view-relacion select[data-row]",
      "#addRowBtn",
      "#addRowsBtn",
      "#applyDefaultsBtn",
      "#openImportModalBtn",
    ];
    $$(controls.join(",")).forEach((control) => {
      control.disabled = locked;
    });
  }

  async function loadOthersJobs() {
    const result = await api("/api/jobs?scope=others");
    central.others.clear();
    result.items.forEach((item) => central.others.set(item.id, item));
    central.othersLoaded = true;
    app.setOthersJobs(result.items);
    return result.items;
  }

  async function refreshCentralJobs() {
    setSync("saving", "Actualizando…");
    const result = await api("/api/jobs");
    if (!result.items.length) {
      central.hydrating = false;
      const state = app.getState();
      const job = app.getCurrentJob();
      queueSave({ state, job });
      setSync("saving", "Creando trabajo…");
      await flushCurrentSave();
      return;
    }
    central.hydrating = true;
    app.setJobsData(mapRemoteJobs(result.items));
    central.hydrating = false;
    setSync("saved", "Sincronizado");
    // Mantener fresca la pestaña de compañeros si ya se abrió alguna vez.
    if (central.othersLoaded) loadOthersJobs().catch(() => {});
    applyJobLock();
    renderCurrentJobCard();
    await checkLocalDrafts(result.items);
  }

  // Si localStorage guarda un borrador más reciente que la versión del servidor,
  // ofrece restaurarlo. Cubre cierres accidentales de pestaña o caídas de red
  // prolongadas.
  async function checkLocalDrafts(serverItems) {
    const candidates = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
        const jobId = key.slice(DRAFT_PREFIX.length);
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const draft = JSON.parse(raw);
        const serverJob = serverItems.find((j) => j.id === jobId);
        const serverTime = serverJob
          ? new Date(serverJob.updated_at || 0).getTime()
          : 0;
        const draftTime = new Date(draft.updatedAt || 0).getTime();
        if (draftTime > serverTime) {
          candidates.push({ jobId, draft, serverJob });
        }
      }
    } catch {}
    if (!candidates.length) return;
    // Sólo restauramos automáticamente el borrador del trabajo actualmente abierto.
    const current = app.getCurrentJob();
    const match = candidates.find((c) => c.jobId === current?.id);
    if (!match) return;
    const restore = await app.askConfirm({
      title: "Borrador local encontrado",
      message: `Hay cambios sin guardar de tu última sesión en «${match.draft.name || "este trabajo"}» (${new Date(match.draft.updatedAt).toLocaleString("es-ES")}). ¿Restaurarlos?`,
      confirmLabel: "Restaurar borrador",
      cancelLabel: "Descartar",
    });
    if (!restore) {
      clearLocalDraft(match.jobId);
      return;
    }
    try {
      central.hydrating = true;
      const restored = app.applyJobState({
        jobId: match.jobId,
        state: match.draft.state,
        job: { name: match.draft.name, versions: match.draft.versions || [] },
      });
      if (restored) {
        await flushCurrentSave();
        clearLocalDraft(match.jobId);
        app.toast("Borrador restaurado y guardado en el servidor");
      }
    } catch (error) {
      app.toast(`No se pudo restaurar el borrador: ${error.message}`, true);
    } finally {
      central.hydrating = false;
    }
  }

  async function bootstrapSession() {
    injectSessionControls();
    app.setOthersLoader(loadOthersJobs);
    try {
      const catalog = await api("/api/permissions");
      const groupFor = (key) =>
        key.startsWith("orders_")
          ? "Órdenes"
          : key.startsWith("users_") || key.startsWith("permissions_")
            ? "Administración"
            : key === "excel_import"
              ? "Importación"
              : "Trabajos";
      PERMISSIONS = (catalog.permissions || []).map((item) => [
        item.key,
        item.label,
        groupFor(item.key),
      ]);
      ROLE_DEFAULTS = catalog.roles || ROLE_DEFAULTS;
    } catch (_) {}
    applyRole(central.user);
    if (can("jobs_view")) await refreshCentralJobs();
    else setSync("saved", "Conectado");
    if (can("orders_view")) await loadOrders();
    if (can("users_manage")) await loadUsers();
    renderPermissionCreate();
  }

  function queueSave(detail) {
    if (
      central.hydrating ||
      !central.user ||
      (!can("jobs_edit") && !can("jobs_create"))
    )
      return;
    const state = detail?.state;
    const job = detail?.job || {};
    if (!state?.jobId) return;
    if (central.jobs.get(state.jobId)?.locked) {
      setSync("conflict", "Trabajo bloqueado");
      return;
    }
    if (central.others.has(state.jobId) || app.isReadOnlyJob(state.jobId)) {
      setSync("saved", "Solo lectura");
      return;
    }
    central.pendingSaves.set(state.jobId, {
      id: state.jobId,
      name: state.project?.hotel || job.name || "Trabajo sin nombre",
      state,
      versions: job.versions || [],
      source: detail?.source || "manual",
    });
    // Respaldo local: si el navegador se cierra o el backend falla, conservamos
    // el último cambio en localStorage para poder restaurarlo en el siguiente login.
    saveLocalDraft(central.pendingSaves.get(state.jobId));
    clearTimeout(central.saveTimers.get(state.jobId));
    setSync("saving", "Guardando…");
    central.saveTimers.set(
      state.jobId,
      setTimeout(() => flushJob(state.jobId), 700),
    );
  }

  async function sendJob(payload) {
    const expectedVersion = central.versions.has(payload.id)
      ? central.versions.get(payload.id)
      : null;
    return api(`/api/jobs/${encodeURIComponent(payload.id)}`, {
      method: "PUT",
      body: {
        name: payload.name,
        state: payload.state,
        versions: payload.versions || [],
        expected_version: expectedVersion,
        change_source: payload.source || "manual",
      },
    });
  }

  async function flushJob(jobId) {
    clearTimeout(central.saveTimers.get(jobId));
    central.saveTimers.delete(jobId);
    const previous = central.saveChains.get(jobId) || Promise.resolve();
    const chain = previous
      .then(async () => {
        while (central.pendingSaves.has(jobId)) {
          const payload = central.pendingSaves.get(jobId);
          central.pendingSaves.delete(jobId);
          try {
            const result = await sendJob(payload);
            central.versions.set(jobId, result.job.version);
            central.jobs.set(jobId, result.job);
            clearLocalDraft(jobId);
            setSync("saved", "Guardado");
          } catch (error) {
            if (error.status === 409) {
              setSync("conflict", "Conflicto");
              central.pendingSaves.delete(jobId);
              showConflict(error.payload?.detail, payload);
              return;
            }
            central.pendingSaves.set(jobId, payload);
            if (error.status === 401) {
              sessionExpired();
              return;
            }
            setSync("error", "Error al guardar");
            app.toast(`No se pudo guardar: ${error.message}`, true);
            return;
          }
        }
      })
      .finally(() => {
        if (central.saveChains.get(jobId) === chain)
          central.saveChains.delete(jobId);
      });
    central.saveChains.set(jobId, chain);
    return chain;
  }

  async function flushCurrentSave() {
    const state = app.getState();
    if (!state?.jobId) return;
    if (central.saveTimers.has(state.jobId)) await flushJob(state.jobId);
    else if (central.saveChains.has(state.jobId))
      await central.saveChains.get(state.jobId);
  }

  // Flush pendiente sincrónico para cierres de pestaña.
  // Usa fetch con keepalive:true para sobrevivir al unload del navegador.
  // Antes de este fix, el beforeunload estaba vacío y los cambios
  // introducidos dentro de la ventana de debounce (~800 ms) se perdían.
  const DRAFT_PREFIX = "egea-draft-v1:";
  function saveLocalDraft(payload) {
    try {
      localStorage.setItem(
        DRAFT_PREFIX + payload.id,
        JSON.stringify({
          name: payload.name,
          state: payload.state,
          versions: payload.versions || [],
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch {
      // localStorage puede estar lleno o deshabilitado; no es crítico.
    }
  }
  function clearLocalDraft(jobId) {
    try {
      localStorage.removeItem(DRAFT_PREFIX + jobId);
    } catch {}
  }
  function flushPendingOnUnload() {
    if (!central.pendingSaves || central.pendingSaves.size === 0) return;
    for (const [jobId, payload] of [...central.pendingSaves.entries()]) {
      const timer = central.saveTimers.get(jobId);
      if (timer) {
        clearTimeout(timer);
        central.saveTimers.delete(jobId);
      }
      central.pendingSaves.delete(jobId);
      saveLocalDraft(payload);
      const expectedVersion = central.versions.has(jobId)
        ? central.versions.get(jobId)
        : null;
      try {
        fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(central.csrf ? { "X-CSRF-Token": central.csrf } : {}),
          },
          body: JSON.stringify({
            name: payload.name,
            state: payload.state,
            versions: payload.versions || [],
            expected_version: expectedVersion,
            change_source: "unload",
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // keepalive es best-effort; el draft local es la red de seguridad.
      }
    }
  }

  function showConflict(detail, localPayload) {
    $("#centralConflict")?.remove();
    const serverJob = detail?.job;
    central.conflict = { serverJob, localPayload };
    const box = document.createElement("div");
    box.className = "central-conflict";
    box.id = "centralConflict";
    box.innerHTML = `
      <h3>El trabajo cambió en otro equipo</h3>
      <p>La versión del servidor es más reciente. Cargue la versión central y repita conscientemente los cambios necesarios.</p>
      <div class="actions"><button class="btn primary" data-conflict="server">Cargar servidor</button></div>`;
    document.body.append(box);
    box.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-conflict]")?.dataset.conflict;
      if (!action) return;
      if (action === "server" && serverJob) {
        central.versions.set(serverJob.id, serverJob.version);
        central.hydrating = true;
        app.upsertRemoteJob(serverJob);
        central.hydrating = false;
        box.remove();
        setSync("saved", "Versión cargada");
      }
    });
  }

  function calculateRow(row, project) {
    const width = number(row.width);
    const height = number(row.height);
    const gather = number(row.gather) || number(project.gather) || 2;
    const sheets = Math.max(
      1,
      Math.round(number(row.sheets) || number(project.mode) || 1),
    );
    // Mismo criterio que calcRowFor (logic.js): el añadido de cierre es una tira
    // plana que NO se frunce; solo el cuerpo del paño lleva fruncido.
    const closureAdd = number(project.closureAdd) || window.FIXED_CLOSURE_ADD;
    const finalHeight = Math.max(0, height - number(project.heightDiscount));
    const standardWidth = Math.round(width / 0.05) * 0.05;
    const cutWidth = (standardWidth / sheets) * gather + closureAdd;
    const cutHeight = Math.round(finalHeight / 0.03) * 0.03;
    const meters = width * gather + closureAdd * sheets;
    return {
      width,
      height,
      gather,
      sheets,
      finalHeight,
      cutWidth,
      cutHeight,
      meters,
      metersPerSheet: sheets ? meters / sheets : meters,
    };
  }

  function currentJobValidation() {
    const state = app.getState();
    const rows = dataRows(state);
    const ready = readyRows(state);
    return { state, rows, ready, invalid: rows.length - ready.length };
  }

  function renderCurrentJobCard() {
    const el = $("#centralCurrentJobCard");
    if (!el) return;
    const { state, rows, ready, invalid } = currentJobValidation();
    const project = state.project || {};
    const locked = Boolean(central.jobs.get(state.jobId)?.locked);
    el.innerHTML = `
      <div class="central-summary-pill accent"><span>Trabajo actual</span><strong>${escapeHtml(project.hotel || "Sin nombre")}</strong></div>
      <div class="central-summary-pill"><span>Habitaciones completas</span><strong>${ready.length}</strong></div>
      <div class="central-summary-pill"><span>Filas incompletas</span><strong>${invalid}</strong></div>
      <div class="central-summary-pill"><span>Estado</span><strong>${locked ? "Aprobado y bloqueado" : rows.length && !invalid ? "Listo para aprobar" : "Revisar datos"}</strong></div>`;
    const button = $("#centralCreateOrderBtn");
    if (button) button.disabled = locked || !ready.length || invalid > 0;
    applyJobLock();
  }

  async function loadOrders() {
    const list = $("#centralOrdersList");
    if (list && !central.orders.length)
      list.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(3);
    const result = await api("/api/orders");
    central.orders = result.items || [];
    renderOrders();
    renderWorkshop();
    const pending = central.orders.filter(
      (order) => !["completed", "cancelled"].includes(order.status),
    ).length;
    $$(".central-orders-badge").forEach(
      (el) => (el.textContent = central.orders.length),
    );
    $$(".central-workshop-badge").forEach((el) => (el.textContent = pending));
  }

  function renderOrders() {
    renderCurrentJobCard();
    const list = $("#centralOrdersList");
    if (!list) return;
    const search = ($("#centralOrderSearch")?.value || "").trim().toLowerCase();
    const filter = $("#centralOrderStatus")?.value || "all";
    const items = central.orders.filter(
      (order) =>
        (filter === "all" || order.status === filter) &&
        (!search ||
          `${order.order_number} ${order.job_name} ${order.fabric}`
            .toLowerCase()
            .includes(search)),
    );
    list.innerHTML = items.length
      ? items.map(orderCard).join("")
      : central.orders.length
        ? '<div class="central-empty-panel">No hay órdenes que coincidan con el filtro.</div>'
        : '<div class="central-empty-panel">Todavía no hay órdenes de corte. Apruebe el trabajo actual («Aprobar y crear orden») para generar la primera.</div>';
  }

  function orderCard(order, workshop = false) {
    const viewButton = can("orders_view")
      ? `<button class="btn small" data-central-order-view="${order.id}">Ver orden</button>`
      : "";
    const printButton = can("orders_print")
      ? `<button class="btn small primary" data-central-order-print="${order.id}" data-document-type="all">Imprimir todo</button>`
      : "";
    const adminButtons =
      !workshop &&
      can("orders_approve") &&
      order.is_current &&
      !["completed", "cancelled"].includes(order.status)
        ? `<button class="btn small" data-central-order-reopen="${order.job_id}">Reabrir trabajo</button><button class="btn small danger" data-central-order-cancel="${order.id}">Cancelar</button>`
        : "";
    return `<article class="central-order-card ${workshop ? "central-workshop-card" : ""}">
      <div class="central-order-main">
        <div class="central-order-number"><strong>${escapeHtml(order.order_number)}</strong><small>Revisión ${order.revision}</small></div>
        <div class="central-order-info"><h3>${escapeHtml(order.job_name || "Trabajo")}</h3><p>${escapeHtml(order.fabric || "Tela sin indicar")} · enviada ${formatDateTime(order.created_at)}</p><div class="central-order-tags"><span class="central-tag">${order.room_count} habitaciones</span><span class="central-tag">${order.panel_count} paños</span><span class="central-tag">${order.print_count} impresiones</span><span class="central-order-status ${order.status}">${STATUS_LABELS[order.status] || order.status}</span></div></div>
      </div>
      <div class="central-order-actions">${viewButton}${printButton}${workshopStatusButtons(order)}${adminButtons}</div>
    </article>`;
  }

  function workshopStatusButtons(order, large = false) {
    const cls = large ? "btn workshop-action" : "btn small";
    if (order.status === "sent" && can("orders_receive"))
      return `<button class="${cls}" data-central-order-status="${order.id}" data-status="received">✓ Confirmar recibida</button>`;
    if (order.status === "received") return "";
    if (
      order.status === "printed" &&
      !order.received_at &&
      can("orders_receive")
    )
      return `<button class="${cls}" data-central-order-status="${order.id}" data-status="received">✓ Confirmar recibida</button>`;
    if (
      ["printed", "in_process"].includes(order.status) &&
      order.received_at &&
      can("orders_complete")
    )
      return `<button class="${cls}" data-central-order-status="${order.id}" data-status="completed">✓ Finalizar corte</button>`;
    return "";
  }

  function renderWorkshop() {
    const list = $("#centralWorkshopList");
    if (!list) return;
    const active = central.orders
      .filter((order) => !["completed", "cancelled"].includes(order.status))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const counts = (status) =>
      central.orders.filter((order) => order.status === status).length;
    const today = new Date().toDateString();
    const completedToday = central.orders.filter(
      (order) =>
        order.status === "completed" &&
        order.completed_at &&
        new Date(order.completed_at).toDateString() === today,
    ).length;
    $("#centralWorkshopKpis").innerHTML = `
      <div class="central-workshop-kpi primary"><span>Por atender</span><strong>${active.length}</strong></div>
      <div class="central-workshop-kpi"><span>Nuevas</span><strong>${counts("sent")}</strong></div>
      <div class="central-workshop-kpi"><span>Impresas</span><strong>${counts("printed")}</strong></div>
      <div class="central-workshop-kpi"><span>Terminadas hoy</span><strong>${completedToday}</strong></div>`;
    if (!active.length) {
      list.innerHTML =
        '<div class="central-workshop-empty"><div class="check">✓</div><h2>Todo al día</h2><p>No hay órdenes pendientes de corte.</p></div>';
      return;
    }
    const [next, ...rest] = active;
    const nextAction = workshopStatusButtons(next, true);
    list.innerHTML = `<article class="central-workshop-next">
      <div class="central-workshop-next-label">Siguiente orden</div>
      <div class="central-workshop-next-grid">
        <div><span class="central-order-status ${next.status}">${STATUS_LABELS[next.status] || next.status}</span><h2>${escapeHtml(next.job_name || "Trabajo")}</h2><div class="order-code">${escapeHtml(next.order_number)}</div><p>${escapeHtml(next.fabric || "Tela sin indicar")}</p></div>
        <div class="central-workshop-bigstats"><div><strong>${next.room_count}</strong><span>Habitaciones</span></div><div><strong>${next.panel_count}</strong><span>Paños</span></div></div>
      </div>
      <div class="central-workshop-next-actions">
        ${can("orders_view") ? `<button class="btn workshop-action secondary" data-central-order-view="${next.id}">Ver medidas</button>` : ""}
        ${can("orders_print") ? `<button class="btn workshop-action primary" data-central-order-print="${next.id}" data-document-type="all">🖨 Imprimir todo</button>` : ""}
        ${nextAction}
      </div>
    </article>
    ${rest.length ? `<div class="central-workshop-pending-title"><h3>Después</h3><span>${rest.length} orden${rest.length === 1 ? "" : "es"}</span></div>${rest.map((order) => orderCard(order, true)).join("")}` : ""}`;
  }

  async function createOrder() {
    const { state, ready, invalid } = currentJobValidation();
    if (!ready.length || invalid) {
      app.toast(
        "Complete todas las habitaciones antes de crear la orden.",
        true,
      );
      return;
    }
    const confirmed = await app.askConfirm({
      title: "Aprobar y crear orden",
      message: `Se creará una orden con ${ready.length} habitaciones y el trabajo quedará bloqueado para edición. ¿Continuar?`,
      confirmLabel: "Crear orden",
    });
    if (!confirmed) return;
    try {
      await flushCurrentSave();
      const expectedVersion = central.versions.get(state.jobId);
      if (!expectedVersion)
        throw new Error(
          "No se conoce la versión central del trabajo. Actualice antes de aprobar.",
        );
      const result = await api(
        `/api/jobs/${encodeURIComponent(state.jobId)}/orders`,
        { method: "POST", body: { expected_job_version: expectedVersion } },
      );
      central.jobs.set(state.jobId, {
        ...(central.jobs.get(state.jobId) || {}),
        locked: true,
      });
      applyJobLock();
      app.toast(`Orden ${result.order.order_number} creada`);
      await loadOrders();
      openOrder(result.order.id);
    } catch (error) {
      app.toast(error.message, true);
    }
  }

  async function openOrder(orderId) {
    try {
      const result = await api(`/api/orders/${encodeURIComponent(orderId)}`);
      const order = result.order;
      $("#centralOrderModal")?.remove();
      const modal = document.createElement("div");
      modal.className = "central-order-modal";
      modal.id = "centralOrderModal";
      const groups = groupCuts(order.snapshot);
      modal.innerHTML = `<div class="central-order-dialog">
        <div class="central-order-dialog-head"><div><b>${escapeHtml(order.order_number)}</b> · ${escapeHtml(order.job_name)} <span class="central-order-status ${order.status}">${STATUS_LABELS[order.status] || order.status}</span></div><button class="btn icon" data-central-close-order>×</button></div>
        <div class="central-order-dialog-body">
          <div class="central-order-detail-grid">
            <div><span>Revisión</span><b>${order.revision}</b></div><div><span>Habitaciones</span><b>${order.room_count}</b></div><div><span>Paños</span><b>${order.panel_count}</b></div><div><span>Impresiones</span><b>${order.print_count}</b></div>
          </div>
          ${
            can("orders_print")
              ? `<div class="central-dialog-actions">
            <button class="btn primary" data-central-modal-print="all">Imprimir todo</button>
            <button class="btn" data-central-modal-print="cuts">Tabla de cortes</button>
            <button class="btn" data-central-modal-print="confection">Confección</button>
          </div>`
              : ""
          }
          <h3>Resumen de cortes</h3>${cutTableHtml(groups)}
        </div></div>`;
      document.body.append(modal);
      modal.addEventListener("click", (event) => {
        if (
          event.target.closest("[data-central-close-order]") ||
          event.target === modal
        )
          modal.remove();
        const type = event.target.closest("[data-central-modal-print]")?.dataset
          .centralModalPrint;
        if (type && can("orders_print")) printOrder(order.id, type);
      });
    } catch (error) {
      app.toast(error.message, true);
    }
  }

  async function updateOrderStatus(orderId, status) {
    try {
      await api(`/api/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        body: { status },
      });
      await loadOrders();
      app.toast(
        `Orden marcada como ${STATUS_LABELS[status]?.toLowerCase() || status}`,
      );
    } catch (error) {
      app.toast(error.message, true);
    }
  }

  async function reopenJob(jobId) {
    const reason = await app.askText({
      title: "Reabrir trabajo",
      message:
        "La orden anterior conserva su snapshot. Indica el motivo de la reapertura.",
      textarea: { label: "Motivo de la reapertura (obligatorio)" },
      confirmLabel: "Reabrir",
      required: true,
    });
    if (!reason) return;
    try {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/reopen`, {
        method: "POST",
        body: { reason },
      });
      await refreshCentralJobs();
      await loadOrders();
      app.toast("Trabajo reabierto; la orden anterior conserva su snapshot");
    } catch (error) {
      app.toast(error.message, true);
    }
  }

  async function cancelOrder(orderId) {
    const reason = await app.askText({
      title: "Cancelar orden",
      message: "La orden dejará de estar vigente. Indica el motivo.",
      textarea: { label: "Motivo de la cancelación (obligatorio)" },
      confirmLabel: "Cancelar orden",
      danger: true,
      required: true,
    });
    if (!reason) return;
    try {
      await api(`/api/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        body: { status: "cancelled", reason },
      });
      await refreshCentralJobs();
      await loadOrders();
      app.toast("Orden cancelada");
    } catch (error) {
      app.toast(error.message, true);
    }
  }

  function groupCuts(state) {
    const project = state?.project || {};
    const groups = new Map();
    readyRows(state).forEach((row) => {
      const calc = calculateRow(row, project);
      const key = `${calc.cutWidth.toFixed(3)}|${calc.cutHeight.toFixed(3)}`;
      if (!groups.has(key))
        groups.set(key, {
          cutWidth: calc.cutWidth,
          cutHeight: calc.cutHeight,
          rooms: [],
          panels: 0,
          meters: 0,
        });
      const group = groups.get(key);
      group.rooms.push(String(row.room));
      group.panels += calc.sheets;
      group.meters += calc.meters;
    });
    return [...groups.values()]
      .sort((a, b) => b.cutHeight - a.cutHeight || b.cutWidth - a.cutWidth)
      .map((group, index) => ({
        ...group,
        code: `C-${String(index + 1).padStart(2, "0")}`,
      }));
  }

  function cutTableHtml(groups) {
    return `<table class="central-cut-table"><thead><tr><th>Corte</th><th>Ancho</th><th>Alto</th><th>Paños</th><th>Metros</th><th>Habitaciones</th></tr></thead><tbody>${groups.map((group) => `<tr><td><b>${group.code}</b></td><td>${formatNumber(group.cutWidth)} m</td><td>${formatNumber(group.cutHeight)} m</td><td>${group.panels}</td><td>${formatNumber(group.meters)} m</td><td>${escapeHtml(group.rooms.join(" · "))}</td></tr>`).join("")}</tbody></table>`;
  }

  async function printOrder(orderId, documentType = "all") {
    const popup = window.open("", "_blank");
    if (!popup) {
      app.toast("El navegador ha bloqueado la ventana de impresión.", true);
      return;
    }
    popup.document.write(
      '<p style="font-family:Arial;padding:30px">Preparando documento…</p>',
    );
    try {
      const result = await api(`/api/orders/${encodeURIComponent(orderId)}`);
      const order = result.order;
      popup.document.open();
      popup.document.write(printDocument(order, documentType));
      popup.document.close();
      let recorded = false;
      popup.addEventListener(
        "afterprint",
        async () => {
          if (recorded) return;
          recorded = true;
          try {
            await api(`/api/orders/${encodeURIComponent(orderId)}/print-log`, {
              method: "POST",
              body: { document_type: documentType },
            });
            await loadOrders();
            app.toast("Solicitud de impresión registrada");
          } catch (error) {
            app.toast(
              `No se pudo registrar la impresión: ${error.message}`,
              true,
            );
          } finally {
            popup.close();
          }
        },
        { once: true },
      );
      setTimeout(() => {
        popup.focus();
        popup.print();
      }, 250);
    } catch (error) {
      popup.close();
      app.toast(error.message, true);
    }
  }

  function printDocument(order, documentType) {
    const state = order.snapshot || {};
    const project = state.project || {};
    const rows = readyRows(state);
    const groups = groupCuts(state);
    const include = (type) => documentType === "all" || documentType === type;
    const style = `<style>
      @page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;font-size:10pt;margin:0}.head{display:flex;justify-content:space-between;border-bottom:3px solid #222;padding-bottom:7mm;margin-bottom:6mm}.head h1{font-size:19pt;margin:0}.head p{margin:2mm 0 0}.order{font-size:15pt;font-weight:800}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm;margin-bottom:5mm}.meta div{border:1px solid #888;padding:2.5mm}.meta span{display:block;font-size:7pt;text-transform:uppercase}.meta b{display:block;margin-top:1mm}table{width:100%;border-collapse:collapse;margin-bottom:6mm}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #666;padding:2mm;text-align:left;font-size:8.5pt}th{background:#ddd}.page{break-after:page}.page:last-child{break-after:auto}.section-title{font-size:15pt;border-bottom:2px solid #222;padding-bottom:2mm;margin:0 0 5mm}.note{color:#555}.avoid{break-inside:avoid}</style>`;
    const header = `<div class="head"><div><h1>ORDEN DE CORTE</h1><p><b>${escapeHtml(project.hotel || order.job_name)}</b> · ${escapeHtml(project.client || "")}</p></div><div style="text-align:right"><div class="order">${escapeHtml(order.order_number)}</div><p>Revisión ${order.revision}<br>${formatDateTime(order.created_at)}</p></div></div>`;
    const meta = `<div class="meta"><div><span>Tela</span><b>${escapeHtml(project.fabricName || project.fabricType || "Sin indicar")}</b></div><div><span>Ancho tela</span><b>${formatNumber(project.fabricWidth)} m</b></div><div><span>Habitaciones</span><b>${rows.length}</b></div><div><span>Paños</span><b>${rows.reduce((sum, row) => sum + calculateRow(row, project).sheets, 0)}</b></div></div>`;
    let content = "";
    if (include("order"))
      content += `<section class="page">${header}${meta}<h2 class="section-title">Resumen de la orden</h2>${cutTablePrint(groups)}<h2 class="section-title">Relación de habitaciones</h2>${roomsTablePrint(rows, project)}</section>`;
    if (include("cuts") && documentType !== "all")
      content += `<section class="page">${header}${meta}<h2 class="section-title">Tabla de cortes</h2>${cutTablePrint(groups)}</section>`;
    if (include("confection"))
      content += `<section class="page">${header}<h2 class="section-title">Hojas de confección</h2>${roomsTablePrint(rows, project, true)}</section>`;
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(order.order_number)}</title>${style}</head><body>${content}</body></html>`;
  }

  function cutTablePrint(groups) {
    return `<table><thead><tr><th>Corte</th><th>Ancho</th><th>Alto</th><th>Paños</th><th>Metros</th><th>Habitaciones</th></tr></thead><tbody>${groups.map((group) => `<tr><td><b>${group.code}</b></td><td>${formatNumber(group.cutWidth)} m</td><td>${formatNumber(group.cutHeight)} m</td><td>${group.panels}</td><td>${formatNumber(group.meters)} m</td><td>${escapeHtml(group.rooms.join(", "))}</td></tr>`).join("")}</tbody></table>`;
  }

  function roomsTablePrint(rows, project, confection = false) {
    // Las hojas de confección muestran un ancho de corte por paño/hoja
    // (2 columnas si hay 2 hojas, 1 si es hoja única) con la altura al lado;
    // la orden de corte mantiene su disposición original.
    const header = confection
      ? "<tr><th>Hab.</th><th>Ancho hueco</th><th>Hojas</th><th>Ancho 1</th><th>Ancho 2</th><th>Altura</th><th>Fruncido</th><th>Bajo</th><th>Observaciones</th></tr>"
      : "<tr><th>Hab.</th><th>Ancho hueco</th><th>Altura</th><th>Hojas</th><th>Corte por paño</th><th>Fruncido</th><th>Observaciones</th></tr>";
    return `<table><thead>${header}</thead><tbody>${rows
      .map((row) => {
        const c = calculateRow(row, project);
        if (confection) {
          const width2 =
            c.sheets > 1 ? `<td>${formatNumber(c.cutWidth)}</td>` : "<td></td>";
          return `<tr><td><b>${escapeHtml(row.room)}</b></td><td>${formatNumber(c.width)} m</td><td>${c.sheets}</td><td>${formatNumber(c.cutWidth)}</td>${width2}<td>${formatNumber(c.height)} m</td><td>${formatNumber(c.gather)}</td><td>${formatNumber(row.hem ?? project.hem)} m</td><td>${escapeHtml(row.notes || "")}</td></tr>`;
        }
        return `<tr><td><b>${escapeHtml(row.room)}</b></td><td>${formatNumber(c.width)} m</td><td>${formatNumber(c.height)} m</td><td>${c.sheets}</td><td>${formatNumber(c.cutWidth)} × ${formatNumber(c.cutHeight)} m</td><td>${formatNumber(c.gather)}</td><td>${escapeHtml(row.notes || "")}</td></tr>`;
      })
      .join("")}</tbody></table>`;
  }

  async function loadHistory() {
    const el = $("#centralHistoryList");
    if (!el) return;
    const state = app.getState();
    el.innerHTML = '<div class="skeleton skeleton-row"></div>'.repeat(4);
    try {
      await flushCurrentSave();
      const result = await api(
        `/api/jobs/${encodeURIComponent(state.jobId)}/history`,
      );
      el.innerHTML = result.items.length
        ? result.items
            .map(
              (event) =>
                `<article class="central-history-event"><div class="top"><b>${escapeHtml(event.summary)}</b><time>${formatDateTime(event.created_at)}</time></div><p>${escapeHtml(event.user)} · ${escapeHtml(event.action)}</p>${event.before || event.after ? `<details><summary>Ver valores</summary><pre>${escapeHtml(JSON.stringify({ antes: event.before, después: event.after }, null, 2))}</pre></details>` : ""}</article>`,
            )
            .join("")
        : '<div class="empty">Todavía no hay cambios registrados.</div>';
    } catch (error) {
      el.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    }
  }

  function permissionsMarkup(selected = [], name = "permission") {
    const chosen = new Set(selected);
    const groups = [...new Set(PERMISSIONS.map(([, , group]) => group))];
    return groups
      .map(
        (group) =>
          `<fieldset class="central-permission-group"><legend>${escapeHtml(group)}</legend>${PERMISSIONS.filter(
            ([, , itemGroup]) => itemGroup === group,
          )
            .map(
              ([key, label]) =>
                `<label><input type="checkbox" name="${name}" value="${key}" ${chosen.has(key) ? "checked" : ""}> <span>${escapeHtml(label)}</span></label>`,
            )
            .join("")}</fieldset>`,
      )
      .join("");
  }

  function renderPermissionCreate(
    role = $("#centralNewRole")?.value || "office",
  ) {
    const el = $("#centralNewPermissions");
    if (!el) return;
    el.innerHTML = permissionsMarkup(
      ROLE_DEFAULTS[role] || [],
      "central-new-permission",
    );
    if (role === "admin")
      $$("input", el).forEach((input) => {
        input.checked = true;
        input.disabled = true;
      });
  }

  function selectedPermissions(root, name) {
    return $$(`input[name="${name}"]:checked`, root).map(
      (input) => input.value,
    );
  }

  // === Matriz de permisos ===
  async function openPermissionsMatrix() {
    if (!can("permissions_manage")) {
      toast("No tienes permisos para ver la matriz.", true);
      return;
    }
    openModal("permissionsMatrixModal");
    const wrap = q("#matrixTableWrap");
    if (wrap)
      wrap.innerHTML = '<div class="matrix-loading">Cargando matriz…</div>';
    try {
      const result = await api("/api/users");
      central.users = result.items || [];
      renderPermissionsMatrix();
    } catch (e) {
      toast("Error cargando usuarios: " + e.message, true);
    }
  }
  function renderPermissionsMatrix() {
    const wrap = q("#matrixTableWrap");
    const search = (q("#matrixSearch")?.value || "").trim().toLowerCase();
    const roleFilter = q("#matrixRoleFilter")?.value || "all";
    if (!wrap) return;
    const users = (central.users || []).filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!search) return true;
      if ((u.full_name || "").toLowerCase().includes(search)) return true;
      if ((u.username || "").toLowerCase().includes(search)) return true;
      if (
        PERMISSIONS.some(
          ([k, l]) =>
            k.toLowerCase().includes(search) ||
            l.toLowerCase().includes(search),
        )
      )
        return true;
      return false;
    });
    if (!users.length) {
      wrap.innerHTML =
        '<div class="empty" style="padding:30px;text-align:center;color:var(--muted)">Sin usuarios que coincidan con el filtro.</div>';
      q("#matrixStats").textContent = "";
      return;
    }
    const perms = PERMISSIONS;
    // Agrupa por módulo (tercer elemento del array)
    const groups = {};
    perms.forEach((p) => {
      const g = p[2] || "Otros";
      (groups[g] = groups[g] || []).push(p);
    });
    let html =
      '<table class="matrix-table"><thead><tr><th class="matrix-corner">Usuario</th>';
    Object.entries(groups).forEach(([g, plist]) => {
      html += `<th colspan="${plist.length}" class="matrix-group-head">${esc(g)}</th>`;
    });
    html +=
      '<th class="matrix-role-head">Rol</th></tr><tr><th class="matrix-corner"></th>';
    Object.entries(groups).forEach(([g, plist]) => {
      plist.forEach(([k, l]) => {
        html += `<th class="matrix-perm-head" title="${esc(l)}">${esc(l)}</th>`;
      });
    });
    html += "<th></th></tr></thead><tbody>";
    users.forEach((u) => {
      html += `<tr data-user-id="${u.id}"><td class="matrix-user-cell"><b>${esc(u.full_name || u.username)}</b><small>${esc(u.username)}</small></td>`;
      Object.values(groups)
        .flat()
        .forEach(([k]) => {
          const has = (u.permissions || []).includes(k);
          const id = `m_${u.id}_${k.replace(/[^a-z0-9]/g, "_")}`;
          html += `<td class="matrix-cell"><label for="${id}" class="matrix-check" title="${esc(k)}"><input type="checkbox" id="${id}" data-matrix-toggle data-user-id="${u.id}" data-perm-key="${k}" ${has ? "checked" : ""}><span></span></label></td>`;
        });
      const roleLabel =
        u.role === "admin"
          ? "Admin"
          : u.role === "office"
            ? "Oficina"
            : "Corte";
      html += `<td><span class="matrix-role-badge ${u.role}">${roleLabel}</span></td></tr>`;
    });
    html += "</tbody></table>";
    wrap.innerHTML = html;
    q("#matrixStats").textContent =
      `${users.length} usuario${users.length === 1 ? "" : "s"} · ${perms.length} permisos`;
  }
  async function togglePermission(userId, permKey, enabled) {
    const user = central.users.find((u) => u.id === userId);
    if (!user) return;
    const before = [...(user.permissions || [])];
    if (enabled) {
      if (!user.permissions.includes(permKey)) user.permissions.push(permKey);
    } else {
      user.permissions = user.permissions.filter((p) => p !== permKey);
    }
    try {
      await api(`/api/users/${userId}`, {
        method: "PATCH",
        body: { permissions: user.permissions },
      });
    } catch (e) {
      user.permissions = before;
      throw e;
    }
  }
  async function resetUserToRoleDefaults(userId) {
    const user = central.users.find((u) => u.id === userId);
    if (!user) return;
    const ok = await app.askConfirm({
      title: "Restablecer permisos",
      message: `¿Restablecer los permisos por defecto del rol «${user.role}» para ${user.full_name || user.username}? Se perderán los permisos personalizados.`,
      confirmLabel: "Restablecer",
    });
    if (!ok) return;
    try {
      await api(`/api/users/${userId}`, {
        method: "PATCH",
        body: { permissions: null },
      });
      user.permissions = [...(ROLE_DEFAULTS[user.role] || [])];
      renderPermissionsMatrix();
      toast("Permisos restablecidos");
    } catch (e) {
      toast("Error: " + e.message, true);
    }
  }
  async function resetAllToRoleDefaults() {
    const users = (central.users || []).filter((u) => {
      const defaults = ROLE_DEFAULTS[u.role] || [];
      const current = u.permissions || [];
      if (defaults.length !== current.length) return true;
      return !defaults.every((p) => current.includes(p));
    });
    if (!users.length) {
      toast("Todos los usuarios ya tienen los permisos por defecto de su rol.");
      return;
    }
    let ok = 0,
      fail = 0;
    for (const u of users) {
      try {
        await api(`/api/users/${u.id}`, {
          method: "PATCH",
          body: { permissions: null },
        });
        u.permissions = [...(ROLE_DEFAULTS[u.role] || [])];
        ok++;
      } catch (e) {
        fail++;
      }
    }
    renderPermissionsMatrix();
    await loadUsers();
    toast(
      `${ok} usuario${ok === 1 ? "" : "s"} restablecido${ok === 1 ? "" : "s"}${fail ? ` · ${fail} fallaron` : ""}`,
      fail > 0,
    );
  }
  function startImpersonating(userId) {
    const user = central.users.find((u) => u.id === userId);
    if (!user) return;
    if (user.id === central.user?.id) {
      toast("Ya estás viendo como tu propio usuario.", true);
      return;
    }
    if (impersonating) {
      toast("Ya hay una sesión de impersonación activa. Sal primero.", true);
      return;
    }
    impersonating = {
      user: JSON.parse(JSON.stringify(user)),
      originalUser: JSON.parse(JSON.stringify(central.user)),
      startedAt: new Date().toISOString(),
    };
    central.user = impersonating.user;
    applyRole(central.user);
    // renderAll vive en el IIFE de index.html y se expone via window.EgeaApp.
    if (typeof window.EgeaApp?.renderAll === "function")
      window.EgeaApp.renderAll();
    const b = q("#impersonateBanner");
    if (b) {
      b.hidden = false;
      q("#impersonateBannerName").textContent =
        central.user.full_name || central.user.username;
      q("#impersonateBannerRole").textContent =
        central.user.role === "admin"
          ? "Administrador"
          : central.user.role === "office"
            ? "Oficina"
            : "Operario de corte";
    }
    document.body.classList.add("has-impersonate-banner");
    toast(`Viendo como: ${central.user.full_name || central.user.username}`);
    // Cambia el título del documento para evitar confusiones
    document.title = `[${central.user.username}] Confección Central`;
    // Registra en el audit log del backend. Si falla, no abortamos la
    // impersonación (es solo trazabilidad) pero avisamos al admin.
    api("/api/audit/impersonate-start", {
      method: "POST",
      body: { target_id: userId },
    }).catch((e) =>
      toast("No se pudo registrar en el audit: " + e.message, true),
    );
  }
  function stopImpersonating() {
    if (!impersonating) return;
    const stoppedTargetId = impersonating?.user?.id;
    central.user = impersonating.originalUser;
    applyRole(central.user);
    if (typeof window.EgeaApp?.renderAll === "function")
      window.EgeaApp.renderAll();
    impersonating = null;
    const b = q("#impersonateBanner");
    if (b) b.hidden = true;
    document.body.classList.remove("has-impersonate-banner");
    document.title = "Confección Central";
    toast("Volviendo a tu sesión de admin");
    if (stoppedTargetId) {
      api("/api/audit/impersonate-stop", {
        method: "POST",
        body: { target_id: stoppedTargetId },
      }).catch((e) =>
        toast("No se pudo registrar en el audit: " + e.message, true),
      );
    }
  }
  let impersonating = null;
  let pendingImpersonateId = null;
  async function loadUsers() {
    if (!can("users_manage")) return;
    try {
      const result = await api("/api/users");
      central.users = result.items || [];
      const list = $("#centralUsersList");
      if (!list) return;
      list.innerHTML = central.users
        .map(
          (user) =>
            `<div class="central-user-row"><div><b>${escapeHtml(user.full_name || user.username)}</b><small>${escapeHtml(user.username)} · ${user.active ? "Activo" : "Desactivado"} · ${user.permissions.length} permisos</small></div><span class="central-role-badge ${user.role}">${user.role === "admin" ? "Administrador" : user.role === "office" ? "Oficina" : "Operario"}</span><div class="central-user-row-actions">${user.id !== central.user?.id && (user.role !== "admin" || central.user?.role === "admin") ? `<button class="btn small" data-central-user-impersonate="${user.id}" title="Ver la app con los permisos de este usuario (solo vista)">👁 Ver como</button>` : ""}${can("permissions_manage") ? `<button class="btn small" data-central-user-edit="${user.id}">Permisos</button>` : ""}<button class="btn small ${user.active ? "danger" : ""}" data-central-user-active="${user.id}" data-active="${user.active ? "0" : "1"}">${user.active ? "Desactivar" : "Activar"}</button></div></div>`,
        )
        .join("");
    } catch (error) {
      app.toast(error.message, true);
    }
  }

  function openUserPermissions(userId) {
    const user = central.users.find((item) => item.id === userId);
    if (!user) return;
    $("#centralPermissionsModal")?.remove();
    const modal = document.createElement("div");
    modal.className = "central-order-modal";
    modal.id = "centralPermissionsModal";
    modal.innerHTML = `<div class="central-order-dialog central-permission-dialog">
      <div class="central-order-dialog-head"><div><b>Permisos de ${escapeHtml(user.full_name || user.username)}</b><small>${escapeHtml(user.username)}</small></div><button class="btn icon" data-central-close-permissions>×</button></div>
      <div class="central-order-dialog-body">
        <label class="field"><span>Perfil base</span><select id="centralEditRole"><option value="office" ${user.role === "office" ? "selected" : ""}>Oficina</option><option value="cut" ${user.role === "cut" ? "selected" : ""}>Operario de corte</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>Administrador</option></select></label>
        <div id="centralEditPermissions" class="central-permission-grid edit">${permissionsMarkup(user.permissions, "central-edit-permission")}</div>
        <p class="central-permission-note">Los permisos se comprueban también en el servidor. Ocultar un botón no concede ni revoca acceso por sí solo.</p>
        <div class="central-dialog-actions"><button class="btn primary" id="centralSavePermissionsBtn">Guardar permisos</button><button class="btn" data-central-role-preset>Restaurar permisos del perfil</button></div>
      </div></div>`;
    document.body.append(modal);
    const roleSelect = $("#centralEditRole", modal);
    const permissionsEl = $("#centralEditPermissions", modal);
    const applyPreset = () => {
      permissionsEl.innerHTML = permissionsMarkup(
        ROLE_DEFAULTS[roleSelect.value] || [],
        "central-edit-permission",
      );
      if (roleSelect.value === "admin")
        $$("input", permissionsEl).forEach((input) => {
          input.checked = true;
          input.disabled = true;
        });
    };
    roleSelect.addEventListener("change", applyPreset);
    modal.addEventListener("click", async (event) => {
      if (
        event.target.closest("[data-central-close-permissions]") ||
        event.target === modal
      )
        modal.remove();
      if (event.target.closest("[data-central-role-preset]")) applyPreset();
      if (event.target.closest("#centralSavePermissionsBtn")) {
        try {
          await api(`/api/users/${encodeURIComponent(user.id)}`, {
            method: "PATCH",
            body: {
              role: roleSelect.value,
              permissions: selectedPermissions(
                permissionsEl,
                "central-edit-permission",
              ),
            },
          });
          modal.remove();
          await loadUsers();
          app.toast("Permisos actualizados");
        } catch (error) {
          app.toast(error.message, true);
        }
      }
    });
  }

  async function createUser(event) {
    event.preventDefault();
    try {
      const permissionsRoot = $("#centralNewPermissions");
      await api("/api/users", {
        method: "POST",
        body: {
          username: $("#centralNewUsername").value,
          full_name: $("#centralNewFullName").value,
          password: $("#centralNewPassword").value,
          role: can("permissions_manage")
            ? $("#centralNewRole").value
            : "office",
          permissions: can("permissions_manage")
            ? selectedPermissions(permissionsRoot, "central-new-permission")
            : null,
        },
      });
      event.target.reset();
      renderPermissionCreate("office");
      await loadUsers();
      app.toast("Usuario creado");
    } catch (error) {
      app.toast(error.message, true);
    }
  }

  function bindEvents() {
    window.addEventListener("egea:save", (event) => queueSave(event.detail));
    window.addEventListener("egea:job-opened", () => applyJobLock());
    window.addEventListener("egea:job-create", (event) => {
      const job = event.detail?.job;
      if (job) queueSave({ state: job.state, job });
    });
    window.addEventListener("egea:job-delete", async (event) => {
      const id = event.detail?.id;
      if (!id || !can("jobs_delete")) return;
      try {
        await api(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
        central.versions.delete(id);
      } catch (error) {
        app.toast(`No se pudo eliminar del servidor: ${error.message}`, true);
      }
    });

    document.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.id === "historyBtn") setTimeout(loadHistory, 50);
      if (button.dataset.view === "ordenes") {
        await loadOrders();
        renderOrders();
      }
      if (button.dataset.view === "taller") await loadOrders();
      if (button.dataset.view === "usuarios" && can("users_manage"))
        await loadUsers();
      if (button.id === "centralCreateOrderBtn" && can("orders_create"))
        await createOrder();
      if (
        (button.id === "centralRefreshOrdersBtn" ||
          button.id === "centralWorkshopRefreshBtn") &&
        can("orders_view")
      )
        await loadOrders();
      if (button.id === "centralRefreshUsersBtn" && can("users_manage"))
        await loadUsers();
      if (button.dataset.centralOrderView && can("orders_view"))
        await openOrder(button.dataset.centralOrderView);
      if (button.dataset.centralOrderPrint && can("orders_print"))
        await printOrder(
          button.dataset.centralOrderPrint,
          button.dataset.documentType || "all",
        );
      if (button.dataset.centralOrderStatus)
        await updateOrderStatus(
          button.dataset.centralOrderStatus,
          button.dataset.status,
        );
      if (button.dataset.centralOrderReopen && can("orders_approve"))
        await reopenJob(button.dataset.centralOrderReopen);
      if (button.dataset.centralOrderCancel && can("orders_approve"))
        await cancelOrder(button.dataset.centralOrderCancel);
      if (button.dataset.centralUserEdit && can("permissions_manage"))
        openUserPermissions(button.dataset.centralUserEdit);
      if (button.dataset.centralUserImpersonate && can("users_manage")) {
        const uid = button.dataset.centralUserImpersonate;
        const u = central.users.find((x) => x.id === uid);
        if (!u) return;
        if (u.id === central.user?.id) {
          toast("No tiene sentido impersonar a tu propio usuario.", true);
          return;
        }
        if (impersonating) {
          toast("Ya estás impersonando a otro usuario. Sal primero.", true);
          return;
        }
        pendingImpersonateId = uid;
        const nameEl = q("#impersonateConfirmName");
        if (nameEl) nameEl.textContent = u.full_name || u.username;
        openModal("impersonateConfirmModal");
      }
      if (button.id === "impersonateConfirmBtn" && pendingImpersonateId) {
        const uid = pendingImpersonateId;
        pendingImpersonateId = null;
        closeModal("impersonateConfirmModal");
        startImpersonating(uid);
      }
      if (button.id === "stopImpersonateBtn") stopImpersonating();
      if (button.id === "openPermissionsMatrixBtn") openPermissionsMatrix();
      if (button.id === "matrixResetDefaults" && can("permissions_manage")) {
        const ok = await app.askConfirm({
          title: "Restablecer todos",
          message:
            "¿Restablecer los permisos por defecto del rol para TODOS los usuarios con permisos personalizados?",
          confirmLabel: "Restablecer todos",
        });
        if (!ok) return;
        resetAllToRoleDefaults();
      }
      if (button.dataset.centralUserActive && can("users_manage")) {
        try {
          await api(
            `/api/users/${encodeURIComponent(button.dataset.centralUserActive)}`,
            {
              method: "PATCH",
              body: { active: button.dataset.active === "1" },
            },
          );
          await loadUsers();
        } catch (error) {
          app.toast(error.message, true);
        }
      }
      setTimeout(applyJobLock, 0);
    });

    document.addEventListener("change", async (event) => {
      if (event.target.id === "centralOrderStatus") renderOrders();
      if (event.target.id === "centralNewRole")
        renderPermissionCreate(event.target.value);
      if (event.target.id === "matrixRoleFilter") renderPermissionsMatrix();
      if (event.target.matches?.("[data-matrix-toggle]")) {
        const cb = event.target;
        const userId = cb.dataset.userId;
        const permKey = cb.dataset.permKey;
        const enabled = cb.checked;
        try {
          await togglePermission(userId, permKey, enabled);
        } catch (e) {
          // Revertir el checkbox en el DOM y mostrar error
          cb.checked = !enabled;
          toast("No se pudo guardar: " + e.message, true);
        }
      }
    });
    const searchOrders = debounce(() => renderOrders(), 150);
    const searchMatrix = debounce(() => renderPermissionsMatrix(), 150);
    document.addEventListener("input", (event) => {
      if (event.target.id === "centralOrderSearch") searchOrders();
      if (event.target.id === "matrixSearch") searchMatrix();
    });
    $("#centralUserForm")?.addEventListener("submit", createUser);

    // Read-only guard for the cut role.
    document.addEventListener(
      "beforeinput",
      (event) => {
        if (can("jobs_edit")) return;
        if (
          event.target.closest(
            "#view-relacion input[data-row], #view-relacion [data-project]",
          )
        )
          event.preventDefault();
      },
      true,
    );

    window.addEventListener("online", () => setSync("saved", "Conectado"));
    window.addEventListener("offline", () =>
      setSync("offline", "Sin conexión"),
    );
    // pagehide es más fiable que beforeunload en navegadores modernos y móvil;
    // beforeunload se mantiene como red adicional para escritorios antiguos.
    window.addEventListener("pagehide", () => flushPendingOnUnload());
    window.addEventListener("beforeunload", () => flushPendingOnUnload());
  }

  async function init() {
    bindEvents();
    try {
      const result = await api("/api/auth/me");
      central.user = result.user;
      central.csrf = result.csrf_token;
      await bootstrapSession();
    } catch (error) {
      if (error.status === 401) loginOverlay();
      else {
        loginOverlay();
        const err = $("#centralLoginError");
        if (err) {
          err.textContent = `No se puede conectar con el servidor: ${error.message}`;
          err.classList.add("show");
        }
      }
    }
    setInterval(async () => {
      if (
        !central.user ||
        !can("orders_view") ||
        document.hidden ||
        !["taller", "ordenes"].includes(app.getState()?.activeView)
      )
        return;
      try {
        await loadOrders();
      } catch (_) {}
    }, 30000);
  }

  init();
})();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/static/sw.js").catch(() => {}),
  );
}
