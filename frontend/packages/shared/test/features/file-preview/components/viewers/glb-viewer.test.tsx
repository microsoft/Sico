import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GlbViewer from "@/features/file-preview/components/viewers/glb-viewer";
import { LazyGlbViewer } from "@/features/file-preview/components/viewers/lazy-glb-viewer";
import { logger } from "@/utils/logger";

// Babylon can't run in jsdom (no WebGL) — mock both packages wholesale so the
// component exercises its state machine without ever touching a GL context.
// `mockViewer` is a minimal stand-in for Babylon's 180-property Viewer (only
// the two methods the component calls are real); referencing the untyped
// `vi.fn()` factory mocks directly — rather than `vi.mocked()` — keeps the
// loose mock signature, so the partial resolves with no cast.
const { createViewer, mockViewer } = vi.hoisted(() => ({
  createViewer: vi.fn(),
  mockViewer: { loadModel: vi.fn(), dispose: vi.fn() },
}));

vi.mock("@babylonjs/viewer", () => ({
  CreateViewerForCanvas: createViewer,
}));
vi.mock("@babylonjs/loaders/dynamic", () => ({
  registerBuiltInLoaders: vi.fn(),
}));

const FILE_URL = "https://blob.test/models/scene.glb";
const ERROR_HEADING = "Preview not supported for this file type.";

// A viewer promise that never settles — pins the component in its loading state
// for the assertion (and avoids a late act() update from a resolve).
function pendingViewer(): Promise<never> {
  return new Promise<never>(() => {});
}

// A promise whose resolution is controlled by the test — lets a viewer "finish
// being created" at a precise moment (e.g. AFTER unmount) to exercise the
// create-after-unmount race.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("GlbViewer", () => {
  beforeEach(() => {
    createViewer.mockReset().mockResolvedValue(mockViewer);
    mockViewer.loadModel.mockReset().mockResolvedValue(undefined);
    mockViewer.dispose.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a spinner while the model is still loading", () => {
    createViewer.mockReturnValue(pendingViewer());
    render(<GlbViewer fileUrl={FILE_URL} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("mounts the canvas the viewer renders into", () => {
    createViewer.mockReturnValue(pendingViewer());
    render(<GlbViewer fileUrl={FILE_URL} />);
    expect(screen.getByTestId("file-glb-canvas")).toBeInTheDocument();
  });

  it("clears the spinner once the model has loaded", async () => {
    render(<GlbViewer fileUrl={FILE_URL} />);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("file-glb-canvas")).toBeInTheDocument();
  });

  it("loads the model from the file url through the abort signal", async () => {
    render(<GlbViewer fileUrl={FILE_URL} />);
    await waitFor(() => expect(mockViewer.loadModel).toHaveBeenCalled());
    expect(mockViewer.loadModel).toHaveBeenCalledWith(
      FILE_URL,
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("renders the error state when the viewer cannot be created", async () => {
    createViewer.mockReset().mockRejectedValue(new Error("no webgl"));
    render(<GlbViewer fileUrl={FILE_URL} />);
    expect(
      await screen.findByRole("heading", { name: ERROR_HEADING }),
    ).toBeInTheDocument();
  });

  it("renders the error state when the model fails to load", async () => {
    mockViewer.loadModel.mockReset().mockRejectedValue(new Error("bad glb"));
    render(<GlbViewer fileUrl={FILE_URL} />);
    expect(
      await screen.findByRole("heading", { name: ERROR_HEADING }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("logs the failure rather than swallowing it", async () => {
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    mockViewer.loadModel.mockReset().mockRejectedValue(new Error("bad glb"));
    render(<GlbViewer fileUrl={FILE_URL} />);
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });

  it("disposes the viewer on unmount (no WebGL context leak)", async () => {
    const { unmount } = render(<GlbViewer fileUrl={FILE_URL} />);
    await waitFor(() => expect(mockViewer.loadModel).toHaveBeenCalled());
    unmount();
    expect(mockViewer.dispose).toHaveBeenCalledTimes(1);
  });

  it("re-shows the spinner the moment the url changes after a load (C3)", async () => {
    // Render-phase reset parity with VideoViewer/PdfViewer: a fileUrl swap must
    // show the new model's spinner in the SAME render, not one stale frame of the
    // prior loaded canvas. A never-settling create on the second url keeps it
    // pending so the spinner must be present.
    const { rerender } = render(<GlbViewer fileUrl={FILE_URL} />);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );

    createViewer.mockReturnValue(pendingViewer());
    rerender(<GlbViewer fileUrl="https://blob.test/models/other.glb" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("disposes a viewer that finishes being created after unmount (C4)", async () => {
    // The create-after-unmount race: CreateViewerForCanvas resolves only AFTER
    // the component is gone. The cleanup already ran (viewerRef was still null),
    // so the self-dispose path inside the async body must drop the just-built
    // context — else the WebGL context leaks.
    const gate = deferred<typeof mockViewer>();
    createViewer.mockReturnValue(gate.promise);

    const { unmount } = render(<GlbViewer fileUrl={FILE_URL} />);
    unmount();

    // Now the viewer finishes being created, post-unmount.
    await act(async () => {
      gate.resolve(mockViewer);
    });
    expect(mockViewer.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("LazyGlbViewer", () => {
  beforeEach(() => {
    createViewer.mockReset().mockResolvedValue(mockViewer);
    mockViewer.loadModel.mockReset().mockResolvedValue(undefined);
    mockViewer.dispose.mockReset();
  });

  it("resolves the dynamic import and renders the viewer", async () => {
    render(<LazyGlbViewer fileUrl={FILE_URL} />);
    expect(await screen.findByTestId("file-glb-canvas")).toBeInTheDocument();
  });
});
