import { type ReactElement } from "react";

import { BuiltFor } from "./built-for";
import { Capabilities } from "./capabilities";
import { Hero } from "./hero";
import { Roles } from "./roles";
import { Scenarios } from "./scenarios";
import { Layout } from "../../components/layout/layout";

/** Landing home page mounted at `/`. Section order follows the design:
 * hero → built-for → roles → scenarios → capabilities, wrapped by the shared
 * header/footer chrome. */
export function HomePage(): ReactElement {
  return (
    <Layout>
      <Hero />
      <BuiltFor />
      <Roles />
      <Scenarios />
      <Capabilities />
    </Layout>
  );
}
