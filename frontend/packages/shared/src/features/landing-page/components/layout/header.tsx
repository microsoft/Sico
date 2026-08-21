import { Button } from "@sico/ui";
import { ArrowRight } from "lucide-react";
import { type ReactElement } from "react";

import sicoLandingPageLogo from "../../../../assets/landing-page/sico-landing-page-logo.svg";

/** Shared landing header: logo, nav links, and partner CTA. */
export function Header(): ReactElement {
  return (
    <header className="bg-landing-page-header-fill fixed inset-x-0 top-0 z-50 flex h-16.5 items-center justify-between px-4 backdrop-blur-[25px] lg:pr-17 lg:pl-17.75">
      <img src={sicoLandingPageLogo} alt="SICO" className="w-20 sm:w-auto" />
      <div className="flex items-center gap-4 lg:gap-22.5">
        <div className="text-foreground-on-inverted hidden w-42.5 items-center justify-between text-base sm:flex">
          <span>Blog</span>
          <span>Docs</span>
        </div>
        <Button
          type="button"
          className="bg-landing-page-partner-fill text-landing-page-partner-foreground hover:bg-landing-page-partner-fill active:bg-landing-page-partner-fill h-7.5 gap-1 rounded-full pr-2 pl-2.5 text-sm font-normal shadow-none sm:gap-1.25 sm:pr-2.5 sm:pl-3 sm:text-base"
        >
          <span>Become a Partner</span>
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </header>
  );
}
