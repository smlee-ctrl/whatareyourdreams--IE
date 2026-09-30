(function () {
  const DRAFT_KEY = "ge_draft";
  const page = document.body.dataset.page;

  // Supabase backs the actual dreams now — window.supabase is the SDK
  // namespace (loaded via the CDN script tag), window.SUPABASE_URL/
  // SUPABASE_ANON_KEY come from assets/supabase-config.js.
  const db = (window.supabase && window.SUPABASE_URL)
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

  // Every visitor gets a real, unspoofable anonymous identity the first
  // time they touch the database — no login screen. Row Level Security
  // policies check auth.uid() server-side, so "My Envelope" is actually
  // enforced by Postgres, not just a client-side filter.
  async function ensureAnonSession() {
    const { data: { session } } = await db.auth.getSession();
    if (session) return session;
    const { data, error } = await db.auth.signInAnonymously();
    if (error) throw error;
    return data.session;
  }

  // seeded RNG so the bubble scatter layout is stable across reloads for
  // the same set of envelopes, instead of jumping around every visit
  function seedFromString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return h;
  }

  function mulberry32(seed) {
    let s = seed | 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // loosely overlapping bubble scatter (nodes 52:66 / 61:469 / 63:29):
  // envelopes alternate down a left/right cascade with random size/jitter,
  // each new one climbing up into the previous one's space so they overlap
  // the way the mock does, instead of sitting in a regular grid.
  function layoutBubbles(entries, containerWidth) {
    const MIN_SIZE = 130, MAX_SIZE = 225;
    let cursorLeft = 12, cursorRight = 90;
    return entries.map((entry, i) => {
      const rand = mulberry32(seedFromString(String(entry.id || entry.ts) + i));
      const size = MIN_SIZE + rand() * (MAX_SIZE - MIN_SIZE);
      const onLeft = i % 2 === 0;
      const jitter = (rand() - 0.5) * 28;
      let x, y;
      if (onLeft) {
        y = cursorLeft;
        x = -size * 0.2 + jitter;
        cursorLeft = y + size * 0.58;
      } else {
        y = cursorRight;
        x = containerWidth - size * 0.8 + jitter;
        cursorRight = y + size * 0.58;
      }
      return { entry, x, y, size };
    });
  }

  // ---------------- Home (Screen 1) ----------------
  // Instead of only tapping the CTA, a horizontal scroll/swipe also
  // navigates to the Create screen (tap still works as a fallback).
  if (page === "home") {
    let navigating = false;
    let wheelAccum = 0;
    let wheelResetTimer = null;
    const THRESHOLD = 70;

    function goToCreate() {
      if (navigating) return;
      navigating = true;
      window.location.href = "create/";
    }

    window.addEventListener("wheel", (e) => {
      if (navigating) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
      if (delta === 0) return; // ignore plain vertical scroll
      e.preventDefault();
      wheelAccum += delta;
      clearTimeout(wheelResetTimer);
      wheelResetTimer = setTimeout(() => { wheelAccum = 0; }, 150);
      if (wheelAccum > THRESHOLD) goToCreate();
    }, { passive: false });

    let touchStartX = null;
    let touchStartY = null;
    window.addEventListener("touchstart", (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    window.addEventListener("touchend", (e) => {
      if (touchStartX === null || navigating) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && dx < 0) goToCreate();
      touchStartX = null;
    }, { passive: true });
  }

  // ---------------- Archive (Screens: 52:66 / 61:469 / 63:29 / 63:95) ----
  // Shared by both /archive/ (data-scope="all", everyone's shared mirrors)
  // and /archive/mine/ (data-scope="mine", just this visitor's own,
  // scoped to their anonymous auth identity — enforced by RLS, not just
  // a client-side filter).
  if (page === "archive") {
    (async function initArchive() {
      const scope = document.body.dataset.scope;
      const container = document.getElementById("archiveBubbles");
      const scrim = document.getElementById("archiveScrim");

      const loading = document.createElement("p");
      loading.className = "archive-empty";
      loading.textContent = "Loading dreams…";
      container.appendChild(loading);

      let entries = [];
      try {
        await ensureAnonSession();
        const query = scope === "mine"
          ? db.from("dreams").select("*").eq("owner_id", (await db.auth.getUser()).data.user.id)
          : db.from("dreams").select("*").eq("share", true);
        const { data, error } = await query.order("created_at", { ascending: false });
        if (error) throw error;
        entries = data.map((row) => ({
          id: row.id,
          name: row.name,
          pursuit: row.pursuit,
          message: row.message,
          share: row.share,
          showName: row.show_name,
          ts: new Date(row.created_at).getTime()
        }));
      } catch (err) {
        loading.textContent = "Couldn't load dreams right now — please refresh to try again.";
        return;
      }

      loading.remove();

      if (entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "archive-empty";
        empty.textContent = scope === "mine"
          ? "You haven't carved a mirror yet — go write one."
          : "No mirrors yet — be the first to write one.";
        container.appendChild(empty);
      } else {
      const width = container.clientWidth || 390;
      const placed = layoutBubbles(entries, width);
      let activeBubble = null; // { el, layout }

      function resizeTo(el, layout, size) {
        const centerX = layout.x + layout.size / 2;
        const centerY = layout.y + layout.size / 2;
        const left = Math.max(8, Math.min(width - size - 8, centerX - size / 2));
        const top = Math.max(8, centerY - size / 2);
        el.style.width = size + "px";
        el.style.height = size + "px";
        el.style.left = left + "px";
        el.style.top = top + "px";
      }

      function closeActive() {
        if (!activeBubble) return;
        const { el, layout } = activeBubble;
        resizeTo(el, layout, layout.size);
        el.style.zIndex = "";
        scrim.classList.remove("visible");
        el.addEventListener("transitionend", function cleanup(e) {
          if (e.propertyName === "width") {
            el.classList.remove("peeking", "opening");
            el.removeEventListener("transitionend", cleanup);
          }
        });
        activeBubble = null;
      }

      function setPeek(el, layout) {
        if (activeBubble && activeBubble.el !== el) closeActive();
        el.classList.add("peeking");
        el.classList.remove("opening");
        el.style.zIndex = "30";
        resizeTo(el, layout, Math.min(300, width - 24));
        scrim.classList.add("visible");
        activeBubble = { el, layout };
      }

      function setOpen(el, layout) {
        el.classList.remove("peeking");
        el.classList.add("opening");
        el.style.zIndex = "30";
        resizeTo(el, layout, Math.min(340, width - 16));
        scrim.classList.add("visible");
        activeBubble = { el, layout };
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }

      placed.forEach((layout, i) => {
        const { entry, x, y, size } = layout;
        const bubble = document.createElement("button");
        bubble.type = "button";
        bubble.className = "envelope-bubble";
        bubble.style.left = x + "px";
        bubble.style.top = y + "px";
        bubble.style.width = size + "px";
        bubble.style.height = size + "px";
        bubble.setAttribute("aria-label", "Read this dream");

        const imgClosed = document.createElement("img");
        imgClosed.className = "bubble-img-closed";
        imgClosed.src = "/assets/mirror-closed.svg";
        imgClosed.alt = "";

        const imgOpen = document.createElement("img");
        imgOpen.className = "bubble-img-open";
        imgOpen.src = "/assets/mirror-open.svg";
        imgOpen.alt = "";

        const label = document.createElement("span");
        label.className = "bubble-label";
        label.textContent = entry.pursuit || "";

        const message = document.createElement("span");
        message.className = "bubble-message";
        message.textContent = entry.message || "";

        bubble.append(imgClosed, imgOpen, label, message);
        container.appendChild(bubble);

        // entrance: drop in from above, staggered per bubble
        bubble.style.transitionDelay = (i * 80) + "ms";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => bubble.classList.add("dropped"));
        });
        bubble.addEventListener("transitionend", function onDrop(e) {
          if (e.propertyName === "transform") {
            bubble.style.transitionDelay = "";
            bubble.removeEventListener("transitionend", onDrop);
          }
        });

        bubble.addEventListener("mouseenter", () => {
          if (bubble.classList.contains("opening")) return;
          setPeek(bubble, layout);
        });
        bubble.addEventListener("mouseleave", () => {
          if (activeBubble && activeBubble.el === bubble && bubble.classList.contains("peeking")) {
            closeActive();
          }
        });
        bubble.addEventListener("click", (e) => {
          e.stopPropagation();
          if (bubble.classList.contains("opening")) closeActive();
          else if (bubble.classList.contains("peeking")) setOpen(bubble, layout);
          else setPeek(bubble, layout);
        });
      });

      container.style.height = (Math.max.apply(null, placed.map((p) => p.y + p.size)) + 24) + "px";
      scrim.addEventListener("click", closeActive);
      }
    })();
  }

  // ---------------- Create, step 1: "what did you pursue" (52:126) -------
  if (page === "create") {
    ensureAnonSession().catch(() => {}); // warm the anon session early
    const form = document.getElementById("envelopeFormStep1");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = document.getElementById("fieldName").value.trim();
      const pursuit = document.getElementById("fieldPursuit").value.trim();
      const share = document.getElementById("fieldShare").checked;
      const showName = document.getElementById("fieldShowName").checked;

      if (!pursuit) {
        document.getElementById("fieldPursuit").focus();
        return;
      }

      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name, pursuit, share, showName }));
      window.location.href = "step-2/";
    });
  }

  // ---------------- Create, step 2: "why did you pursue" (52:179) --------
  // The mirror just opens on its own (see the mirror-open-in/closed-out
  // keyframes in css) as the transition into this question — no gesture
  // required, Write is available right away.
  if (page === "create-step2") {
    const draft = (() => {
      try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || {}; }
      catch { return {}; }
    })();

    if (!draft.pursuit) {
      // arrived here without answering the first question — send them back
      window.location.href = "../";
    } else {
      const nameField = document.getElementById("fieldName");
      const messageField = document.getElementById("fieldMessage");
      const shareField = document.getElementById("fieldShare");
      const showNameField = document.getElementById("fieldShowName");
      nameField.value = draft.name || "";
      shareField.checked = draft.share !== false;
      showNameField.checked = draft.showName !== false;

      const form = document.getElementById("envelopeFormStep2");
      const writeBtn = document.getElementById("writeBtn");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const message = messageField.value.trim();
        if (!message) { messageField.focus(); return; }

        writeBtn.disabled = true;
        writeBtn.textContent = "Writing…";
        try {
          await ensureAnonSession();
          const { error } = await db.from("dreams").insert({
            name: nameField.value.trim(),
            pursuit: draft.pursuit,
            message,
            share: shareField.checked,
            show_name: showNameField.checked
          });
          if (error) throw error;

          sessionStorage.removeItem(DRAFT_KEY);
          window.location.href = "../../archive/mine/";
        } catch (err) {
          writeBtn.disabled = false;
          writeBtn.textContent = "Write";
          messageField.setCustomValidity("Couldn't save your mirror — please try again.");
          messageField.reportValidity();
          messageField.setCustomValidity("");
        }
      });
    }
  }
})();
