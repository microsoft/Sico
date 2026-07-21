import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Timestamp } from "@/features/chat/components/message/timestamp";

// formatDateTime reads the system clock for its day-tier, so pin "now" to a
// local-time noon (same approach as format-date-time.test). 09:30 today then
// formats to the bare "09:30" the frame shows.
const NOW = new Date("2024-06-15T12:00:00");
const TODAY_0930 = new Date("2024-06-15T09:30:00").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Timestamp", () => {
  it("renders the latest part's time, formatted (today -> HH:mm)", () => {
    render(<Timestamp createdAt={TODAY_0930} />);
    expect(screen.getByText("09:30")).toBeInTheDocument();
  });

  it("renders a semantic <time> with a machine-readable dateTime", () => {
    render(<Timestamp createdAt={TODAY_0930} />);
    const el = screen.getByText("09:30");
    expect(el.tagName).toBe("TIME");
    expect(el).toHaveAttribute("dateTime", new Date(TODAY_0930).toISOString());
  });

  it("renders nothing when there is no timestamp (no renderable part)", () => {
    const { container } = render(<Timestamp />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the turn is still receiving (streaming)", () => {
    render(<Timestamp createdAt={TODAY_0930} streaming />);
    expect(screen.queryByText("09:30")).not.toBeInTheDocument();
  });

  it("renders nothing while the turn's plan is RUNNING", () => {
    render(<Timestamp createdAt={TODAY_0930} planRunning />);
    expect(screen.queryByText("09:30")).not.toBeInTheDocument();
  });
});
