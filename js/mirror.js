// Shared mirror pieces: the door that swings open (create flow + archive
// viewer) and the Matter.js wall the archive pages hang mirrors on.
(function () {
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // In Figma's open art the lid shows as a sliver 0.218x the mirror's width,
  // left of the hinge: a disc hinged at its left edge and swung 102.6deg.
  const SWING_DEG = -102.6;

  // A mirror that opens like a door. It's laid out on its *open* surface
  // circle (box = {x, y, d}); pose() maps that circle onto any other box, so
  // the same element can sit small on the wall, enlarge, then swing open.
  function createDoor(parent, { knob = false } = {}) {
    const el = document.createElement("div");
    el.className = "door";
    el.hidden = true;
    el.innerHTML =
      '<div class="door-surface"><p class="door-answer"></p></div>' +
      '<div class="door-hinge"></div>' +
      '<div class="door-lid">' +
        '<div class="door-rim"></div>' +
        '<div class="door-back"></div>' +
        '<div class="door-front">' +
          '<img class="mirror-art" src="/assets/mirror-closed.svg" alt="" />' +
          '<div class="door-major"><p class="door-major-text"></p><p class="door-name"></p></div>' +
          (knob ? '<button type="button" class="door-knob" aria-label="Open the mirror"></button>' : "") +
        "</div>" +
      "</div>";
    parent.appendChild(el);

    let box = null;

    const door = {
      el,
      knob: el.querySelector(".door-knob"),
      place(b) {
        box = b;
        Object.assign(el.style, { left: b.x + "px", top: b.y + "px", width: b.d + "px", height: b.d + "px" });
        el.style.setProperty("--thick", (b.d * 0.019).toFixed(2) + "px");
      },
      // target: {x, y, w, h} to show the closed mirror there, or null for the
      // surface circle itself (where it must be before it swings open)
      pose(target, ms = 0) {
        el.style.transition = ms && !REDUCED ? `transform ${ms}ms cubic-bezier(.3,.7,.3,1)` : "none";
        el.style.transform = target
          ? `translate(${target.x - box.x}px, ${target.y - box.y}px) scale(${target.w / box.d}, ${target.h / box.d})`
          : "none";
        return wait(REDUCED ? 0 : ms);
      },
      open(ms = 1100) {
        el.style.setProperty("--swing", (REDUCED ? 0 : ms) + "ms");
        el.classList.add("is-open");
        return wait(REDUCED ? 0 : ms);
      },
      close(ms = 700) {
        el.style.setProperty("--swing", (REDUCED ? 0 : ms) + "ms");
        el.classList.remove("is-open");
        return wait(REDUCED ? 0 : ms);
      },
      // 69:432: the major, with "-Name" beneath it when the writer chose to
      // show their name; the major itself stays centred on the glass
      setText(major, answer, { name = "", majorPx, namePx, answerPx } = {}) {
        const wrap = el.querySelector(".door-major");
        const m = el.querySelector(".door-major-text");
        const n = el.querySelector(".door-name");
        const a = el.querySelector(".door-answer");
        m.textContent = major || "";
        n.textContent = name ? "-" + name : "";
        n.hidden = !name;
        a.textContent = answer || "";
        if (majorPx) m.style.fontSize = majorPx + "px";
        if (namePx) n.style.fontSize = namePx + "px";
        if (answerPx) a.style.fontSize = answerPx + "px";
        wrap.style.paddingTop = name ? n.style.fontSize.replace("px", "") * 1.2 + "px" : "0";
      },
      SWING_DEG
    };
    return door;
  }

  // ---------------- the wall ----------------
  // Mirrors drop in with physics; drag one near a hook to hang it there.
  // Hooks are the five mirror spots from the Figma archive (node 52:66), in
  // its 390px-wide content-area coordinates.
  const HOOKS = [
    { x: 100, y: 172.5, d: 127 },
    { x: 280, y: 234, d: 126 },
    { x: 110, y: 382, d: 126 },
    { x: 276, y: 482, d: 126 },
    { x: 100, y: 592.5, d: 84 }
  ];

  // stable 0..1 value per string: a string hash plus an avalanche finaliser,
  // so ids that differ only slightly still land far apart
  function rand01(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function createWall({ el, entries, storageKey, onTap }) {
    const { Engine, Runner, Bodies, Body, Composite, Constraint } = window.Matter;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const sx = W / 390;

    const engine = Engine.create({ enableSleeping: true });
    engine.gravity.y = 1;
    const T = 60; // wall thickness
    Composite.add(engine.world, [
      Bodies.rectangle(W / 2, H + T / 2, W * 3, T, { isStatic: true }),
      Bodies.rectangle(-T / 2, H / 2 - H, T, H * 4, { isStatic: true }),
      Bodies.rectangle(W + T / 2, H / 2 - H, T, H * 4, { isStatic: true })
    ]);

    // hung mirrors are on the wall plane, the loose pile is on the floor in
    // front of it: loose mirrors collide with each other and the walls, but
    // pass in front of hung ones instead of landing on top of them
    const LOOSE = { category: 0x0002, mask: 0x0001 | 0x0002 };
    const HUNG = { category: 0x0004, mask: 0 };
    const CARRIED = { category: 0x0002, mask: 0x0001 };

    const hooks = HOOKS.map((h) => ({ x: h.x * sx, y: h.y, d: h.d, mirror: null }));
    hooks.forEach((h) => {
      h.ghost = document.createElement("div");
      h.ghost.className = "hook-ghost";
      Object.assign(h.ghost.style, { left: h.x - h.d / 2 + "px", top: h.y - h.d / 2 + "px", width: h.d + "px", height: h.d + "px" });
      el.appendChild(h.ghost);
    });

    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch (e) { saved = {}; }
    const persist = () => {
      const out = {};
      hooks.forEach((h, i) => { if (h.mirror) out[h.mirror.entry.id] = i; });
      try { localStorage.setItem(storageKey, JSON.stringify(out)); } catch (e) { /* storage unavailable */ }
    };

    // shrink everything a little when there are many mirrors so the pile fits
    const fit = Math.min(1, Math.sqrt(14 / Math.max(entries.length, 1)));

    const mirrors = entries.map((entry) => {
      const rand = rand01(String(entry.id));
      const d = Math.max(56, (84 + rand * 43) * fit);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wall-mirror";
      btn.setAttribute("aria-label", entry.pursuit ? `Mirror: ${entry.pursuit}` : "Mirror");
      Object.assign(btn.style, { width: d + "px", height: d + "px" });
      btn.innerHTML = '<img class="mirror-art" src="/assets/mirror-closed.svg" alt="" />';
      el.appendChild(btn);
      return { entry, d, r: d / 2, el: btn, body: null, hook: null, viewing: false };
    });

    function hang(m, hook, animate) {
      if (m.hook) m.hook.mirror = null;
      m.hook = hook;
      hook.mirror = m;
      m.body.collisionFilter = { ...m.body.collisionFilter, ...HUNG };
      m.el.classList.add("is-hung");
      Body.setStatic(m.body, true);
      Body.setAngle(m.body, 0);
      if (!animate || REDUCED) {
        Body.setPosition(m.body, { x: hook.x, y: hook.y });
        return;
      }
      const from = { ...m.body.position };
      const t0 = performance.now();
      (function step(t) {
        const k = Math.min(1, (t - t0) / 220);
        const e = 1 - Math.pow(1 - k, 3);
        Body.setPosition(m.body, { x: from.x + (hook.x - from.x) * e, y: from.y + (hook.y - from.y) * e });
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    }

    function unhang(m) {
      if (!m.hook) return;
      m.hook.mirror = null;
      m.hook = null;
      m.body.collisionFilter = { ...m.body.collisionFilter, ...LOOSE };
      m.el.classList.remove("is-hung");
      Body.setStatic(m.body, false);
    }

    // hung mirrors appear on their hooks; the rest drop in one by one
    let dropIndex = 0;
    mirrors.forEach((m) => {
      const hook = hooks[saved[m.entry.id]];
      const opts = { restitution: 0.25, friction: 0.3, frictionAir: 0.012, density: 0.002, collisionFilter: { ...LOOSE } };
      if (hook && !hook.mirror) {
        m.body = Bodies.circle(hook.x, hook.y, m.r, opts);
        Composite.add(engine.world, m.body);
        hang(m, hook, false);
      } else {
        const delay = dropIndex++ * 140;
        const x = m.r + rand01(m.entry.id + "x") * (W - 2 * m.r);
        m.body = Bodies.circle(x, -m.r - 20, m.r, opts);
        m.el.style.visibility = "hidden";
        setTimeout(() => {
          Composite.add(engine.world, m.body);
          m.el.style.visibility = "";
        }, REDUCED ? 0 : delay);
      }
    });
    persist();

    // keep the DOM in step with the physics
    function render() {
      for (const m of mirrors) {
        const { x, y } = m.body.position;
        m.el.style.transform = `translate(${x - m.r}px, ${y - m.r}px) rotate(${m.body.angle}rad)`;
      }
      rafId = requestAnimationFrame(render);
    }
    let rafId = requestAnimationFrame(render);
    const runner = Runner.create();
    Runner.run(runner, engine);

    // ---- drag to pick up, release near a free hook to hang ----
    let drag = null;
    let suppressClick = false;

    const local = (e) => {
      const b = el.getBoundingClientRect();
      return { x: Math.max(0, Math.min(W, e.clientX - b.left)), y: Math.max(0, Math.min(H, e.clientY - b.top)) };
    };

    function nearestFreeHook(m) {
      let best = null, bestDist = Infinity;
      for (const h of hooks) {
        if (h.mirror && h.mirror !== m) continue;
        const dist = Math.hypot(m.body.position.x - h.x, m.body.position.y - h.y);
        if (dist < h.d / 2 + 35 && dist < bestDist) { best = h; bestDist = dist; }
      }
      return best;
    }

    function markTarget(m) {
      const target = nearestFreeHook(m);
      hooks.forEach((h) => {
        h.ghost.classList.toggle("free", !h.mirror || h.mirror === m);
        h.ghost.classList.toggle("target", h === target);
      });
    }

    mirrors.forEach((m) => {
      m.el.addEventListener("pointerdown", (e) => {
        if (m.viewing || !m.body) return;
        suppressClick = false;
        m.el.setPointerCapture(e.pointerId);
        drag = { m, start: local(e), id: e.pointerId, constraint: null };
      });

      m.el.addEventListener("pointermove", (e) => {
        if (!drag || drag.m !== m || drag.id !== e.pointerId) return;
        const p = local(e);
        if (!drag.constraint) {
          if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 6) return;
          unhang(m);
          // a carried mirror is lifted off the pile: it only meets the walls
          // until it's let go, instead of plowing through the other mirrors
          m.body.collisionFilter = { ...m.body.collisionFilter, ...CARRIED };
          Body.setAngularVelocity(m.body, 0);
          drag.constraint = Constraint.create({
            pointA: p,
            bodyB: m.body,
            pointB: { x: drag.start.x - m.body.position.x, y: drag.start.y - m.body.position.y },
            angleB: m.body.angle,
            stiffness: 0.2,
            damping: 0.1,
            length: 0
          });
          Composite.add(engine.world, drag.constraint);
          el.classList.add("dragging");
          m.el.classList.add("is-dragging");
        }
        drag.constraint.pointA = p;
        markTarget(m);
      });

      const end = (e) => {
        if (!drag || drag.m !== m || drag.id !== e.pointerId) return;
        if (drag.constraint) {
          Composite.remove(engine.world, drag.constraint);
          const hook = nearestFreeHook(m);
          if (hook) hang(m, hook, true);
          else m.body.collisionFilter = { ...m.body.collisionFilter, ...LOOSE };
          persist();
          suppressClick = true;
          el.classList.remove("dragging");
          m.el.classList.remove("is-dragging");
          hooks.forEach((h) => h.ghost.classList.remove("target"));
        }
        drag = null;
      };
      m.el.addEventListener("pointerup", end);
      m.el.addEventListener("pointercancel", end);

      m.el.addEventListener("click", () => {
        if (suppressClick) { suppressClick = false; return; }
        if (m.viewing) return;
        onTap(m);
      });
    });

    return {
      mirrors,
      // current circle box of a mirror, in wall coordinates
      boxOf(m) {
        const { x, y } = m.body.position;
        return { x: x - m.r, y: y - m.r, w: m.d, h: m.d };
      },
      destroy() {
        cancelAnimationFrame(rafId);
        Runner.stop(runner);
      }
    };
  }

  window.MirrorDoor = { create: createDoor };
  window.MirrorWall = { create: createWall };
})();
