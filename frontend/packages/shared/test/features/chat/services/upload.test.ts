/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  uploadAttachment,
  uploadProjectAssetDirect,
} from "@/features/chat/services/upload";

function makeClient(): {
  client: ReturnType<typeof axios.create>;
  mock: MockAdapter;
} {
  const client = axios.create({ baseURL: "/api/sico" });
  const mock = new MockAdapter(client);
  return { client, mock };
}

const FILE = new File(["data"], "report.pdf", { type: "application/pdf" });

describe("uploadAttachment", () => {
  let mock: MockAdapter | undefined;
  afterEach(() => mock?.restore());

  it("returns an asset ref on a successful upload", async () => {
    const m = makeClient();
    mock = m.mock;
    m.mock.onPost("/project/asset").reply(200, {
      code: 0,
      msg: "ok",
      data: {
        id: 9,
        metaInfo: {
          contentType: "application/pdf",
          fileExt: "pdf",
          fileName: "report.pdf",
          fileSize: 4,
          fileType: "pdf",
        },
        sasUrl: "https://blob/sas",
        uri: "asset://9",
      },
    });
    const ref = await uploadAttachment(
      m.client,
      FILE,
      new AbortController().signal,
    );
    expect(ref).toEqual({
      name: "report.pdf",
      size: 4,
      type: "pdf",
      uri: "asset://9",
      sasUrl: "https://blob/sas",
    });
    // The backend envelope carries `id`, but the send payload drops it
    // (legacy never sends it; the asset is resolved by uri).
    expect(ref).not.toHaveProperty("id");
  });

  it("throws when the envelope code is non-zero", async () => {
    const m = makeClient();
    mock = m.mock;
    // `data` omitted (not null): the envelope parses, so the function's own
    // `code !== HTTP_OK` branch runs — not an incidental schema-parse failure.
    m.mock.onPost("/project/asset").reply(200, { code: 500, msg: "nope" });
    expect.assertions(2);
    try {
      await uploadAttachment(m.client, FILE, new AbortController().signal);
    } catch (err) {
      expect(err).toBeInstanceOf(z.ZodError);
      if (err instanceof z.ZodError) {
        expect(err.issues[0]?.message).toContain("code 500");
      }
    }
  });

  it("posts multipart form data with the file field", async () => {
    const m = makeClient();
    mock = m.mock;
    let posted: unknown;
    m.mock.onPost("/project/asset").reply((config) => {
      posted = config.data;
      return [
        200,
        {
          code: 0,
          msg: "ok",
          data: {
            id: 1,
            metaInfo: {
              contentType: "application/pdf",
              fileExt: "pdf",
              fileName: "report.pdf",
              fileSize: 4,
              fileType: "pdf",
            },
            sasUrl: "s",
            uri: "u",
          },
        },
      ];
    });
    await uploadAttachment(m.client, FILE, new AbortController().signal);
    expect(posted).toBeInstanceOf(FormData);
  });
});

const APK = new File(["apk-bytes"], "app.apk", {
  type: "application/vnd.android.package-archive",
});

// The completed-asset envelope (step 3 reuses `uploadEnvelopeSchema`).
function completeEnvelope(sasUrl: string): unknown {
  return {
    code: 0,
    msg: "ok",
    data: {
      id: 7,
      metaInfo: {
        contentType: "application/vnd.android.package-archive",
        fileExt: "apk",
        fileName: "app.apk",
        fileSize: APK.size,
        fileType: "apk",
      },
      sasUrl,
      uri: "asset://7",
    },
  };
}

describe("uploadProjectAssetDirect", () => {
  let mock: MockAdapter | undefined;
  afterEach(() => {
    mock?.restore();
    vi.unstubAllGlobals();
  });

  it("mints a url, PUTs the bytes to blob storage, then completes and returns the sasUrl", async () => {
    const m = makeClient();
    mock = m.mock;
    let createBody: unknown;
    let completeBody: unknown;
    m.mock.onPost("/project/asset/upload_url").reply((config) => {
      createBody = JSON.parse(config.data as string);
      return [
        200,
        {
          code: 0,
          msg: "ok",
          data: {
            uploadUrl: "https://blob.example/container/key?sig=abc",
            objectKey: "key-123",
            method: "PUT",
            headers: { "x-ms-meta-scope": "sandbox" },
          },
        },
      ];
    });
    m.mock.onPost("/project/asset/complete").reply((config) => {
      completeBody = JSON.parse(config.data as string);
      return [200, completeEnvelope("https://blob/sas-final")];
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const ref = await uploadProjectAssetDirect(
      m.client,
      APK,
      new AbortController().signal,
    );

    // Step 1: the file metadata the backend needs to mint the URL.
    expect(createBody).toEqual({
      fileName: "app.apk",
      fileSize: APK.size,
      contentType: "application/vnd.android.package-archive",
    });
    // Step 2: raw PUT to the minted blob URL, carrying the file + spread headers.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [putUrl, putInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(putUrl).toBe("https://blob.example/container/key?sig=abc");
    expect(putInit.method).toBe("PUT");
    expect(putInit.body).toBe(APK);
    expect(putInit.headers).toMatchObject({
      "Content-Type": "application/vnd.android.package-archive",
      "x-ms-blob-content-type": "application/vnd.android.package-archive",
      "x-ms-meta-scope": "sandbox",
    });
    // Step 3: complete carries the objectKey echoed from step 1.
    expect(completeBody).toEqual({
      objectKey: "key-123",
      fileName: "app.apk",
      fileSize: APK.size,
      contentType: "application/vnd.android.package-archive",
    });
    // The returned ref exposes the final sasUrl the caller feeds to install.
    expect(ref.sasUrl).toBe("https://blob/sas-final");
  });

  it("throws when the blob PUT fails, without calling complete", async () => {
    const m = makeClient();
    mock = m.mock;
    m.mock.onPost("/project/asset/upload_url").reply(200, {
      code: 0,
      msg: "ok",
      data: {
        uploadUrl: "https://blob.example/key?sig=abc",
        objectKey: "key-123",
        method: "PUT",
        headers: {},
      },
    });
    const completeSpy = vi.fn();
    m.mock.onPost("/project/asset/complete").reply(() => {
      completeSpy();
      return [200, completeEnvelope("unused")];
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 413 }),
    );

    await expect(
      uploadProjectAssetDirect(m.client, APK, new AbortController().signal),
    ).rejects.toThrow(/blob PUT failed \(413\)/);
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-http upload url before fetching", async () => {
    const m = makeClient();
    mock = m.mock;
    m.mock.onPost("/project/asset/upload_url").reply(200, {
      code: 0,
      msg: "ok",
      data: {
        uploadUrl: "file:///etc/passwd",
        objectKey: "key-123",
        method: "PUT",
        headers: {},
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      uploadProjectAssetDirect(m.client, APK, new AbortController().signal),
    ).rejects.toThrow(/unsupported upload URL scheme/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
