"use client";

// Three variants of Important-gap disclosure, switchable via ?variant=, on a
// throwaway route beside the existing /deck page.

import { useSearchParams } from "next/navigation";
import { PrototypeSwitcher } from "./PrototypeSwitcher";
import "./prototype.css";

const fit = [
  "Led multi-country ERP delivery",
  "Owned vendor and stakeholder governance",
  "Managed programmes above €2M",
];

const gaps = [
  "Direct SAP S/4HANA migration ownership",
  "German at professional working level",
  "Manufacturing-sector delivery",
];

function Header() {
  return (
    <>
      <header className="prototype-top">
        <span className="wordmark">JobCrush</span>
        <span className="count">1 of 6 matched today</span>
      </header>
      <section className="job-heading">
        <div>
          <p className="eyebrow">Best match</p>
          <h1>Senior IT Project Manager</h1>
          <p>NordWerk · Berlin · Hybrid</p>
        </div>
        <div className="score" aria-label="78% match">
          78<span>%</span>
        </div>
      </section>
    </>
  );
}

function TailorAction() {
  return (
    <div className="action">
      <button type="button">Tailor this CV</button>
      <p>Uses only evidence you can support. Missing requirements stay visible.</p>
    </div>
  );
}

function VariantA() {
  return (
    <article className="card variant-a">
      <Header />
      <section className="match-summary">
        <p>You already cover 7 of 9 essential requirements.</p>
      </section>
      <section className="gap-spotlight">
        <span>Important gap</span>
        <h2>{gaps[0]}</h2>
        <p>The advert names this as essential. Tailor can foreground adjacent ERP work, but won’t claim S/4HANA ownership.</p>
      </section>
      <details>
        <summary>See the complete match breakdown</summary>
        <h3>Where you fit</h3>
        <ul>{fit.map((item) => <li key={item}>✓ {item}</li>)}</ul>
        <h3>Other open requirements</h3>
        <ul>{gaps.slice(1).map((item) => <li key={item}>? {item}</li>)}</ul>
      </details>
      <TailorAction />
    </article>
  );
}

function VariantB() {
  return (
    <article className="card variant-b">
      <Header />
      <div className="ledger">
        <section>
          <h2>Evidence already in your CV</h2>
          {fit.map((item) => <p className="ledger-row fit" key={item}><span>✓</span>{item}</p>)}
        </section>
        <section>
          <h2>Check before you Tailor</h2>
          {gaps.map((item, index) => (
            <p className={`ledger-row gap ${index === 0 ? "important" : ""}`} key={item}>
              <span>{index === 0 ? "!" : "?"}</span>
              <span><strong>{index === 0 ? "Important · " : ""}</strong>{item}</span>
            </p>
          ))}
        </section>
      </div>
      <aside className="truth-note">
        Tailor will strengthen supported evidence. It will not turn these gaps into claims.
      </aside>
      <TailorAction />
    </article>
  );
}

function VariantC() {
  return (
    <article className="card variant-c">
      <Header />
      <section className="compact-result">
        <div>
          <strong>7 of 9 essentials covered</strong>
          <p>Strong delivery fit with one material technology gap.</p>
        </div>
        <span className="quality">Strong</span>
      </section>
      <section className="review-panel">
        <p className="eyebrow">Why this match?</p>
        <h2>Your experience travels well. The SAP version is the uncertainty.</h2>
        <div className="review-columns">
          <div>
            <h3>Strongest evidence</h3>
            <p>{fit[0]}</p>
            <p>{fit[1]}</p>
          </div>
          <div>
            <h3>Before applying</h3>
            <p className="important-copy">{gaps[0]}</p>
            <button className="quiet" type="button">Review all 3 open points</button>
          </div>
        </div>
      </section>
      <TailorAction />
    </article>
  );
}

export default function GapPrototypePage() {
  const requested = useSearchParams().get("variant")?.toUpperCase();
  const variant = requested === "B" || requested === "C" ? requested : "A";

  return (
    <main className="gap-prototype">
      <p className="prototype-label">Throwaway prototype · downstream gap disclosure</p>
      {variant === "A" && <VariantA />}
      {variant === "B" && <VariantB />}
      {variant === "C" && <VariantC />}
      <PrototypeSwitcher current={variant} />
    </main>
  );
}
