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

export default function MomentCard({ moment, onInteract, onVoice, disabled }: Props) {
  const c = moment.candidate;
  const id = c.id;
  const spec = c.component;
  const isOpen = moment.status === "open";
  const isVoice = moment.decision.channel === "voice";

  const [pending, setPending] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [slider, setSlider] = useState<number>(spec.type === "slider" ? spec.value : 0);
  const [playing, setPlaying] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const speakingRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // keep slider default in sync if the server re-renders the spec
  const specValue = spec.type === "slider" ? spec.value : null;
  useEffect(() => {
    if (specValue !== null) setSlider(specValue);
  }, [specValue]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

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
    setMenuOpen(false);
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
            <div className="mc-slider-head">
              <span>{spec.label}</span>
              <strong>
                {spec.unit === "€" || spec.unit === "EUR" ? `€ ${slider}` : `${slider} ${spec.unit}`}
              </strong>
            </div>
            <input
              type="range"
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

  return (
    <article className={cx("mc", !isOpen && "mc-resolved", isVoice && "mc-voice")}>
      <header className="mc-head">
        <span className={cx("mc-tag", c.commercial ? "mc-tag-offer" : "mc-tag-tip")}>{c.commercial ? "Offer" : "Tip"}</span>
        {c.customerRequested && <span className="mc-tag mc-tag-rule">Your rule</span>}
        <span className="mc-date">{fmtDay(c.day)}</span>
        <div className="mc-menu" ref={menuRef}>
          <button
            type="button"
            className="mc-menu-btn"
            aria-label="More options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="mc-menu-pop" role="menu">
              <button type="button" role="menuitem" disabled={locked} onClick={() => act({ type: "mute", nodeId: c.nodeId })}>
                Don&apos;t show me these
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowWhy(true);
                  setMenuOpen(false);
                }}
              >
                Why am I seeing this?
              </button>
            </div>
          )}
        </div>
      </header>

      {isVoice && (
        <div className="mc-voicebar">
          <button
            type="button"
            className={cx("mc-play", playing && "is-playing")}
            onClick={play}
            disabled={loadingAudio}
            aria-label={playing ? "Stop voice message" : "Play voice message"}
          >
            {loadingAudio ? <span className="spinner spinner-light" style={{ width: 14, height: 14 }} /> : playing ? "❚❚" : "▶"}
          </button>
          <div className="mc-voice-meta">
            <span className="mc-voice-title">Voice message from KBC</span>
            <span className={cx("mc-wave", playing && "is-playing")} aria-hidden>
              {Array.from({ length: 22 }, (_, i) => (
                <i key={i} style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${(i % 7) * 0.09}s` }} />
              ))}
            </span>
          </div>
        </div>
      )}

      <h3 className="mc-title">{c.title}</h3>
      <p className={cx("mc-body", isVoice && "mc-transcript")}>{c.body}</p>

      {isOpen ? actions : <div className={cx("mc-resolved-label", `mc-st-${moment.status}`)}>{resolvedText(moment)}</div>}

      <footer className="mc-foot">
        <button type="button" className="mc-link" onClick={() => setShowWhy((s) => !s)} aria-expanded={showWhy}>
          {showWhy ? "Hide why" : "Why am I seeing this?"}
        </button>
        {isOpen && (
          <button type="button" className="mc-link mc-link-muted" disabled={locked} onClick={() => act({ type: "mute", nodeId: c.nodeId })}>
            Don&apos;t show me these
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
    </article>
  );
}
