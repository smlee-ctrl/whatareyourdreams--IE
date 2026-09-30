(function () {
  const page = document.body.dataset.page;

  // Supabase backs the actual dreams now — window.supabase is the SDK
  // namespace (loaded via the CDN script tag), window.SUPABASE_URL/
  // SUPABASE_ANON_KEY come from assets/supabase-config.js.
  const db = (window.supabase && window.SUPABASE_URL)
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

  // Every visitor gets a real, unspoofable anonymous identity the first
  // time they touch the database — no login screen. Row Level Security
  // policies check auth.uid() server-side, so "My Mirror" is actually
  // enforced by Postgres, not just a client-side filter.
  async function ensureAnonSession() {
    const { data: { session } } = await db.auth.getSession();
    if (session) return session;
    const { data, error } = await db.auth.signInAnonymously();
    if (error) throw error;
    return data.session;
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

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // ---------------- Create: three questions (52:126 → 69:337 → 69:217) ----
  // All positions below are in the mirror stage's own coordinates (Figma's
  // 390px frame, measured from the top of the stage). The door is laid out
  // on its open surface circle; each closed step is a pose of that circle.
  if (page === "create") {
    ensureAnonSession().catch(() => {}); // warm the anon session early

    const main = document.querySelector(".create-flow");
    const form = document.getElementById("flowForm");
    const back = document.getElementById("flowBack");
    const next = document.getElementById("flowNext");
    const name = document.getElementById("fieldName");
    const major = document.getElementById("fieldMajor");
    const impact = document.getElementById("fieldImpact");
    const share = document.getElementById("fieldShare");
    const showName = document.getElementById("fieldShowName");

    const SURFACE = { x: 110.28, y: 81.53, d: 222.29 };
    const POSES = {
      1: { x: 76.45, y: 108.07, w: 237.1, h: 218.86 },
      2: { x: 76.45, y: 90.57, w: 237.1, h: 218.86 }
    };

    const door = window.MirrorDoor.create(document.getElementById("flowDoorLayer"));
    door.place(SURFACE);
    door.pose(POSES[1]);
    door.el.hidden = false;

    let step = 1;
    let busy = false;

    function showStep(n, focus = true) {
      step = n;
      main.dataset.step = String(n);
      form.querySelectorAll(".flow-step").forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
      next.textContent = n === 3 ? "Finish" : "Write";
      if (focus) ({ 1: name, 2: major, 3: impact })[n].focus({ preventScroll: true });
    }

    function setBusy(on) {
      busy = on;
      next.disabled = on;
      back.disabled = on;
    }

    function require(field, message) {
      if (field.value.trim()) return true;
      field.setCustomValidity(message);
      field.reportValidity();
      field.addEventListener("input", () => field.setCustomValidity(""), { once: true });
      return false;
    }

    // answers grow from one line, like the Figma field
    [major, impact].forEach((ta) => ta.addEventListener("input", () => {
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
      ta.style.overflowY = ta.scrollHeight > 120 ? "auto" : "hidden";
    }));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;

      if (step === 1) {
        showStep(2);
        await door.pose(POSES[2], 500);
        return;
      }

      if (step === 2) {
        if (!require(major, "Please write your major.")) return;
        setBusy(true);
        await door.pose(null, 350);   // settle onto the hinge position
        await door.open(1100);        // then swing open like a door
        showStep(3);
        setBusy(false);
        return;
      }

      if (!require(impact, "Please write the impact you hope to make.")) return;
      setBusy(true);
      next.textContent = "Finishing…";
      try {
        await ensureAnonSession();
        const { error } = await db.from("dreams").insert({
          name: name.value.trim(),
          pursuit: major.value.trim(),
          message: impact.value.trim(),
          share: share.checked,
          show_name: showName.checked
        });
        if (error) throw error;
        // a shared mirror joins the public wall; a private one only lives in My Mirror
        window.location.href = share.checked ? "../archive/" : "../archive/mine/";
      } catch (err) {
        setBusy(false);
        next.textContent = "Finish";
        impact.setCustomValidity("Couldn't save your mirror — please try again.");
        impact.reportValidity();
        impact.setCustomValidity("");
      }
    });

    back.addEventListener("click", async () => {
      if (busy) return;
      if (step === 1) { window.location.href = "../"; return; }
      if (step === 2) {
        showStep(1);
        await door.pose(POSES[1], 500);
        return;
      }
      setBusy(true);
      await door.close(700);
      await door.pose(POSES[2], 350);
      showStep(2);
      setBusy(false);
    });
  }

  // ---------------- Archive / My Mirror: the mirror wall ----------------
  // (52:66 / 61:469 / 63:29 / 63:95). /archive/ shows everyone's shared
  // mirrors; /archive/mine/ only this visitor's own — scoped by their
  // anonymous auth identity and enforced by RLS.
  if (page === "archive") {
    (async function initArchive() {
      const scope = document.body.dataset.scope;
      const wallEl = document.getElementById("wall");
      const viewerEl = document.getElementById("wallViewer");
      const scrim = document.getElementById("viewerScrim");

      const status = document.createElement("p");
      status.className = "archive-empty";
      status.textContent = "Loading dreams…";
      wallEl.appendChild(status);

      let entries = [];
      try {
        await ensureAnonSession();
        const uid = scope === "mine" ? (await db.auth.getUser()).data.user.id : null;
        const read = (source, columns) => {
          const q = db.from(source).select(columns);
          return (uid ? q.eq("owner_id", uid) : q.eq("share", true)).order("created_at", { ascending: false });
        };
        // dreams_public only returns a name its writer chose to show; until
        // that view exists, read the table without names rather than fail
        let { data, error } = await read("dreams_public", "id,pursuit,message,name");
        if (error) ({ data, error } = await read("dreams", "id,pursuit,message"));
        if (error) throw error;
        entries = data.map((row) => ({ id: row.id, pursuit: row.pursuit, message: row.message, name: row.name || "" }));
      } catch (err) {
        status.textContent = "Couldn't load dreams right now — please refresh to try again.";
        return;
      }

      if (entries.length === 0) {
        status.textContent = scope === "mine"
          ? "You haven't written a mirror yet — go write one."
          : "No mirrors yet — be the first to write one.";
        return;
      }
      status.remove();

      // viewer geometry, in Figma's 390px content-area coordinates:
      // enlarged mirror (61:469) and its open surface circle (63:29)
      const VIEW_POSE = { x: 66.7, y: 184.06, w: 277.57, h: 275.86 };
      const VIEW_SURFACE = { x: 85.58, y: 211.08, d: 249.07 };

      const door = window.MirrorDoor.create(viewerEl, { knob: true });
      door.place(VIEW_SURFACE);

      const wall = window.MirrorWall.create({
        el: wallEl,
        entries,
        storageKey: "ge_wall_" + scope,
        onTap: view
      });

      const toViewer = (b) => {
        const dx = (wallEl.clientWidth - 390) / 2;
        return { x: b.x - dx, y: b.y, w: b.w, h: b.h };
      };

      let current = null;
      let busy = false;
      let opened = false;

      async function view(m) {
        if (busy || current) return;
        busy = true;
        current = m;
        m.viewing = true;
        door.setText(m.entry.pursuit, m.entry.message, {
          name: m.entry.name,
          majorPx: 22 * VIEW_SURFACE.d / VIEW_POSE.w,
          namePx: 14 * VIEW_SURFACE.d / VIEW_POSE.w,
          answerPx: 22
        });
        await door.close(0);
        opened = false;
        door.el.classList.remove("show-major");
        door.pose(toViewer(wall.boxOf(m)));
        door.el.hidden = false;
        m.el.style.visibility = "hidden";
        scrim.classList.add("visible");
        await nextFrame();
        door.el.classList.add("show-major");
        await door.pose(VIEW_POSE, 450);
        door.knob.focus({ preventScroll: true });
        busy = false;
      }

      door.knob.addEventListener("click", async () => {
        if (busy || opened) return;
        busy = true;
        await door.pose(null, 350);
        await door.open(1100);
        opened = true;
        busy = false;
      });

      async function closeViewer() {
        if (!current || busy) return;
        busy = true;
        if (opened) {
          await door.close(600);
          opened = false;
        }
        door.el.classList.remove("show-major");
        await door.pose(toViewer(wall.boxOf(current)), 400);
        door.el.hidden = true;
        current.el.style.visibility = "";
        current.viewing = false;
        current.el.focus({ preventScroll: true });
        current = null;
        scrim.classList.remove("visible");
        busy = false;
      }

      scrim.addEventListener("click", closeViewer);
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeViewer(); });
    })();
  }
})();
