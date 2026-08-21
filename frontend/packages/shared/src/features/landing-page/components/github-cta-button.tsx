import { Button } from "@sico/ui";
import { type ReactElement } from "react";

import githubLogo from "../../../assets/landing-page/github-logo.svg";
import rightArrow from "../../../assets/landing-page/right-arrow.svg";

export type GithubCtaButtonProps = {
  /** Visible button label (e.g. "Github", "Try it now"). */
  label: string;
  /** Layout overrides (sizing / padding / margin) applied on top of the shared visual style. */
  className?: string;
};

/** GitHub CTA — the GitHub logo + label + arrow pill shared by the hero and footer. */
export function GithubCtaButton({
  label,
  className,
}: GithubCtaButtonProps): ReactElement {
  return (
    <Button
      render={
        // Base UI merges Button's children (logo, label, arrow) into this
        // anchor, so its accessible content is provided there, not inline.
        // eslint-disable-next-line jsx-a11y/anchor-has-content
        <a
          href="https://github.com/microsoft/Sico"
          target="_blank"
          rel="noopener noreferrer"
        />
      }
      className={`bg-landing-page-github-fill text-landing-page-github-foreground hover:bg-landing-page-github-fill active:bg-landing-page-github-fill text-landing-page-github gap-3 rounded-full py-3 font-normal shadow-none ${className ?? ""}`}
    >
      <img src={githubLogo} alt="" className="size-7.5" />
      <span>{label}</span>
      <img src={rightArrow} alt="" className="h-2 w-4.25" />
    </Button>
  );
}
