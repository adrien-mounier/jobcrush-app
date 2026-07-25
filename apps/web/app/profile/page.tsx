"use client";

// #20 the profile screen (Sorted + Constellation) — under the colour law: gold = on the rendered CV
// right now, grey = saved in reserve. One derivation, rendered by both views, never re-derived here
// (design-20-profile-screen.md §3). No "what you lack" list exists anywhere on this screen: the
// payload carries no negative facts, and the UI must not invent one from an empty domain.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import "../deck.css";
import "../profile.css";
import { FactBadge } from "../factbadge";
import { useReducedMotion } from "../jobcard";
import { ensureSession, getProfile, type ProfileDomain, type ProfileFact, type ProfileState } from "../../lib/api";

type Screen = "loading" | "error" | "empty" | "ready";
type View = "sorted" | "constellation";

const P1 = "Gathering everything you've told me…";
const P2 = "Couldn't open your profile.";
const P3 = "Try again";
const P4 = "‹ Back";
const P5 = "your profile";
const P9 = "Nothing here yet.";
const P10 = "Answer a question and the first thing you tell me lands here.";
const P11 = "Answer a question";
const P13 = "Sorted";
const P14 = "Constellation";
const P15 = "How to view your profile";
const P12 = "Everything you tell me from here lands on this screen and stays.";
const P18 = "on your CV";
const P19 = "saved for later";
const P20 = "Every point is something you told me. Tap one.";
const P21 = "On your CV right now";
const P22 = "Saved to your profile";
const P23 = "It'll be used when a job asks for it. ";
const P24 = "You told me this.";
const P25 = "Read from your CV.";
const P26 = "Close";
const P29 = "Every fact, as a list";

const ICON_SORTED = (
  <svg className="ic" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
    <path d="M2 3.5h10M2 7h7M2 10.5h4" />
  </svg>
);
const ICON_SKY = (
  <svg className="ic" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden="true">
    <circle cx="3.4" cy="4" r="1.5" />
    <circle cx="10.6" cy="3.2" r="1.2" />
    <circle cx="7" cy="9.8" r="1.6" />
    <path d="M4.6 4.9 5.9 8.5M9.6 4.2 8 8.5" strokeLinecap="round" />
  </svg>
);

// P7/P8 — both counts tinted inline, never the only carrier (the words "on your CV"/"waiting" ride
// along in the same sentence, §3.2). All-gold collapses to P8; otherwise P7.
function Pwait({ gold, grey }: { gold: number; grey: number }) {
  if (grey === 0) {
    const text = gold === 1 ? "It's on your CV right now." : `All ${gold} are on your CV right now.`;
    return (
      <p className="pwait">
        <b className="g">{text}</b>
      </p>
    );
  }
  const goldClause = gold === 1 ? "1 is on your CV right now." : `${gold} are on your CV right now.`;
  const greyClause = grey === 1 ? "1 is waiting for a job that asks for it." : `${grey} are waiting for a job that asks for them.`;
  return (
    <p className="pwait">
      <b className="g">{goldClause}</b> <span className="dot">·</span> <b className="r">{greyClause}</b>
    </p>
  );
}

// §1: the payload has no explicit strength score, so the local proxy is longest text.
// Ties → lowest index (store order); colour is only the visual law, never the ranking law.
function pickLead(facts: ProfileFact[]): { lead: ProfileFact; rest: ProfileFact[] } {
  let lead = facts[0];
  for (const f of facts) if (f.text.length > lead.text.length) lead = f;
  return { lead, rest: facts.filter((f) => f.id !== lead.id) };
}

function chipText(text: string): string {
  return text.replace(/\.$/, "");
}

function sourceLine(source: ProfileFact["source"]): string {
  return source === "told" ? P24 : P25;
}

// The shared detail block (§4) — the same three lines whether painted into the Sorted dialog or the
// Constellation sheet.
function DetailBody({ fact }: { fact: ProfileFact }) {
  const on = fact.colour === "gold";
  return (
    <>
      <p className={`cl ${on ? "on" : "wait"}`}>
        <i aria-hidden="true" />
        {on ? P21 : P22}
      </p>
      <p className="txt">{fact.text}</p>
      <p className="src">
        {!on && P23}
        <b>{sourceLine(fact.source)}</b>
      </p>
    </>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  const [screen, setScreen] = useState<Screen>("loading");
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [view, setView] = useState<View>("sorted");
  const [liveMessage, setLiveMessage] = useState("");
  const [selected, setSelected] = useState<ProfileFact | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const emptyHeadingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const sortedButtonRef = useRef<HTMLButtonElement>(null);
  const skyButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogOpenerRef = useRef<HTMLElement | null>(null);
  const sortedScrollRef = useRef(0);
  const sortedBodyRef = useRef<HTMLDivElement>(null);
  const enteredRef = useRef(false);

  const load = useCallback(async () => {
    setScreen("loading");
    try {
      await ensureSession();
      const state = await getProfile();
      setProfile(state);
      const hasFacts = state.domains.some((d) => d.facts.length > 0);
      setScreen(hasFacts ? "ready" : "empty");
    } catch {
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Entry (§8): focus the first meaningful target when loading resolves.
  useEffect(() => {
    if (screen === "ready" && !enteredRef.current) {
      enteredRef.current = true;
      headingRef.current?.focus();
    } else if (screen === "empty") {
      emptyHeadingRef.current?.focus();
    } else if (screen === "error") {
      errorRef.current?.focus();
    }
  }, [screen]);

  const restoreDialogFocus = useCallback(() => {
    const opener = dialogOpenerRef.current;
    dialogOpenerRef.current = null;
    requestAnimationFrame(() => {
      const fallback = (view === "sorted" ? sortedButtonRef.current : skyButtonRef.current) ?? headingRef.current;
      const target = opener?.isConnected ? opener : fallback;
      target?.focus({ preventScroll: true });
    });
  }, [view]);

  const openFact = useCallback(
    (fact: ProfileFact) => {
      setSelected(fact);
      if (view === "sorted" && !dialogRef.current?.open) {
        const active = document.activeElement;
        dialogOpenerRef.current = active instanceof HTMLElement ? active : null;
        dialogRef.current?.showModal();
      }
      setLiveMessage(`${fact.text} — ${fact.colour === "gold" ? P21 : P22}. ${sourceLine(fact.source)}`);
    },
    [view],
  );

  const closeDialog = useCallback(() => {
    if (dialogRef.current?.open) {
      dialogRef.current.close();
      return;
    }
    setSelected(null);
  }, []);

  const handleDialogClosed = useCallback(() => {
    setSelected(null);
    restoreDialogFocus();
  }, [restoreDialogFocus]);

  const switchView = useCallback((next: View) => {
    if (next === view) return;
    closeDialog();
    if (view === "sorted") sortedScrollRef.current = sortedBodyRef.current?.scrollTop ?? 0;
    setView(next);
    setLiveMessage(next === "sorted" ? "Sorted view" : "Constellation view");
    if (next === "sorted") {
      requestAnimationFrame(() => {
        if (sortedBodyRef.current) sortedBodyRef.current.scrollTop = sortedScrollRef.current;
      });
    }
    (next === "sorted" ? sortedButtonRef : skyButtonRef).current?.focus();
  }, [closeDialog, view]);

  const totalCount = profile?.factCount ?? 0;

  return (
    <div className="jobdeck profile" ref={rootRef}>
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>

      {screen === "loading" && <div className="loadstate">{P1}</div>}

      {screen === "error" && (
        <div className="loadstate">
          <p role="alert" tabIndex={-1} ref={errorRef}>
            {P2}
          </p>
          <button type="button" onClick={load}>
            {P3}
          </button>
        </div>
      )}

      {screen === "empty" && (
        <div className="loadstate">
          <h1 className="big" tabIndex={-1} ref={emptyHeadingRef}>
            {P9}
          </h1>
          <p>{P10}</p>
          <button type="button" onClick={() => router.push("/discovery")}>
            {P11}
          </button>
        </div>
      )}

      {screen === "ready" && profile && (
        <ReadyScreen
          profile={profile}
          view={view}
          totalCount={totalCount}
          reducedMotion={reducedMotion}
          rootRef={rootRef}
          headingRef={headingRef}
          sortedButtonRef={sortedButtonRef}
          skyButtonRef={skyButtonRef}
          dialogRef={dialogRef}
          sortedBodyRef={sortedBodyRef}
          selected={selected}
          onSwitchView={switchView}
          onOpenFact={openFact}
          onCloseDialog={closeDialog}
          onDialogClosed={handleDialogClosed}
          onBack={() => router.back()}
        />
      )}
    </div>
  );
}

function ReadyScreen({
  profile,
  view,
  totalCount,
  reducedMotion,
  rootRef,
  headingRef,
  sortedButtonRef,
  skyButtonRef,
  dialogRef,
  sortedBodyRef,
  selected,
  onSwitchView,
  onOpenFact,
  onCloseDialog,
  onDialogClosed,
  onBack,
}: {
  profile: ProfileState;
  view: View;
  totalCount: number;
  reducedMotion: boolean;
  rootRef: React.RefObject<HTMLDivElement | null>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  sortedButtonRef: React.RefObject<HTMLButtonElement | null>;
  skyButtonRef: React.RefObject<HTMLButtonElement | null>;
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  sortedBodyRef: React.RefObject<HTMLDivElement | null>;
  selected: ProfileFact | null;
  onSwitchView: (v: View) => void;
  onOpenFact: (f: ProfileFact) => void;
  onCloseDialog: () => void;
  onDialogClosed: () => void;
  onBack: () => void;
}) {
  const indRef = useRef<HTMLSpanElement>(null);

  // §2: the sliding pill is positioned off the pressed button's own box, not hard-coded — works at
  // any width/floor without a second breakpoint to maintain.
  useLayoutEffect(() => {
    const btn = (view === "sorted" ? sortedButtonRef : skyButtonRef).current;
    const ind = indRef.current;
    if (!btn || !ind) return;
    function place() {
      ind!.style.left = `${btn!.offsetLeft}px`;
      ind!.style.width = `${btn!.offsetWidth}px`;
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [view, sortedButtonRef, skyButtonRef]);

  const visibleCount = profile.domains.reduce((s, d) => s + d.facts.length, 0);
  const gold = profile.domains.reduce((s, d) => s + d.facts.filter((f) => f.colour === "gold").length, 0);
  const grey = Math.max(0, visibleCount - gold);
  const showP12 = visibleCount <= 2;

  const domains = useMemo(() => [...profile.domains].sort((a, b) => b.facts.length - a.facts.length), [profile.domains]);
  const biggest = domains.reduce((m, d) => Math.max(m, d.facts.length), 1);

  return (
    <>
      <div className="topbar">
        <button type="button" className="back" aria-label="Back" onClick={onBack}>
          {P4}
        </button>
        <div className="seg" role="group" aria-label={P15}>
          <span className="ind" ref={indRef} aria-hidden="true" />
          <button
            type="button"
            ref={sortedButtonRef}
            className={view === "sorted" ? "on" : ""}
            aria-pressed={view === "sorted"}
            title={P13}
            aria-label={P13}
            aria-controls="profileview"
            onClick={() => onSwitchView("sorted")}
          >
            {ICON_SORTED}
          </button>
          <button
            type="button"
            ref={skyButtonRef}
            className={view === "constellation" ? "on" : ""}
            aria-pressed={view === "constellation"}
            title={P14}
            aria-label={P14}
            aria-controls="profileview"
            onClick={() => onSwitchView("constellation")}
          >
            {ICON_SKY}
          </button>
        </div>
        <FactBadge count={totalCount} fly={null} rootRef={rootRef} />
      </div>

      {view === "sorted" && (
        <section className="phead">
          <p className="ptitle">{P5}</p>
          <h1 className="pcount" tabIndex={-1} ref={headingRef}>
            <span className="n">{totalCount}</span> {totalCount === 1 ? "thing you've told me" : "things you've told me"}
          </h1>
          <Pwait gold={gold} grey={grey} />
        </section>
      )}

      <div id="profileview" className={`body ${view}`} ref={view === "sorted" ? sortedBodyRef : undefined}>
        {view === "sorted" ? (
          <div className="sheetwrap">
            {domains.map((d, i) => {
              const { lead, rest } = pickLead(d.facts);
              const a = (0.035 + 0.075 * (d.facts.length / biggest)).toFixed(3);
              return (
                <section
                  className="dom"
                  key={d.tag}
                  style={reducedMotion ? undefined : { animationDelay: `${Math.min(i * 55, 330)}ms` }}
                >
                  <span className="aura" style={{ ["--a" as string]: a }} aria-hidden="true" />
                  <div className="dhead">
                    <h2 className="dname">{d.heading}</h2>
                    <span className="dcount">
                      {d.facts.length}
                      <span className="sr-only"> {d.facts.length === 1 ? "fact" : "facts"}</span>
                    </span>
                  </div>
                  <p className={`dlead ${lead.colour}`}>{lead.text}</p>
                  {rest.length > 0 && (
                    <div className="facts">
                      {rest.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className={`fact ${f.colour}`}
                          aria-label={`${f.text} — ${f.colour === "gold" ? P21 : P22}`}
                          onClick={() => onOpenFact(f)}
                        >
                          {chipText(f.text)}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
            <p className="dnote">
              {showP12 ? (
                P12
              ) : (
                <>
                  <b className="g">Gold</b> is on your CV right now. <b className="r">Grey</b> is saved — it&rsquo;ll be
                  pulled in when a job asks for it. The CV is two pages, so it picks; nothing is ever dropped.
                </>
              )}
            </p>
          </div>
        ) : (
          <Constellation domains={domains} reducedMotion={reducedMotion} selected={selected} onOpenFact={onOpenFact} />
        )}
      </div>

      <dialog
        className="detail"
        ref={dialogRef}
        onClose={onDialogClosed}
        onClick={(e) => {
          if (e.target === dialogRef.current) onCloseDialog();
        }}
      >
        {selected && (
          <>
            <DetailBody fact={selected} />
            <button type="button" className="detailclose" onClick={onCloseDialog}>
              {P26}
            </button>
          </>
        )}
      </dialog>
    </>
  );
}

// ---------- Constellation ----------

const VB = 120;
const PAD_B = 104;

interface SkyNode {
  fact: ProfileFact;
  domainIndex: number;
  nx: number;
  ny: number;
  depth: number;
  ph: number;
  sp: number;
  linked: number[]; // indices into the flat node array — nearest already-placed sibling(s)
}

function buildSky(domains: ProfileDomain[]): SkyNode[] {
  const nodes: SkyNode[] = [];
  const k = domains.length;
  domains.forEach((d, i) => {
    const R = k <= 2 ? 17 : 34;
    const a = (i / k) * 2 * Math.PI - Math.PI / 2;
    const cx = 60 + Math.cos(a) * R;
    const cy = 60 + Math.sin(a) * R * 0.94;
    const m = d.facts.length;
    const maxSpr = k < 3 ? 18 : Math.min(19, R * Math.sin(Math.PI / k) * 0.9);
    const spread = Math.min(maxSpr, 3.4 + Math.sqrt(m) * 2.6);
    const domainStart = nodes.length;
    d.facts.forEach((fact, j) => {
      const r = spread * Math.sqrt((j + 0.6) / m);
      const theta = j * 2.399963;
      const nx = cx + Math.cos(theta) * r;
      const ny = cy + Math.sin(theta) * r;
      const depth = 0.45 + (((j * 37 + i * 71) % 100) / 100) * 0.55;
      const ph = j * 1.7 + i;
      const sp = 0.7 + (((j * 53 + i * 17) % 100) / 100) * 0.6;
      // ponytail: O(m²) nearest-sibling scan — fine at m <= 200 (design-20-profile-screen.md §5);
      // upgrade to a spatial grid if a domain ever grows past that.
      let nearest = -1;
      let best = Infinity;
      for (let p = 0; p < j; p++) {
        const other = nodes[domainStart + p];
        const dx = other.nx - nx;
        const dy = other.ny - ny;
        const dist = dx * dx + dy * dy;
        if (dist < best) {
          best = dist;
          nearest = domainStart + p;
        }
      }
      const idx = nodes.length;
      const node: SkyNode = { fact, domainIndex: i, nx, ny, depth, ph, sp, linked: [] };
      if (nearest >= 0) {
        node.linked.push(nearest);
        nodes[nearest].linked.push(idx);
      }
      nodes.push(node);
    });
  });
  return nodes;
}

function Constellation({
  domains,
  reducedMotion,
  selected,
  onOpenFact,
}: {
  domains: ProfileDomain[];
  reducedMotion: boolean;
  selected: ProfileFact | null;
  onOpenFact: (f: ProfileFact) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<SkyNode[]>([]);
  const spritesRef = useRef<{ gold: HTMLCanvasElement; grey: HTMLCanvasElement } | null>(null);
  const rafRef = useRef<number | null>(null);
  const hoveredRef = useRef<number | null>(null);
  const selIndexRef = useRef<number | null>(null);
  const t0Ref = useRef(0);
  const geomRef = useRef({ s: 1, sy: 1, ox: 0, oy: 0, usable: 0, w: 0, h: 0 });
  const [geom, setGeom] = useState(() => geomRef.current);
  const nodes = useMemo(() => buildSky(domains), [domains]);

  useEffect(() => {
    nodesRef.current = nodes;
    hoveredRef.current = null;
    selIndexRef.current = null;
  }, [nodes]);

  // Bloom sprites, baked once (§5) — the low-power path: never a live createRadialGradient per node.
  useEffect(() => {
    function makeSprite(rgb: string) {
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext("2d")!;
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, `rgba(${rgb},0.9)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return c;
    }
    spritesRef.current = { gold: makeSprite("232,163,61"), grey: makeSprite("116,138,161") };
  }, []);

  function px(n: SkyNode, t: number): { x: number; y: number } {
    const { s, sy, ox, oy } = geomRef.current;
    if (reducedMotion) return { x: ox + n.nx * s, y: oy + n.ny * sy };
    const A = 2.1 * n.depth;
    const w = t * 0.00026 * n.sp;
    const x = ox + (n.nx + Math.sin(w + n.ph) * A + Math.sin(w * 2.3 + n.ph * 0.6) * A * 0.3) * s;
    const y = oy + (n.ny + Math.cos(w * 0.82 + n.ph * 1.3) * A + Math.cos(w * 1.9 + n.ph) * A * 0.28) * sy;
    return { x, y };
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d")!;

    function resize() {
      const rect = wrap!.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas!.width = Math.round(rect.width * dpr);
      canvas!.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const usable = Math.max(60, rect.height - PAD_B);
      const s = Math.min(rect.width, usable) / VB;
      const sy = Math.min(usable / VB, s * 1.32);
      const ox = (rect.width - VB * s) / 2;
      const oy = (usable - VB * sy) / 2 + 6;
      const nextGeom = { s, sy, ox, oy, usable, w: rect.width, h: rect.height };
      geomRef.current = nextGeom;
      setGeom(nextGeom);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const n = nodesRef.current.length || 1;
    const baseR = Math.min(3.2, Math.max(n < 8 ? 2.2 : 1.15, 15 / Math.sqrt(n)));

    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    function nearestNode(cx: number, cy: number, maxDist: number, t: number): number | null {
      let best: number | null = null;
      let bestD = maxDist * maxDist;
      nodesRef.current.forEach((node, i) => {
        const p = px(node, t);
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    }

    function onPointerMove(e: PointerEvent) {
      if (!canHover) return;
      const rect = canvas!.getBoundingClientRect();
      const idx = nearestNode(e.clientX - rect.left, e.clientY - rect.top, 26, performance.now() - t0Ref.current);
      hoveredRef.current = idx;
      canvas!.classList.toggle("hoverable", idx !== null);
    }
    function onPointerDown(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      const idx = nearestNode(e.clientX - rect.left, e.clientY - rect.top, 46, performance.now() - t0Ref.current);
      if (idx !== null) {
        selIndexRef.current = idx;
        onOpenFact(nodesRef.current[idx].fact);
      }
    }
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);

    let visible = !document.hidden;
    function onVisChange() {
      visible = !document.hidden;
      if (visible) t0Ref.current = performance.now() - (performance.now() - t0Ref.current);
    }
    document.addEventListener("visibilitychange", onVisChange);

    t0Ref.current = performance.now();

    function litSet(idx: number | null): Set<number> {
      const s = new Set<number>();
      if (idx === null) return s;
      s.add(idx);
      for (const l of nodesRef.current[idx].linked) s.add(l);
      return s;
    }

    function draw(now: number) {
      const t = now - t0Ref.current;
      const { w, h } = geomRef.current;
      ctx.clearRect(0, 0, w, h);

      const hotIndex = hoveredRef.current ?? selIndexRef.current;
      const lit = litSet(hotIndex);
      const anyLit = lit.size > 0;
      const intro = Math.min(1, t / 900);

      // (1) links
      ctx.lineCap = "round";
      nodesRef.current.forEach((node, i) => {
        const p1 = px(node, t);
        node.linked.forEach((j) => {
          if (j < i) return; // draw each pair once
          const other = nodesRef.current[j];
          const p2 = px(other, t);
          const stagger = Math.max(0, Math.min(1, (t - i * 6) / 500));
          const litLine = lit.has(i) && lit.has(j);
          const alpha = (litLine ? 0.95 : anyLit ? 0.1 : 0.32) * intro * stagger;
          const toneA = node.fact.colour === "gold" ? "232,163,61" : "116,138,161";
          const toneB = other.fact.colour === "gold" ? "232,163,61" : "116,138,161";
          const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
          grad.addColorStop(0, `rgba(${toneA},${alpha})`);
          grad.addColorStop(1, `rgba(${toneB},${alpha})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = Math.max(0.4, baseR * 0.16);
          const midX = (p1.x + p2.x) / 2 - (p2.y - p1.y) * 0.07;
          const midY = (p1.y + p2.y) / 2 + (p2.x - p1.x) * 0.07;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
          ctx.stroke();
        });
      });

      // (2) node halos + cores, additive
      ctx.globalCompositeOperation = "lighter";
      const sprites = spritesRef.current;
      nodesRef.current.forEach((node, i) => {
        const p = px(node, t);
        const stagger = Math.max(0, Math.min(1, (t - i * 6) / 500));
        const isHot = hoveredRef.current === i || selIndexRef.current === i;
        const recede = anyLit ? (lit.has(i) ? 1 : 0.22) : 1;
        const dim = 0.72 + node.depth * 0.34;
        const r = baseR * node.depth * 1.15 * (isHot ? 1.4 : 1);
        const boost = isHot ? 1.9 : 1;
        const sprite = node.fact.colour === "gold" ? sprites?.gold : sprites?.grey;
        if (sprite) {
          const hr = r * 7 * boost;
          ctx.globalAlpha = dim * stagger * intro * recede;
          ctx.drawImage(sprite, p.x - hr, p.y - hr, hr * 2, hr * 2);
        }
        ctx.globalAlpha = 0.95 * dim * stagger * intro * recede;
        ctx.fillStyle = node.fact.colour === "gold" ? "rgba(255,224,170,1)" : "rgba(188,201,214,1)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.8, r), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      // (4) cluster labels
      ctx.font = "9.5px var(--mono, monospace)";
      ctx.fillStyle = "rgba(151,170,188,0.62)";
      const k = domains.length;
      domains.forEach((d, i) => {
        const R = k <= 2 ? 17 : 34;
        const a = (i / k) * 2 * Math.PI - Math.PI / 2;
        const cx = 60 + Math.cos(a) * R;
        const cy = 60 + Math.sin(a) * R * 0.94;
        const m = d.facts.length;
        const maxSpr = k < 3 ? 18 : Math.min(19, R * Math.sin(Math.PI / k) * 0.9);
        const spread = Math.min(maxSpr, 3.4 + Math.sqrt(m) * 2.6);
        const lx = cx + Math.cos(a) * (spread + 7);
        const ly = cy + Math.sin(a) * (spread + 7) + 1.2;
        const { s, sy, ox, oy } = geomRef.current;
        ctx.textAlign = Math.cos(a) > 0.4 ? "left" : Math.cos(a) < -0.4 ? "right" : "center";
        ctx.fillText(d.heading, ox + lx * s, oy + ly * sy);
      });

      // (5) hover tooltip
      const hoverIdx = hoveredRef.current;
      if (hoverIdx !== null) {
        const node = nodesRef.current[hoverIdx];
        const p = px(node, t);
        const label = node.fact.text;
        ctx.font = "12px var(--sans, sans-serif)";
        const tw = ctx.measureText(label).width;
        const flip = p.x + 16 + tw + 16 > geomRef.current.w;
        const bx = flip ? p.x - 16 - tw - 16 : p.x + 16;
        const by = Math.max(16, Math.min(geomRef.current.h - 12, p.y - 10));
        ctx.fillStyle = "rgba(9,12,16,0.88)";
        const rr = 8;
        const bw = tw + 16;
        const bh = 24;
        ctx.beginPath();
        ctx.moveTo(bx + rr, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bh, rr);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, rr);
        ctx.arcTo(bx, by + bh, bx, by, rr);
        ctx.arcTo(bx, by, bx + bw, by, rr);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#eef2f6";
        ctx.fillText(label, bx + 8, by + 16);
      }

      if (!reducedMotion && visible) rafRef.current = requestAnimationFrame(draw);
    }

    if (reducedMotion) {
      draw(t0Ref.current);
    } else {
      rafRef.current = requestAnimationFrame(draw);
    }

    // Redraw once on selection/hover changes even under reduced motion (no rAF loop there).
    const redraw = () => {
      if (reducedMotion) draw(t0Ref.current);
    };
    canvas.addEventListener("pointermove", redraw);
    canvas.addEventListener("pointerdown", redraw);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", redraw);
      canvas.removeEventListener("pointerdown", redraw);
      document.removeEventListener("visibilitychange", onVisChange);
    };
    // Interaction state stays in refs so tapping a star can update the hot node without tearing down
    // the draw loop. `px` is render math over refs plus reducedMotion, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains, reducedMotion, onOpenFact]);

  function chooseNode(i: number) {
    selIndexRef.current = i;
    hoveredRef.current = i;
    onOpenFact(nodes[i].fact);
  }

  return (
    <div className="sky" ref={wrapRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="vig" aria-hidden="true" />
      <div className="legend" aria-hidden="true">
        <span>
          <span className="dot" /> {P18}
        </span>
        <span className="c">
          <span className="dot" /> {P19}
        </span>
      </div>
      <ul className="skylist" aria-label={P29}>
        {nodes.map((node, i) => {
          const positioned = geom.w > 0 && geom.h > 0;
          const style = positioned
            ? { left: `${geom.ox + node.nx * geom.s}px`, top: `${geom.oy + node.ny * geom.sy}px` }
            : { left: `${node.nx}%`, top: `${node.ny}%` };
          return (
            <li key={node.fact.id} style={style}>
              <button
                type="button"
                className={`star ${node.fact.colour}${selected?.id === node.fact.id ? " active" : ""}`}
                aria-label={`${node.fact.text} — ${node.fact.colour === "gold" ? P21 : P22}`}
                onFocus={() => chooseNode(i)}
                onPointerEnter={() => {
                  hoveredRef.current = i;
                }}
                onPointerLeave={() => {
                  if (hoveredRef.current === i) hoveredRef.current = null;
                }}
                onClick={() => chooseNode(i)}
              />
            </li>
          );
        })}
      </ul>
      <div className={`sheet ${selected ? "in sheetin" : "hint"}`}>
        {selected ? <DetailBody fact={selected} /> : <p>{P20}</p>}
      </div>
    </div>
  );
}
