// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// Package embeddata exposes static files (icons, skill source trees, ...)
// that the backend embeds at build time via //go:embed. The underlying
// files live alongside this file under icons/ and skills/.
package embeddata

import (
	"archive/zip"
	"bytes"
	"embed"
	"fmt"
	"io/fs"
	"sync"
	"time"
)

//go:embed icons/project-default.svg
var ProjectDefaultIcon []byte

// -------------- Android Tester --------------

//go:embed icons/avatar-tester.svg
var AndroidTesterIcon []byte

// AndroidTesterSkillFS embeds the subset of the android-tester skill tree
// that ships in the runtime zip:
//
//   - android_tester/
//   - data/
//   - scripts/install-adb.sh, scripts/install-adb.ps1
//   - Top-level: pyproject.toml, SKILL.md, README.md, config.env
//
//go:embed all:skills/android-tester/android_tester
//go:embed all:skills/android-tester/data
//go:embed skills/android-tester/scripts/install-adb.sh
//go:embed skills/android-tester/scripts/install-adb.ps1
//go:embed skills/android-tester/pyproject.toml
//go:embed skills/android-tester/SKILL.md
//go:embed skills/android-tester/README.md
var AndroidTesterSkillFS embed.FS

// AndroidTesterSkillRoot is the path prefix used inside AndroidTesterSkillFS.
const AndroidTesterSkillRoot = "skills/android-tester"

// AndroidTesterSkillZip lazily builds a deterministic zip archive from the
// embedded android-tester directory. The result is cached for the
// lifetime of the process so repeated callers reuse the same bytes (and
// therefore the same SHA-256, which dedup logic relies on).
var AndroidTesterSkillZip = sync.OnceValues(func() ([]byte, error) {
	return buildZipFromFS(AndroidTesterSkillFS, AndroidTesterSkillRoot)
})

// -------------- 3D Artist --------------

//go:embed icons/avatar-3d-artist.svg
var ThreeDArtistIcon []byte

//go:embed skills/ai-3d-model.zip
var ThreeDArtistSkillZip []byte

// -------------- Product Manager --------------

//go:embed icons/avatar-product-manager.svg
var ProductManagerIcon []byte

//go:embed skills/pm-competitive-analysis.zip
var ProductManagerSkillCompetitiveAnalysisZip []byte

//go:embed skills/pm-frontend-slides.zip
var ProductManagerSkillFrontendSlidesZip []byte

//go:embed skills/pm-setting-okrs-goals.zip
var ProductManagerSkillSettingOKRsGoalsZip []byte

//go:embed skills/pm-writing-prds.zip
var ProductManagerSkillWritingPRDsZip []byte

// -------------- Marketing --------------

//go:embed icons/avatar-marketing.svg
var MarketingIcon []byte

//go:embed skills/marketing-brand-storytelling.zip
var MarketingSkillBrandStorytellingZip []byte

//go:embed skills/marketing-content-marketing.zip
var MarketingSkillContentMarketingZip []byte

//go:embed skills/marketing-image-generation.zip
var MarketingSkillImageGenerationZip []byte

//go:embed skills/marketing-launch-marketing.zip
var MarketingSkillLaunchMarketingZip []byte

//go:embed skills/marketing-positioning-messaging.zip
var MarketingSkillPositioningMessagingZip []byte

// buildZipFromFS walks `root` inside `fsys` and returns a zip archive whose
// entries are stored relative to `root` (i.e. without the `root/` prefix).
// Entries are emitted in sorted order with a fixed modification time so the
// resulting bytes are deterministic across runs.
func buildZipFromFS(fsys fs.FS, root string) ([]byte, error) {
	buf := bytes.NewBuffer(nil)
	zw := zip.NewWriter(buf)

	fixedModTime := time.Date(2026, 4, 29, 0, 0, 0, 0, time.UTC)

	walkErr := fs.WalkDir(fsys, root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		rel, relErr := relPath(root, path)
		if relErr != nil {
			return relErr
		}
		if d.IsDir() {
			header := &zip.FileHeader{Name: rel + "/", Method: zip.Store}
			header.Modified = fixedModTime
			if _, hErr := zw.CreateHeader(header); hErr != nil {
				return hErr
			}
			return nil
		}
		header := &zip.FileHeader{Name: rel, Method: zip.Deflate}
		header.Modified = fixedModTime
		w, hErr := zw.CreateHeader(header)
		if hErr != nil {
			return hErr
		}
		data, readErr := fs.ReadFile(fsys, path)
		if readErr != nil {
			return readErr
		}
		if _, wErr := w.Write(data); wErr != nil {
			return wErr
		}
		return nil
	})
	if walkErr != nil {
		return nil, fmt.Errorf("buildZipFromFS: walk %s: %w", root, walkErr)
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("buildZipFromFS: close zip: %w", err)
	}
	return buf.Bytes(), nil
}

// relPath returns `path` with the `root/` prefix stripped. Both arguments use
// forward slashes (as required by io/fs).
func relPath(root, path string) (string, error) {
	prefix := root + "/"
	if len(path) <= len(prefix) || path[:len(prefix)] != prefix {
		return "", fmt.Errorf("relPath: %q is not under %q", path, root)
	}
	return path[len(prefix):], nil
}
