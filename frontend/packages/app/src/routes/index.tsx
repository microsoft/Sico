import { HomePage } from "@sico/shared/features/landing-page/index.ts";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "SICO" }] }),
  component: HomePage,
});
