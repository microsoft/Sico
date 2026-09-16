package azuredevops

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestExportMarkupTextUsesSourceTableHeaders(test *testing.T) {
	value := `<table>
		<thead><tr><th>Operation</th><th>Observed state</th></tr></thead>
		<tbody><tr><td>Open composer</td><td>Voice chat is visible</td></tr></tbody>
	</table>`

	text := exportMarkupText(value)

	assert.Equal(test, "Operation: Open composer\nObserved state: Voice chat is visible", text)
}

func TestExportMarkupTextPreservesTableStructure(test *testing.T) {
	for _, fixture := range []struct {
		name     string
		value    string
		expected string
	}{
		{
			name: "caption, header group, multiple rows and empty value",
			value: `<table><caption>Review matrix</caption><colgroup><col/><col/></colgroup>` +
				`<thead><tr><td>Operation</td><td>Observed state</td></tr></thead>` +
				`<tbody><tr><td>Open</td><td></td></tr><tr><td>Close</td><td>Hidden</td></tr></tbody></table>`,
			expected: "Review matrix\nOperation: Open\nObserved state: \n\nOperation: Close\nObserved state: Hidden",
		},
		{
			name: "row headers",
			value: `<table><tr><th scope="row">Operating system</th><td>Windows</td></tr>` +
				`<tr><th scope="row">Browser</th><td>Edge</td></tr></table>`,
			expected: "Operating system: Windows\nBrowser: Edge",
		},
		{
			name: "headerless rows are not relabeled",
			value: `<table><tr><td>Action</td><td>Expected result</td></tr>` +
				`<tr><td>Open</td><td></td></tr></table>`,
			expected: "Action | Expected result\nOpen |",
		},
		{
			name:     "delimiters and line breaks inside headerless cells",
			value:    `<table><tr><td>A | B<br/>C</td><td>D\E</td></tr></table>`,
			expected: `A \| B\nC | D\\E`,
		},
		{
			name: "duplicate titles do not collapse cells",
			value: `<table><tr><th>Value</th><th>Value</th></tr>` +
				`<tr><td>Left</td><td>Right</td></tr></table>`,
			expected: "Value | Value\nLeft | Right",
		},
		{
			name: "blank title is not invented",
			value: `<table><tr><th></th><th>Value</th></tr>` +
				`<tr><td>Left</td><td>Right</td></tr></table>`,
			expected: "| Value\nLeft | Right",
		},
		{
			name: "irregular rows retain their own cells",
			value: `<table><tr><th>Name</th><th>Value</th></tr>` +
				`<tr><td>Single cell</td></tr></table>`,
			expected: "Name | Value\nSingle cell",
		},
		{
			name: "nested tables do not become outer rows",
			value: `<table><tr><th>Component</th></tr><tr><td>` +
				`<table><tr><th scope="row">Name</th><td>Editor</td></tr></table>` +
				`</td></tr></table>`,
			expected: "Component: Name: Editor",
		},
		{
			name: "cell rich text uses the same renderer",
			value: `<table><tr><th><b>Reference</b></th></tr><tr><td>` +
				`<a href="https://example.invalid/details">Details</a>` +
				`<br/><img alt="Diagram" src="https://example.invalid/image.png"/>` +
				`</td></tr></table>`,
			expected: "Reference: Details [https://example.invalid/details]\n" +
				" [Diagram]  [https://example.invalid/image.png]",
		},
	} {
		test.Run(fixture.name, func(test *testing.T) {
			assert.Equal(test, fixture.expected, exportMarkupText(fixture.value))
		})
	}
}

func TestExportMarkupTextPreservesComplexTableMarkup(test *testing.T) {
	for _, value := range []string{
		`<table><caption>Merged</caption><tbody><tr><th colspan="2">Group</th></tr>` +
			`<tr><td>Left</td><td>Right</td></tr></tbody></table>`,
		`<table><tbody><tr><th rowspan="2">Group</th><td>First</td></tr>` +
			`<tr><td>Second</td></tr></tbody></table>`,
		`<table><tbody><tr><th id="name">Name</th><th id="value">Value</th></tr>` +
			`<tr><td headers="value">First</td><td headers="name">Second</td></tr></tbody></table>`,
		`<table><tbody><tr><th scope="colgroup">Group</th><td>Value</td></tr></tbody></table>`,
	} {
		assert.Equal(test, value, exportMarkupText(value))
	}
}

func TestExportMarkupTextPreservesRichTextStructures(test *testing.T) {
	for _, fixture := range []struct {
		name     string
		value    string
		expected string
	}{
		{
			name:     "headings and paragraphs do not run together",
			value:    `<div>Before<h2>Environment</h2><p>Windows</p><h3>Result</h3>Passed</div>`,
			expected: "Before\nEnvironment\nWindows\nResult\nPassed",
		},
		{
			name:     "ordered list with start and item values",
			value:    `<ol start="3"><li>Open</li><li value="7">Check</li><li>Close</li></ol>`,
			expected: "3. Open\n7. Check\n8. Close",
		},
		{
			name:     "reversed list",
			value:    `<ol reversed><li>Last</li><li>First</li></ol>`,
			expected: "2. Last\n1. First",
		},
		{
			name:     "nested ordered and unordered lists",
			value:    `<ol><li>Parent<ul><li>First</li><li>Second</li></ul></li><li>Finish</li></ol>`,
			expected: "1. Parent\n   - First\n   - Second\n2. Finish",
		},
		{
			name:     "list contents reuse table rendering",
			value:    `<ul><li><table><tr><th>Name</th></tr><tr><td>Editor</td></tr></table></li></ul>`,
			expected: "- Name: Editor",
		},
		{
			name:     "definition list labels",
			value:    `<dl><dt>Browser</dt><dd>Edge</dd><dt>State</dt><dd>Ready</dd><dd>Confirmed</dd></dl>`,
			expected: "Browser: Edge\nState: Ready\nState: Confirmed",
		},
		{
			name:     "preformatted code preserves whitespace",
			value:    "<pre><code>  if count &lt; 2:\n    retry()\n</code></pre>",
			expected: "```\n  if count < 2:\n    retry()\n```",
		},
		{
			name:     "code containing a fence",
			value:    "<pre>```\nexample\n```</pre>",
			expected: "````\n```\nexample\n```\n````",
		},
		{
			name: "mentions and references",
			value: `<p><a data-vss-mention="fixture">@Person</a> reviewed ` +
				`<a href="https://example.invalid/101">#101</a></p>`,
			expected: "@Person reviewed #101 [https://example.invalid/101]",
		},
		{
			name:     "explicit blank lines and ignored scripts",
			value:    `<div>First<br/><br/>Last<script>hidden()</script><style>.hidden{}</style></div>`,
			expected: "First\n\nLast",
		},
		{
			name:     "empty rich text editor",
			value:    `<div><p><br/></p></div>`,
			expected: "",
		},
		{
			name:     "non-English source headers",
			value:    `<table><tr><th>&#x64cd;&#x4f5c;</th></tr><tr><td>Open</td></tr></table>`,
			expected: "\u64cd\u4f5c: Open",
		},
	} {
		test.Run(fixture.name, func(test *testing.T) {
			assert.Equal(test, fixture.expected, exportMarkupText(fixture.value))
		})
	}
}

func TestExportMarkupTextPreservesUnsupportedRichStructures(test *testing.T) {
	for _, value := range []string{
		`<ol type="A"><li>First</li><li>Second</li></ol>`,
		`<ol start="unknown"><li>First</li></ol>`,
		`<ol><li value="unknown">First</li></ol>`,
		`<ol><li>First</li><div>Outside item</div></ol>`,
		`<dl><dt>Term</dt><dt>Alias</dt><dd>Definition</dd></dl>`,
		`<dl><dt>Term without definition</dt></dl>`,
		`<div><custom-control reference="201">Content</custom-control></div>`,
		`<div><input type="text" value="Attribute-only content"/></div>`,
	} {
		text := exportMarkupText(value)

		assert.Contains(test, text, strings.TrimSuffix(strings.TrimPrefix(value, "<div>"), "</div>"))
	}
}

func TestExportMarkupTextDoesNotTreatHTMLAttributeNamesAsElements(test *testing.T) {
	for _, value := range []string{
		`<action>Open</action>`,
		`<value>42</value>`,
		`<video src="https://example.invalid/video.mp4"></video>`,
	} {
		text := exportMarkupText(value)

		assert.Equal(test, value, text)
	}
	assert.Equal(test,
		"Before\n<action reference=\"201\">Open</action>\nAfter",
		exportMarkupText(`<div>Before<action reference="201">Open</action>After</div>`),
	)
}
