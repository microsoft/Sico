import { type ReactElement, type ReactNode } from "react";

import { Footer } from "./footer";
import { Header } from "./header";

export type LayoutProps = {
  children: ReactNode;
};

/** Shared chrome for every landing page (home / blog / docs): header on top,
 * page content in the main landmark, footer at the bottom. Each page supplies
 * its own `children`. */
export function Layout({ children }: LayoutProps): ReactElement {
  return (
    <div className="bg-landing-page-fill text-foreground-primary flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-480 flex-1">{children}</main>
      <Footer />
    </div>
  );
}
