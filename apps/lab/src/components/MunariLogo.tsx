import { useEffect, useRef, useState } from "react";
import {
  WORDMARK_DEFAULTS,
  type WordmarkOptions,
} from "./wordmark/wordmarkAnimation";
import type { WordmarkScene } from "./wordmark/wordmarkScene";
import "./munariLogo.css";

interface MunariLogoProps {
  className?: string;
  options?: WordmarkOptions;
}

export function MunariLogo({
  className,
  options = WORDMARK_DEFAULTS,
}: MunariLogoProps) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<WordmarkScene | null>(null);
  const currentOptions = useRef(options);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    currentOptions.current = options;
    scene.current?.setOptions(options);
  }, [options]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    void import("./wordmark/wordmarkScene")
      .then(({ mountWordmark }) => {
        if (cancelled) return;
        scene.current = mountWordmark(
          element,
          currentOptions.current,
          (next) => {
            if (!cancelled) setReady(next);
          },
        );
      })
      .catch((error) => {
        if (!cancelled)
          console.warn("[munari logo] Showing the static wordmark.", error);
      });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  return (
    <div
      ref={host}
      className={className ? `munari-logo ${className}` : "munari-logo"}
      data-ready={ready || undefined}
      role="img"
      aria-label="Munari"
    >
      <img
        className="munari-logo__fallback"
        src="/munari-wordmark.svg"
        alt=""
        draggable={false}
      />
    </div>
  );
}
