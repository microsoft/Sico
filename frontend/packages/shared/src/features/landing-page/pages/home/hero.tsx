import { type ReactElement } from "react";

import heroPoster from "../../../../assets/landing-page/hero-poster.webp";
import heroVideo from "../../../../assets/landing-page/hero.mp4";
import { GithubCtaButton } from "../../components/github-cta-button";

/** Hero section — the landing page's primary heading, tagline, and GitHub CTA. */
export function Hero(): ReactElement {
  return (
    <section className="bg-landing-page-fill relative isolate flex h-svh max-h-270 min-h-150 items-center justify-center overflow-hidden py-20 lg:py-24">
      <video
        aria-hidden="true"
        autoPlay
        loop
        muted
        playsInline
        poster={heroPoster}
        className="absolute inset-0 top-8 size-full object-cover object-[65%_center] lg:object-center"
        src={heroVideo}
      />
      <div className="absolute right-6 bottom-20 left-6 z-10 flex flex-col items-start lg:top-[48.24%] lg:right-auto lg:bottom-auto lg:left-26">
        <h1 className="lg:text-landing-page-hero-title-compact 2xl:text-landing-page-hero-title text-foreground-on-inverted flex h-16 items-center text-5xl font-normal lg:h-22 2xl:h-33.5">
          SICO
        </h1>
        <p className="lg:text-landing-page-hero-tagline-compact 2xl:text-landing-page-hero-tagline text-foreground-on-inverted max-w-sm text-xl leading-tight font-normal sm:text-2xl lg:flex lg:h-14 lg:max-w-none lg:items-center lg:whitespace-nowrap 2xl:h-20">
          Symbiotic Intelligence for Co-evolution
        </p>
        <GithubCtaButton label="Github" className="mt-8 h-auto px-4 lg:mt-11" />
      </div>
      <div
        aria-hidden="true"
        className="bg-gradient-landing-page-hero-fade pointer-events-none absolute inset-x-0 bottom-0 z-5 h-20"
      />
    </section>
  );
}
