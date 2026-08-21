import { type ReactElement } from "react";

import circleCheck from "../../../../assets/landing-page/circle-check.svg";

const capabilities = [
  {
    description:
      "Digital Workers execute production workflows reliably across web, desktop, mobile, and cloud. Every execution creates the foundation for future evolution.",
    features: [
      "Multi-device",
      "Parallel Tasks",
      "Long-running",
      "Execution Replay",
    ],
    subtitle: "Run real work across devices and long-running operations.",
    title: "Execute at Scale",
  },
  {
    description:
      "Human-reviewed work is transformed into organizational knowledge that continuously improves Digital Workers.",
    features: ["Human Review", "Experience", "Knowledge", "Evolution"],
    subtitle: "Every execution becomes reusable experience.",
    title: "Evolve from Real Work",
  },
  {
    description:
      "Build AI teams with shared projects, memory, and industry solutions. Organizations evolve alongside their Digital Workers.",
    features: [
      "Shared Projects",
      "Organization Context",
      "Solution Library",
      "Human + AI",
    ],
    subtitle: "Humans, Digital Workers, and knowledge in one workspace.",
    title: "Build Your AI Workspace",
  },
] as const;

/** Core SICO capabilities, from execution through organizational evolution. */
export function Capabilities(): ReactElement {
  return (
    <section className="bg-landing-page-fill px-6 py-14 lg:py-20 lg:pr-13.5 lg:pl-22.5">
      <h2 className="sr-only">SICO capabilities</h2>
      <div className="flex flex-col gap-14 lg:gap-22.5">
        {capabilities.map((capability) => (
          <article
            key={capability.title}
            className="grid gap-8 lg:grid-cols-[31.375rem_minmax(0,1fr)] lg:gap-32"
          >
            <div className="max-w-125.5">
              <h3 className="text-foreground-on-inverted text-2xl leading-[1.338] font-medium 2xl:text-3xl">
                {capability.title}
              </h3>
              <p className="text-foreground-on-inverted mt-0.5 text-base leading-[1.338] font-normal 2xl:text-xl">
                {capability.subtitle}
              </p>
              <p className="text-landing-page-description-foreground mt-4 text-base leading-[1.338] font-light 2xl:text-xl">
                {capability.description}
              </p>
              <ul className="mt-8 flex flex-col gap-6 lg:mt-13.5 lg:gap-10.75">
                {capability.features.map((feature) => (
                  <li
                    key={feature}
                    className="text-foreground-on-inverted flex items-center justify-between text-base leading-[1.338] font-light 2xl:text-xl"
                  >
                    <span>{feature}</span>
                    <img
                      src={circleCheck}
                      alt=""
                      className="size-4.25 shrink-0"
                    />
                  </li>
                ))}
              </ul>
            </div>
            <div
              aria-hidden="true"
              className="bg-surface-strong text-foreground-secondary flex min-h-52 items-center justify-center rounded-3xl text-5xl font-medium sm:min-h-64 lg:min-h-0 lg:rounded-4xl lg:text-7xl"
            >
              GIF
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
