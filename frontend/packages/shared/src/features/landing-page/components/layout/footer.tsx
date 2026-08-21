import { type ReactElement } from "react";

import footerBackground from "../../../../assets/landing-page/footer-bg.svg";
import { GithubCtaButton } from "../github-cta-button";

/** Shared landing footer with the "Start Building" CTA. */
export function Footer(): ReactElement {
  return (
    <footer className="landing-page-footer relative flex shrink-0 flex-col items-center justify-center overflow-x-clip px-6 py-28 lg:h-200 lg:overflow-hidden lg:px-0 lg:py-0">
      <img
        src={footerBackground}
        alt=""
        className="pointer-events-none absolute top-1/2 left-1/2 aspect-square w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 object-contain lg:max-w-5xl lg:translate-y-[calc((50%+100px)*-1)]"
      />
      <div className="relative z-10 flex w-full flex-col items-center gap-10 lg:absolute lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:gap-15">
        <p className="text-foreground-on-inverted max-w-sm text-center text-3xl leading-tight font-medium sm:text-4xl lg:max-w-none lg:whitespace-nowrap 2xl:text-5xl">
          Start Building Your Digital Workforce
        </p>
        <GithubCtaButton
          label="Try it now"
          className="h-13.5 w-auto pr-5 pl-3"
        />
      </div>
    </footer>
  );
}
