import { type ReactElement } from "react";

import businessImage from "../../../../assets/landing-page/business.png";
import marketingImage from "../../../../assets/landing-page/marketing.png";
import researchImage from "../../../../assets/landing-page/research.png";
import salesImage from "../../../../assets/landing-page/sales.png";
import testingImage from "../../../../assets/landing-page/testing.png";

const scenarios = [
  { titleLines: ["Software", "Testing"], image: testingImage },
  { titleLines: ["Research &", "Innovation"], image: researchImage },
  { titleLines: ["Global", "Marketing"], image: marketingImage },
  { titleLines: ["Business", "Operations"], image: businessImage },
  { titleLines: ["Sales", "Operations"], image: salesImage },
] as const;

/** Interactive SICO work scenarios — hover (or focus) expands a card via pure CSS. */
export function Scenarios(): ReactElement {
  return (
    <section className="bg-landing-page-fill overflow-hidden py-14 lg:px-0 lg:py-20">
      <h2 className="sr-only">SICO scenarios</h2>
      <div className="landing-page-scenarios flex snap-x snap-mandatory items-start gap-4 overflow-x-auto px-6 pb-2 lg:h-139.5 lg:snap-none lg:items-stretch lg:gap-6.5 lg:overflow-hidden lg:pr-13.5 lg:pb-0 lg:pl-22.5 2xl:h-174.5">
        {scenarios.map(({ titleLines, image }) => (
          <div
            key={titleLines.join(" ")}
            // Focusable for keyboard expand-on-focus parity with hover; it's a
            // showcase card, not an interactive control.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            role="group"
            aria-label={titleLines.join(" ")}
            className="landing-page-scenario relative aspect-1704/1396 w-[calc(100vw-48px)] shrink-0 snap-center overflow-hidden rounded-3xl lg:aspect-auto lg:h-full lg:w-auto lg:snap-align-none lg:rounded-4xl"
          >
            <img
              src={image}
              alt=""
              className="landing-page-scenario-image absolute inset-0 size-full object-contain lg:object-cover lg:object-left"
            />
            <span className="landing-page-scenario-title text-landing-page-scenario-foreground absolute right-3 bottom-10 left-3 z-2 hidden text-left text-lg leading-snug font-medium lg:block 2xl:text-3xl">
              <span className="block">{titleLines[0]}</span>
              <span className="block">{titleLines[1]}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
