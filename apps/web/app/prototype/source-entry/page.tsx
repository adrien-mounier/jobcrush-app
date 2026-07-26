"use client";

// PROTOTYPE — throwaway. Issue #41.
// Three variants of the opening → source choice → import result → discovery handoff,
// switchable via `?variant=`, on the isolated `/prototype/source-entry` route.
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import "./prototype.css";

type Variant = "A" | "B" | "C";
type Stage = "door" | "choice" | "sources" | "reading" | "results" | "discovery";

const variants: { key: Variant; name: string }[] = [
  { key: "A", name: "One calm question" },
  { key: "B", name: "Two-path canvas" },
  { key: "C", name: "Journey rail" },
];

function Brand() {
  return <div className="prototype-brand">Job<span>Crush</span></div>;
}

function Opening({ onReady, leaving }: { onReady: () => void; leaving: boolean }) {
  return (
    <section className={`opening${leaving ? " leaving" : ""}`}>
      <Brand />
      <div className="opening-copy" aria-label="Answer questions. Collect jobs.">
        <h1>Answer questions.</h1>
        <h1>Collect jobs.</h1>
      </div>
      <button className="primary ready" disabled={leaving} onClick={onReady}>Ready?</button>
    </section>
  );
}

function LinkedInSoon() {
  return (
    <div className="source linkedin" aria-disabled="true">
      <div className="source-icon">in</div>
      <div>
        <strong>LinkedIn profile</strong>
        <small>Direct LinkedIn import</small>
      </div>
      <span className="soon">Coming soon</span>
    </div>
  );
}

function CvSource({ onPick }: { onPick: (name: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="source cv-source" onClick={() => input.current?.click()}>
        <div className="source-icon">CV</div>
        <div>
          <strong>Upload your CV</strong>
          <small>PDF, Word, or text</small>
        </div>
        <span className="source-arrow">→</span>
      </button>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".pdf,.docx,.txt"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file.name);
          event.target.value = "";
        }}
      />
    </>
  );
}

function SourceFields({
  onPick,
  onScratch,
}: {
  onPick: (name: string) => void;
  onScratch: () => void;
}) {
  return (
    <div className="source-fields">
      <CvSource onPick={onPick} />
      <LinkedInSoon />
      <button className="source scratch-button" onClick={onScratch}>
        <div className="source-icon">?</div>
        <div>
          <strong>Start questions instead</strong>
          <small>Continue without importing anything</small>
        </div>
        <span className="source-arrow">→</span>
      </button>
      <p className="privacy">Used temporarily during onboarding. Nothing is saved to an account yet.</p>
    </div>
  );
}

function Results({ fileName, onContinue }: { fileName: string; onContinue: () => void }) {
  return (
    <section className="results">
      <Brand />
      <div className="result-check" aria-hidden="true">✓</div>
      <p className="eyebrow">{fileName} is ready</p>
      <h2>We found 12 useful facts.</h2>
      <p className="muted">That lets us skip 4 opening questions. These are provisional—you can correct them later.</p>
      <div className="fact-list">
        <span>IT project manager</span>
        <span>Paris, France</span>
        <span>8 years’ experience</span>
        <span>Jira · MS Project · ERP</span>
      </div>
      <button className="primary wide" onClick={onContinue}>Ask me what’s missing</button>
    </section>
  );
}

function Discovery({ assisted }: { assisted: boolean }) {
  return (
    <section className="discovery-preview">
      <Brand />
      <p className="eyebrow">{assisted ? "First unanswered question" : "Starting from scratch"}</p>
      <h2>{assisted ? "What size teams have you led?" : "What kind of job are you going for?"}</h2>
      <p className="muted">
        {assisted
          ? "Your CV already gave us your role, location, experience, and tools."
          : "Tell us the role, location, and anything else that matters."}
      </p>
      <textarea
        rows={3}
        placeholder={assisted ? "e.g. 6–12 people across product and engineering" : "e.g. IT project manager in Paris, mostly ERP…"}
      />
      <button className="primary wide">That’s me</button>
    </section>
  );
}

type VariantProps = {
  stage: Stage;
  fileName: string;
  chooseYes: () => void;
  chooseNo: () => void;
  pickCv: (name: string) => void;
};

function VariantA({ stage, fileName, chooseYes, chooseNo, pickCv }: VariantProps) {
  if (stage === "reading") return <Reading compact />;
  if (stage === "results") return <Results fileName={fileName} onContinue={chooseYes} />;
  if (stage === "discovery") return <Discovery assisted={Boolean(fileName)} />;
  return (
    <section className="variant-a">
      <Brand />
      <p className="step">Before the questions</p>
      <h2>Do you have a CV or LinkedIn profile that could help us skip some questions?</h2>
      {stage === "choice" ? (
        <div className="binary">
          <button className="primary wide" onClick={chooseYes}>Yes, use my information</button>
          <button className="secondary wide" onClick={chooseNo}>No, start from scratch</button>
        </div>
      ) : (
        <SourceFields onPick={pickCv} onScratch={chooseNo} />
      )}
    </section>
  );
}

function VariantB({ stage, fileName, chooseYes, chooseNo, pickCv }: VariantProps) {
  if (stage === "reading") return <Reading />;
  if (stage === "results") return <Results fileName={fileName} onContinue={chooseYes} />;
  if (stage === "discovery") return <Discovery assisted={Boolean(fileName)} />;
  return (
    <section className="variant-b">
      <div className="b-copy">
        <Brand />
        <p className="eyebrow">A head start, if you want one</p>
        <h2>Skip what we can already learn.</h2>
        <p>Bring what you have, or begin with a blank page. Both routes lead to the same questions and jobs.</p>
        <button className="text-action" onClick={chooseNo}>I’d rather start from scratch →</button>
      </div>
      <div className="b-panel">
        <h3>{stage === "choice" ? "Do you have something to use?" : "Choose either—or both later"}</h3>
        {stage === "choice" ? (
          <div className="binary horizontal">
            <button className="primary" onClick={chooseYes}>Yes</button>
            <button className="secondary" onClick={chooseNo}>No</button>
          </div>
        ) : (
          <SourceFields onPick={pickCv} onScratch={chooseNo} />
        )}
      </div>
    </section>
  );
}

function VariantC({ stage, fileName, chooseYes, chooseNo, pickCv }: VariantProps) {
  if (stage === "reading") return <Reading />;
  if (stage === "results") return <Results fileName={fileName} onContinue={chooseYes} />;
  if (stage === "discovery") return <Discovery assisted={Boolean(fileName)} />;
  return (
    <section className="variant-c">
      <Brand />
      <div className="journey">
        <div className="journey-item done"><i>1</i><span><strong>Ready</strong><small>You’re in.</small></span></div>
        <div className="journey-item active">
          <i>2</i>
          <div className="journey-body">
            <span><strong>Bring what you have</strong><small>A CV can skip questions you’ve already answered.</small></span>
            {stage === "choice" ? (
              <div className="binary horizontal">
                <button className="primary" onClick={chooseYes}>Yes, I have one</button>
                <button className="secondary" onClick={chooseNo}>No, start fresh</button>
              </div>
            ) : (
              <SourceFields onPick={pickCv} onScratch={chooseNo} />
            )}
          </div>
        </div>
        <div className="journey-item future"><i>3</i><span><strong>Fill the gaps</strong><small>Only the questions that still matter.</small></span></div>
        <div className="journey-item future"><i>4</i><span><strong>Collect jobs</strong><small>Your closest matches first.</small></span></div>
      </div>
    </section>
  );
}

function Reading({ compact = false }: { compact?: boolean }) {
  return (
    <section className={`reading-state${compact ? " compact" : ""}`}>
      <Brand />
      <div className="scan" />
      <p className="eyebrow">Reading your CV</p>
      <h2>Finding the facts that can save you questions…</h2>
      <div className="reading-lines"><span /><span /><span /></div>
    </section>
  );
}

function Switcher({ variant }: { variant: Variant }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, [contenteditable]")) return;
      const index = variants.findIndex((item) => item.key === variant);
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = variants[(index + delta + variants.length) % variants.length];
      router.replace(`?variant=${next.key}`);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [router, variant]);
  if (process.env.NODE_ENV === "production") return null;
  const index = variants.findIndex((item) => item.key === variant);
  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    router.replace(`?variant=${next.key}`);
  };
  return (
    <nav className="prototype-switcher" aria-label="Prototype variants">
      <button onClick={() => go(-1)} aria-label="Previous variant">←</button>
      <span>{variant} — {variants[index].name}</span>
      <button onClick={() => go(1)} aria-label="Next variant">→</button>
    </nav>
  );
}

function Prototype() {
  const params = useSearchParams();
  const requested = params.get("variant");
  const variant: Variant = requested === "B" || requested === "C" ? requested : "A";
  const [stage, setStage] = useState<Stage>("door");
  const [fileName, setFileName] = useState("");
  const [doorLeaving, setDoorLeaving] = useState(false);

  useEffect(() => {
    setStage("door");
    setFileName("");
    setDoorLeaving(false);
  }, [variant]);

  const chooseYes = () => setStage(stage === "results" ? "discovery" : "sources");
  const chooseNo = () => {
    setFileName("");
    setStage("discovery");
  };
  const pickCv = (name: string) => {
    setFileName(name);
    setStage("reading");
    setTimeout(() => setStage("results"), 1150);
  };
  const leaveDoor = () => {
    setDoorLeaving(true);
    setTimeout(() => {
      setStage("choice");
      setDoorLeaving(false);
    }, 520);
  };

  const props = { stage, fileName, chooseYes, chooseNo, pickCv };
  return (
    <main className={`source-prototype variant-${variant.toLowerCase()}`}>
      <div className="phone">
        {stage === "door" ? (
          <Opening onReady={leaveDoor} leaving={doorLeaving} />
        ) : (
          <div key={`${variant}-${stage}`} className="stage-enter">
            {variant === "A" ? (
              <VariantA {...props} />
            ) : variant === "B" ? (
              <VariantB {...props} />
            ) : (
              <VariantC {...props} />
            )}
          </div>
        )}
        <aside className="state-readout" aria-label="Prototype state">
          variant={variant} · stage={stage} · source={fileName ? "cv" : "none"}
        </aside>
      </div>
      <button className="reset" onClick={() => { setStage("door"); setFileName(""); setDoorLeaving(false); }}>Restart flow</button>
      <Switcher variant={variant} />
    </main>
  );
}

export default function SourceEntryPrototypePage() {
  return (
    <Suspense>
      <Prototype />
    </Suspense>
  );
}
