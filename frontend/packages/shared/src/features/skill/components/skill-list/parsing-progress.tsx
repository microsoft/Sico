import { type ReactElement, useEffect, useState } from "react";

// Mirrors legacy SkillParsingPlaceholder: an indeterminate progress bar that
// eases toward 90% (it never reaches 100% until polling reports UPLOADED) plus
// an animated trailing ellipsis. Driven in JS so no global keyframes are needed.
export function ParsingProgress({ text }: { text: string }): ReactElement {
  const [progress, setProgress] = useState(0);
  const [dots, setDots] = useState(".");

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => Math.min(90, prev + (100 - prev) * 0.02));
      setDots((prev) => (prev.length >= 3 ? "." : `${prev}.`));
    }, 250);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex h-17 flex-col items-center justify-center pb-6">
      <div className="inline-flex flex-col items-stretch gap-3">
        <span className="text-foreground-emphasis text-center text-base">
          {text} <span className="inline-block w-6 text-left">{dots}</span>
        </span>
        <div className="bg-progress-track-fill h-1 w-full overflow-hidden rounded-full">
          <div
            className="bg-progress-indicator-fill shadow-progress-glow duration-medium-2 ease-persistent h-full rounded-l-full transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
