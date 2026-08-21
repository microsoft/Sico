import { cn } from "@sico/ui/lib/utils.ts";
import { type ReactElement } from "react";

import bpoImage from "../../../../assets/landing-page/bpo.svg";
import developerImage from "../../../../assets/landing-page/developer.svg";
import enterpriseImage from "../../../../assets/landing-page/enterprise.svg";

const audiences = [
  {
    description:
      "BPO providers looking to build and operate AI-powered workforces for their clients",
    image: bpoImage,
    imageClassName: "size-40 lg:size-54 2xl:size-61.5",
    title: "BPO",
  },
  {
    description:
      "Enterprises seeking to automate and scale operational workflows with AI",
    image: enterpriseImage,
    imageClassName:
      "max-h-32 w-full max-w-40 lg:max-h-38 lg:max-w-50 2xl:max-h-50 2xl:max-w-60.75",
    title: "Enterprises",
  },
  {
    description: "Developers building AI Workers for specific business domains",
    image: developerImage,
    imageClassName: "size-40 lg:size-54 2xl:size-61.5",
    title: "Developers",
  },
] as const;

/** Audiences SICO is built for. */
export function BuiltFor(): ReactElement {
  return (
    <section className="bg-landing-page-fill px-6 py-14 lg:px-24 lg:py-30 2xl:px-41.75">
      <h2 className="text-foreground-on-inverted text-center text-3xl font-medium lg:text-4xl 2xl:text-5xl">
        Who is Sico for
      </h2>
      <div className="mt-10 flex flex-col gap-12 lg:mt-16 lg:flex-row lg:justify-between lg:gap-0">
        {audiences.map((audience) => (
          <article
            key={audience.title}
            className="mx-auto flex w-full max-w-80 min-w-0 flex-col gap-8 lg:mx-0 lg:gap-15"
          >
            <div className="flex h-40 items-center justify-center lg:h-52 2xl:h-72">
              <img
                src={audience.image}
                alt=""
                className={cn(
                  "shrink-0 object-contain",
                  audience.imageClassName,
                )}
              />
            </div>
            <div className="flex flex-col gap-3">
              <div className="text-foreground-on-inverted text-xl font-medium 2xl:text-2xl">
                {audience.title}
              </div>
              <p className="text-landing-page-description-foreground text-base leading-normal 2xl:mt-3 2xl:text-xl">
                {audience.description}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
