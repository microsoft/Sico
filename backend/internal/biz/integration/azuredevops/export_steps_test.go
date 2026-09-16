package azuredevops

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDirectExportStepsPreservesTextAndSharedAssociations(t *testing.T) {
	value := `<?xml version="1.0" encoding="utf-16"?><steps><step id="2">` +
		`<parameterizedString>&lt;p&gt;First, "quoted"&lt;br/&gt;Second @value&lt;/p&gt;</parameterizedString>` +
		`<parameterizedString>&lt;p&gt;Expected &#x4e2d;&#x6587; x&#xb2;&lt;/p&gt;</parameterizedString>` +
		`</step><compref ref="201"/></steps>`
	nodes, err := parseExportSteps(value)
	require.NoError(t, err)
	shared, err := parseExportSteps(`<steps><step><parameterizedString>Shared action</parameterizedString>` +
		`<parameterizedString>Shared expected</parameterizedString></step></steps>`)
	require.NoError(t, err)
	steps, err := exportSteps(nodes, map[string][]exportStepNode{"201": shared}, "", map[string]bool{})
	require.NoError(t, err)
	require.Len(t, steps, 2)
	assert.Equal(t, "First, \"quoted\"\nSecond @value", steps[0].Action)
	assert.Equal(t, "Expected \u4e2d\u6587 x\u00b2", steps[0].Expected)
	assert.Equal(t, "2.1", steps[1].Number)
	assert.Equal(t, "201", steps[1].SharedID)
	assert.Equal(t, "Shared action", steps[1].Action)
}

func TestDirectExportStepsRejectsUnavailableAndMalformedData(t *testing.T) {
	_, err := parseExportSteps(`<steps><step>`)
	assert.ErrorIs(t, err, ErrInvalidContentQuery)
	nodes, err := parseExportSteps(`<steps><compref ref="201"/></steps>`)
	require.NoError(t, err)
	_, err = exportSteps(nodes, nil, "", map[string]bool{})
	assert.ErrorIs(t, err, ErrInvalidContentQuery)
	_, err = exportSteps(nodes, map[string][]exportStepNode{"201": nodes}, "", map[string]bool{})
	assert.ErrorIs(t, err, ErrInvalidContentQuery)
}

func TestDirectExportStepsPreservesEmptyStepsAndLocalMediaText(t *testing.T) {
	value := `<steps><step><parameterizedString>&lt;p&gt;Line one&lt;br/&gt;Line two ` +
		`&lt;img alt="Screenshot" src="https://example.invalid/image.png"/&gt;` +
		`&lt;a href="https://example.invalid/item"&gt;Reference&lt;/a&gt;&lt;/p&gt;</parameterizedString>` +
		`<parameterizedString/></step><step><parameterizedString/><parameterizedString/></step>` +
		`<compref ref="201"/></steps>`
	nodes, err := parseExportSteps(value)
	require.NoError(t, err)
	steps, err := exportSteps(nodes, map[string][]exportStepNode{"201": {}}, "", map[string]bool{})
	require.NoError(t, err)
	require.Len(t, steps, 3)
	assert.Contains(t, steps[0].Action, "Line one\nLine two")
	assert.Contains(t, steps[0].Action, "[Screenshot]")
	assert.Contains(t, steps[0].Action, "https://example.invalid/image.png")
	assert.Contains(t, steps[0].Action, "Reference [https://example.invalid/item]")
	assert.Empty(t, steps[0].Expected)
	assert.Equal(t, exportStep{Number: "2"}, steps[1])
	assert.Equal(t, exportStep{Number: "3", SharedID: "201"}, steps[2])
}

func TestDirectExportStepsRejectsTrailingXMLContent(t *testing.T) {
	for _, value := range []string{"<steps/><steps/>", "<steps/>trailing", "<steps/><broken"} {
		_, err := parseExportSteps(value)
		assert.ErrorIs(t, err, ErrInvalidContentQuery)
	}
	_, err := parseExportSteps("<steps/> \n<!-- allowed trailing comment -->")
	require.NoError(t, err)
}

func TestDirectExportRowsBoundsSharedExpansion(t *testing.T) {
	item := exportTestWorkItem(101, "Test Case")
	item.Fields[exportStepsField] = `<steps><compref ref="201"/></steps>`
	fields, err := selectedDirectExportFields(exportTestCatalog(), []string{
		"System.Id", "System.WorkItemType", "System.Title", exportStepsField,
	})
	require.NoError(t, err)
	roots, err := exportCaseStepNodes([]savedWorkItem{item}, fields)
	require.NoError(t, err)
	shared := make(map[string][]exportStepNode)
	for _, pair := range [][2]string{{"201", "202"}, {"202", "203"}} {
		nodes, err := parseExportSteps("<steps>" + strings.Repeat(`<compref ref="`+pair[1]+`"/>`, 128) + "</steps>")
		require.NoError(t, err)
		shared[pair[0]] = nodes
	}
	shared["203"], err = parseExportSteps(`<steps><step><parameterizedString>` + strings.Repeat("a", 1024) +
		`</parameterizedString><parameterizedString/></step></steps>`)
	require.NoError(t, err)
	require.NoError(t, validateExportSharedGraph(shared))
	adapters := defaultExportFieldAdapters()
	adapters[exportStepsField] = stepsFieldAdapter(roots, shared)
	content, err := directWorkItemsRows([]savedWorkItem{item}, fields, adapters)
	assert.ErrorContains(t, err, "8 MiB")
	assert.Nil(t, content)
}
