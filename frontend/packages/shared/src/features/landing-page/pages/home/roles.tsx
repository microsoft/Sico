import {
  type ReactElement,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { RoleDecoration } from "./role-decoration";
import { RoleListItem } from "./role-list-item";

// Matches the header's rendered height (h-16.5 = 66px) and the sticky offset in
// globals.css (.landing-page-roles-viewport { top: 4.125rem } = 66px); the
// scroll math below measures the section relative to that fixed header.
const HEADER_HEIGHT = 66;
const roles = [
  { title: "Employer", description: "Assigns business goals." },
  { title: "Operator", description: "Supervises and evolves Digital Workers." },
  { title: "Developer", description: "Builds reusable capabilities." },
  {
    title: "Digital Worker",
    description:
      "Executes operational work. Learns from production experience.",
  },
] as const;

/** Tracks which role is active based on the section's scroll progress. */
function useActiveRoleIndex(): {
  sectionRef: RefObject<HTMLElement | null>;
  activeIndex: number;
} {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let frameId: number | null = null;
    const sync = (): void => {
      frameId = null;
      const section = sectionRef.current;
      if (!section) {
        return;
      }
      const stickyHeight = window.innerHeight - HEADER_HEIGHT;
      const distance = Math.max(section.offsetHeight - stickyHeight, 1);
      const progress = Math.min(
        Math.max(HEADER_HEIGHT - section.getBoundingClientRect().top, 0),
        distance,
      );
      setActiveIndex(
        Math.min(
          Math.floor((progress / distance) * roles.length),
          roles.length - 1,
        ),
      );
    };
    const schedule = (): void => {
      frameId ??= requestAnimationFrame(sync);
    };
    sync();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return (): void => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, []);

  return { sectionRef, activeIndex };
}

/** Four roles in the SICO operating model. */
export function Roles(): ReactElement {
  const { sectionRef, activeIndex } = useActiveRoleIndex();

  return (
    <section
      ref={sectionRef}
      className="landing-page-roles bg-landing-page-fill relative"
    >
      <div className="landing-page-roles-viewport bg-landing-page-fill overflow-hidden">
        <div className="flex w-full flex-col px-6 py-14 lg:grid lg:size-full lg:grid-cols-2 lg:items-center lg:py-10 lg:pr-13.5 lg:pl-22.5">
          <ol className="lg:text-landing-page-role-title-compact 2xl:text-landing-page-role-title relative z-10 flex flex-col gap-6 text-3xl sm:text-4xl lg:place-self-start lg:pt-2.5">
            {roles.map(({ title, description }, index) => (
              <RoleListItem
                key={title}
                title={title}
                description={description}
                active={index === activeIndex}
              />
            ))}
          </ol>
          <RoleDecoration activeIndex={activeIndex} roleCount={roles.length} />
        </div>
      </div>
    </section>
  );
}
