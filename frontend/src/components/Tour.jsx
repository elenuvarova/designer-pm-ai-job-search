import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "scout_tour_done";

const STEPS = [
  {
    target: null,
    title: "Welcome to your Job Scout",
    body: "Your personal radar for Design & Product roles across Europe & the UK — with Belgium and the Netherlands surfaced first. A 4-step tour to get you started.",
  },
  {
    target: "[data-tour='filters']",
    title: "Smart filters",
    body: "Filter by category (Design / Product), discipline, grade, country, language, salary and more. Results update instantly — no submit button needed.",
  },
  {
    target: "[data-tour='lang-badge']",
    title: "The language badge",
    body: "The most important signal. Green = English only. Yellow = a second language is preferred but optional. Red = Dutch/French/German/Luxembourgish is required — a likely blocker.",
  },
  {
    target: "[data-tour='first-card']",
    title: "Job cards",
    body: "Shows discipline, grade, employment type, remote, salary and whether a portfolio is required. Click — or press Enter — to see the full description, detected tools, and language analysis.",
  },
  {
    target: null,
    title: "You're all set",
    body: "Jobs are collected daily. The feed defaults to English-friendly roles with Belgium & the Netherlands first — switch the Language filter to \"Show all\" to include roles needing a local language. Happy hunting.",
  },
];

export default function Tour({ onDone }) {
  const [step, setStep] = useState(0);

  const highlight = useCallback((targetSelector) => {
    // Remove previous highlight
    document.querySelectorAll(".tour-highlighted").forEach((el) =>
      el.classList.remove("tour-highlighted")
    );
    if (!targetSelector) return;

    const el = document.querySelector(targetSelector);
    if (!el) return;

    el.classList.add("tour-highlighted");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  useEffect(() => {
    highlight(STEPS[step].target);
    return () => highlight(null);
  }, [step, highlight]);

  const finish = useCallback(() => {
    highlight(null);
    localStorage.setItem(STORAGE_KEY, "1");
    onDone();
  }, [highlight, onDone]);

  const next = () => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
    else finish();
  };

  const prev = () => setStep((s) => Math.max(0, s - 1));

  const current = STEPS[step];

  return (
    <div className="tour-panel" role="dialog" aria-label="Product tour">
      <div className="tour-dots">
        {STEPS.map((_, i) => (
          <div key={i} className={`tour-dot ${i === step ? "active" : ""}`} />
        ))}
      </div>

      <div className="tour-title">{current.title}</div>
      <div className="tour-body">{current.body}</div>

      <div className="tour-actions">
        <button className="tour-skip" onClick={finish}>
          Skip tour
        </button>
        {step > 0 && (
          <button className="tour-btn" onClick={prev}>
            ← Back
          </button>
        )}
        <button className="tour-btn tour-btn-primary" onClick={next}>
          {step === STEPS.length - 1 ? "Done ✓" : "Next →"}
        </button>
      </div>
    </div>
  );
}

export function shouldShowTour() {
  return !localStorage.getItem(STORAGE_KEY);
}
