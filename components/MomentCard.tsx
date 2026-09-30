"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { InteractBody, Moment } from "@/lib/types";
import { cx, fmtDay } from "./ui";

interface Props {
  moment: Moment;
  onInteract(body: InteractBody): Promise<void>;
  onVoice(momentId: string): Promise<Blob | null>;
  disabled?: boolean;
}

function resolvedText(m: Moment): string {
  switch (m.status) {
    case "answered":
    case "engaged":
      return `✓ ${m.answerLabel ?? "Done"}`;
    case "dismissed":
      return "Dismissed";
    case "ignored":
      return "No response";
    case "queued":
      return "Passed to your advisor";
    case "silenced":
      return "Not shown";
    default:
      return "";
  }
}

const KIND_LABEL: Record<Moment["candidate"]["component"]["type"], string> = {
  info: "Info",
  confirm: "Confirm",
  choice: "Question",
  slider: "Set amount",
};

/** Aura tone: coral for helpful/urgent, teal for informational, grey once dismissed or silenced. */
function auraTone(m: Moment): "hot" | "cool" | "still" {
  if (["dismissed", "ignored", "silenced"].includes(m.status)) return "still";
  if (m.status !== "open") return "cool";
  if (m.candidate.component.type === "info" || m.candidate.urgency < 0.5) return "cool";
  return "hot";
}

export default function MomentCard({ moment, onInteract, onVoice, disabled }: Props) {
  const c = moment.candidate;
  const id = c.id;
  const spec = c.component;
  const isOpen = moment.status === "open";
  const isVoice = moment.decision.channel === "voice";

  const [pending, setPending] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [slider, setSlider] = useState<number>(spec.type === "slider" ? spec.value : 0);
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const speakingRef = useRef(false);

  // keep slider default in sync if the server re-renders the spec
  const specValue = spec.type === "slider" ? spec.value : null;
  useEffect(() => {
    if (specValue !== null) setSlider(specValue);
  }, [specValue]);

  useEffect(() => () => stopAudio(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (speakingRef.current && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      speakingRef.current = false;
    }
    setPlaying(false);
  }

  async function play() {
    if (playing) {
      stopAudio();
      return;
    }
    setLoadingAudio(true);
    try {
      const blob = await onVoice(id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => stopAudio();
        audio.onerror = () => stopAudio();
        setPlaying(true);
        await audio.play();
      } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(`${c.title}. ${c.body}`);
        u.lang = "en-GB";
        u.rate = 0.95;
        u.onend = () => {
          speakingRef.current = false;
          setPlaying(false);
        };
        u.onerror = () => {
          speakingRef.current = false;
          setPlaying(false);
        };
        speakingRef.current = true;
        setPlaying(true);
        window.speechSynthesis.speak(u);
      }
    } catch {
      stopAudio();
    } finally {
      setLoadingAudio(false);
    }
  }

  async function act(body: InteractBody) {
    if (pending || disabled) return;
    setPending(true);
    try {
      await onInteract(body);
    } finally {
      setPending(false);
    }
  }

  const locked = pending || !!disabled;

  let actions: ReactNode = null;
  if (isOpen) {
    switch (spec.type) {
      case "info":
        actions = (
          <div className="mc-actions">
            <button type="button" className="p-btn p-btn-primary" disabled={locked} onClick={() => act({ type: "engage", momentId: id })}>
              {spec.ackLabel}
            </button>
            <button type="button" className="p-btn p-btn-ghost" disabled={locked} onClick={() => act({ type: "dismiss", momentId: id })}>
              {spec.dismissLabel}
            </button>
          </div>
        );
        break;
      case "confirm":
        actions = (
          <div className="mc-actions">
            <button
              type="button"
              className="p-btn p-btn-primary"
              disabled={locked}
              onClick={() => act({ type: "answer", momentId: id, optionId: "confirm" })}
            >
              {spec.confirmLabel}
            </button>
            <button type="button" className="p-btn p-btn-ghost" disabled={locked} onClick={() => act({ type: "dismiss", momentId: id })}>
              {spec.declineLabel}
            </button>
          </div>
        );
        break;
      case "choice":
        actions = (
          <div className="mc-choices">
            {spec.options.map((o) => (
              <button
                key={o.id}
                type="button"
                className="p-btn p-btn-choice"
                disabled={locked}
                onClick={() => act({ type: "answer", momentId: id, optionId: o.id })}
              >
                {o.label}
              </button>
            ))}
          </div>
        );
        break;
      case "slider":
        actions = (
          <div className="mc-slider">
            <div className="mc-slider-head">{spec.label}</div>
            <div className="mc-slider-amt">
              {spec.unit === "€" || spec.unit === "EUR" ? `€${slider.toLocaleString("en-GB")}` : `${slider} ${spec.unit}`}
            </div>
            <input
              type="range"
              style={{ ["--fill" as string]: `${((slider - spec.min) / Math.max(1, spec.max - spec.min)) * 100}%` }}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={slider}
              disabled={locked}
              onChange={(e) => setSlider(Number(e.target.value))}
              aria-label={spec.label}
            />
            <div className="mc-slider-scale">
              <span>{spec.min}</span>
              <span>{spec.max}</span>
            </div>
            <button
              type="button"
              className="p-btn p-btn-primary p-btn-block"
              disabled={locked}
              onClick={() => act({ type: "answer", momentId: id, value: slider })}
            >
              {spec.submitLabel}
            </button>
          </div>
        );
        break;
    }
  }

  const tone = auraTone(moment);
  const auraSize = Math.round(200 + 90 * Math.min(1, c.urgency));
  const conf = Math.round(c.confidence * 100);
  const kind = isVoice ? "Voice" : KIND_LABEL[spec.type];

  return (
    <article className={cx("mc", `mc-${tone}`, !isOpen && "mc-resolved", isVoice && "mc-voice")}>
      <span className="mc-aura" style={{ width: auraSize, height: auraSize }} aria-hidden />
      <span className="mc-grain" aria-hidden />
      <header className="mc-head">
        <span className="mc-pill">
          {kind} · {c.nodeName}
        </span>
        {c.commercial && <span className="mc-pill mc-pill-offer">Offer</span>}
        {c.customerRequested && <span className="mc-pill mc-pill-rule">Your rule</span>}
        <span className="mc-pill mc-pill-muted">{isOpen ? `Conf ${conf}%` : fmtDay(c.day)}</span>
      </header>

      <div className="mc-glass">
        {isVoice && (
          <div className="mc-voicebar">
            <span className={cx("mc-wave", playing && "is-playing")} aria-hidden>
              {Array.from({ length: 22 }, (_, i) => (
                <i key={i} style={{ height: `${18 + ((i * 37) % 82)}%`, animationDelay: `${(i % 7) * 0.09}s` }} />
              ))}
            </span>
            <div className="mc-voice-row">
              <button
                type="button"
                className={cx("mc-play", playing && "is-playing")}
                onClick={play}
                disabled={loadingAudio}
                aria-label={playing ? "Stop voice message" : "Play voice message"}
              >
                {loadingAudio ? <span className="spinner spinner-light" style={{ width: 14, height: 14 }} /> : playing ? "❚❚" : "▶"}
              </button>
              <span className="mc-voice-title">
                {playing ? "Playing…" : "Voice message from KBC."}
                <br />
                Tap to listen.
              </span>
            </div>
          </div>
        )}

        <h3 className="mc-title">{c.title}</h3>
        <p className={cx("mc-body", isVoice && "mc-transcript")}>{c.body}</p>

        {isOpen ? actions : <div className={cx("mc-resolved-label", `mc-st-${moment.status}`)}>{resolvedText(moment)}</div>}

        <footer className="mc-foot">
          <button type="button" className="mc-link" onClick={() => setShowWhy((s) => !s)} aria-expanded={showWhy}>
            {showWhy ? "Hide why" : "Why this?"}
          </button>
          {isOpen && (
            <button type="button" className="mc-link" disabled={locked} onClick={() => act({ type: "mute", nodeId: c.nodeId })}>
              Mute
            </button>
          )}
        </footer>
        {showWhy && (
          <ol className="mc-why">
            {c.why.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ol>
        )}
      </div>
    </article>
  );
}
