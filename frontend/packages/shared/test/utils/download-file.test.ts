import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { downloadFile } from "@/utils/download-file";
import { logger } from "@/utils/logger";

const FILE_URL = "https://blob.test/files/report.pdf";
const FILENAME = "report.pdf";
const FAKE_BLOB_URL = "blob:download-file-test";

// A minimal HEAD-like Response whose inspected surface is `ok` + `content-length`.
function headResponse(contentLength: string | null): Response {
  return {
    ok: true,
    headers: new Headers(
      contentLength ? { "content-length": contentLength } : {},
    ),
  } as Response;
}

// A non-ok HEAD (e.g. expired SAS 403) that still carries a small content-length —
// the error body would pass the size gate and be saved AS the file without an
// `ok` check.
function errorHeadResponse(contentLength: string): Response {
  return {
    ok: false,
    headers: new Headers({ "content-length": contentLength }),
  } as Response;
}

function blobResponse(): Response {
  return {
    ok: true,
    blob: () => Promise.resolve(new Blob(["data"])),
  } as Response;
}

describe("downloadFile", () => {
  let fetchMock: Mock;
  let createObjectURL: Mock;
  let revokeObjectURL: Mock;
  let openSpy: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    createObjectURL = vi.fn(() => FAKE_BLOB_URL);
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    // Stop jsdom from acting on the programmatic <a download> click.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("HEADs the file first to size it", async () => {
    fetchMock
      .mockResolvedValueOnce(headResponse("1024"))
      .mockResolvedValueOnce(blobResponse());
    await downloadFile(FILE_URL, FILENAME);
    expect(fetchMock).toHaveBeenCalledWith(FILE_URL, { method: "HEAD" });
  });

  it("saves a blob when the file is at or below 50MB", async () => {
    fetchMock
      .mockResolvedValueOnce(headResponse("1024"))
      .mockResolvedValueOnce(blobResponse());
    await downloadFile(FILE_URL, FILENAME);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("revokes the blob url it created in the same flow (no leak)", async () => {
    fetchMock
      .mockResolvedValueOnce(headResponse("1024"))
      .mockResolvedValueOnce(blobResponse());
    await downloadFile(FILE_URL, FILENAME);
    expect(revokeObjectURL).toHaveBeenCalledWith(FAKE_BLOB_URL);
  });

  it("connects the anchor to the DOM before clicking (download isn't a no-op)", async () => {
    // A disconnected anchor's programmatic click is a no-op in some browsers, so
    // the anchor MUST be in document at click time. Capture `isConnected` from
    // inside the click — reverting the body.append/remove would flip this false.
    let connectedAtClick: boolean | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function captureConnected(this: HTMLAnchorElement) {
        connectedAtClick = this.isConnected;
      },
    );
    fetchMock
      .mockResolvedValueOnce(headResponse("1024"))
      .mockResolvedValueOnce(blobResponse());
    await downloadFile(FILE_URL, FILENAME);
    expect(connectedAtClick).toBe(true);
  });

  it("opens in a new tab when the file is larger than 50MB", async () => {
    fetchMock.mockResolvedValueOnce(headResponse(String(51 * 1024 * 1024)));
    await downloadFile(FILE_URL, FILENAME);
    expect(openSpy).toHaveBeenCalledWith(
      FILE_URL,
      "_blank",
      "noopener,noreferrer",
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("opens in a new tab when the HEAD response carries no content-length", async () => {
    fetchMock.mockResolvedValueOnce(headResponse(null));
    await downloadFile(FILE_URL, FILENAME);
    expect(openSpy).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("opens in a new tab when content-length is non-numeric (NaN guard, C6)", async () => {
    // A garbage content-length → Number("abc") is NaN; without Number.isFinite,
    // NaN slips past the size check (NaN > MAX is false) into the blob path. The
    // blob fetch is mocked too, so a slip would call createObjectURL — the
    // assertion below would then catch it rather than masking via the error path.
    fetchMock
      .mockResolvedValueOnce(headResponse("not-a-number"))
      .mockResolvedValueOnce(blobResponse());
    await downloadFile(FILE_URL, FILENAME);
    expect(openSpy).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("opens in a new tab when the HEAD is non-ok (expired SAS), never saving the error body", async () => {
    // A 403 HEAD still RESOLVES with a small XML error body carrying a
    // content-length that passes the size gate. Without the `ok` check the error
    // body would be fetched and saved AS report.pdf. It must open in a new tab
    // (where the user sees the real error / can re-auth) and save nothing.
    fetchMock.mockResolvedValueOnce(errorHeadResponse("512"));
    await downloadFile(FILE_URL, FILENAME);
    expect(openSpy).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
    // The blob GET must never be issued — only the HEAD was.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to a new tab when the fetch rejects", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await downloadFile(FILE_URL, FILENAME);
    expect(openSpy).toHaveBeenCalledOnce();
  });

  it("logs the failure rather than swallowing it", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await downloadFile(FILE_URL, FILENAME);
    expect(warn).toHaveBeenCalled();
  });

  it("blocks an unsafe url scheme before any fetch or tab open (S-sec)", async () => {
    // An agent-authored `javascript:` url must never reach fetch/window.open —
    // it's scheme-gated through safeIconUri first (same gate as every sibling
    // navigation). The whole download is dropped, logged, not swallowed.
    // Join the parts so the literal never trips eslint's `no-script-url`
    // (mirrors webpage-url.test.ts) — rejecting that scheme is the point.
    const scriptSchemeUrl = ["javascript", "alert(document.cookie)"].join(":");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    await downloadFile(scriptSchemeUrl, FILENAME);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
