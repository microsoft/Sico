package azuredevops

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDirectExportRowsKeepsOneRowPerItemAndExactlySelectedColumns(test *testing.T) {
	fields := []ExportField{
		{Name: "ID", ReferenceName: "System.Id", Type: "integer"},
		{Name: "Title", ReferenceName: "System.Title", Type: "string"},
		{Name: "Description", ReferenceName: "System.Description", Type: "html"},
		{Name: "Test Steps", ReferenceName: exportStepsField, Type: "html"},
	}
	item := exportTestWorkItem(101, "Test Case")
	item.Fields["System.Description"] = "<p>Keep the full description.</p>"
	item.Fields[exportStepsField] = `<steps><step><parameterizedString>Open the composer</parameterizedString>` +
		`<parameterizedString>Voice chat is visible</parameterizedString></step>` +
		`<step><parameterizedString>Enter a message</parameterizedString>` +
		`<parameterizedString>Send is visible</parameterizedString></step></steps>`
	other := exportTestWorkItem(102, "Bug")
	roots, err := exportCaseStepNodes([]savedWorkItem{item, other}, fields)
	require.NoError(test, err)
	adapters := defaultExportFieldAdapters()
	adapters[exportStepsField] = stepsFieldAdapter(roots, nil)

	rows, err := directWorkItemsRows([]savedWorkItem{item, other}, fields, adapters)

	require.NoError(test, err)
	require.Len(test, rows, 3)
	assert.Equal(test, []string{"ID", "Title", "Description", "Test Steps"}, rows[0])
	assert.Equal(test, "Keep the full description.", rows[1][2])
	assert.Equal(test,
		"Step 1\nAction: Open the composer\nExpected result: Voice chat is visible\n\n"+
			"Step 2\nAction: Enter a message\nExpected result: Send is visible",
		rows[1][3],
	)
	assert.Equal(test, "102", rows[2][0])
	assert.Empty(test, rows[2][3])
}

func TestDirectExportRowsPreservesSelectedFieldsAndSharedSteps(t *testing.T) {
	fields, err := selectedDirectExportFields(exportTestCatalog(), []string{
		"System.Id", "System.WorkItemType", "System.Title",
		"Custom.Component", "System.AssignedTo", "System.ChangedDate", exportStepsField,
	})
	require.NoError(t, err)
	item := exportTestWorkItem(101, "Test Case")
	item.Fields["System.Title"] = "Title, \"quoted\" \u4e2d\u6587"
	item.Fields["Custom.Component"] = map[string]any{"label": "\u00b2", "values": []any{"one", true}}
	item.Fields["System.AssignedTo"] = map[string]any{"displayName": "Test User", "uniqueName": "test@example.invalid"}
	item.Fields["System.ChangedDate"] = exportTestAsOf
	item.Fields[exportStepsField] = `<steps><step><parameterizedString>&lt;p&gt;First, "quoted"&lt;br/&gt;` +
		`Second @value&lt;/p&gt;</parameterizedString><parameterizedString>&lt;p&gt;&#x4e2d;&#x6587;&lt;/p&gt;` +
		`</parameterizedString></step><step><parameterizedString/><parameterizedString/></step>` +
		`<compref ref="201"/></steps>`
	item.Fields[exportParametersField] = `<parameters><param name="value"/><param name="unused"/></parameters>`
	item.Fields[exportDataSourceField] = `<NewDataSet><Table1><value>raw &amp; data</value>` +
		`<unused>kept</unused></Table1></NewDataSet>`
	sharedItem := exportTestWorkItem(201, "Shared Steps")
	sharedItem.Fields[exportStepsField] = `<steps><step><parameterizedString>Shared @value</parameterizedString>` +
		`<parameterizedString/></step></steps>`
	shared, err := parseExportSteps(sharedItem.Fields[exportStepsField].(string))
	require.NoError(t, err)
	roots, err := exportCaseStepNodes([]savedWorkItem{item}, fields)
	require.NoError(t, err)
	adapters := defaultExportFieldAdapters()
	adapters[exportStepsField] = stepsFieldAdapter(roots, map[string][]exportStepNode{"201": shared})
	rows, err := directWorkItemsRows([]savedWorkItem{item}, fields, adapters)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	require.Len(t, rows[0], 7)
	require.Len(t, rows[1], 7)
	assert.Equal(t, []string{"ID", "Work Item Type", "Title", "Component", "Assigned To", "Changed Date"}, rows[0][:6])
	for _, row := range rows[1:] {
		assert.Equal(t, "101", row[0])
		assert.Equal(t, item.Fields["System.Title"], row[2])
		assert.JSONEq(t, `{"label":"\u00b2","values":["one",true]}`, row[3])
		assert.Equal(t, "Test User <test@example.invalid>", row[4])
		assert.Equal(t, exportTestAsOf, row[5])
	}
	assert.Equal(t,
		"Step 1\nAction: First, \"quoted\"\nSecond @value\nExpected result: \u4e2d\u6587\n\n"+
			"Step 2\nAction: \nExpected result: \n\n"+
			"Step 3.1\nShared steps: #201\nAction: Shared @value\nExpected result: ",
		rows[1][6],
	)
}

func TestDirectExportRowsPreservesValuesWithoutTruncation(t *testing.T) {
	fields := append(append([]ExportField(nil), directExportBaseFields...),
		ExportField{Name: "=Custom header", ReferenceName: "Custom.Value", Type: "string"})
	item := exportTestWorkItem(101, "Bug")
	item.Fields["System.Title"] = " \t=1+1"
	item.Fields["Custom.Value"] = strings.Repeat("x", 40000)
	rows, err := directWorkItemsRows([]savedWorkItem{item}, fields, defaultExportFieldAdapters())
	require.NoError(t, err)
	assert.Equal(t, "=Custom header", rows[0][3])
	assert.Equal(t, " \t=1+1", rows[1][2])
	assert.Len(t, rows[1][3], 40000)
	item.Fields["Custom.Value"] = strings.Repeat("x", MaxExportBytes)
	rows, err = directWorkItemsRows([]savedWorkItem{item}, fields, defaultExportFieldAdapters())
	assert.ErrorContains(t, err, "8 MiB")
	assert.Nil(t, rows)
}

func exportTestCatalog() []ExportField {
	return append(append([]ExportField(nil), directExportBaseFields...), []ExportField{
		{Name: "Component", ReferenceName: "Custom.Component", Type: "string"},
		{Name: "Enabled", ReferenceName: "Custom.Enabled", Type: "boolean"},
		{Name: "Assigned To", ReferenceName: "System.AssignedTo", Type: "string", IsIdentity: true},
		{Name: "Changed Date", ReferenceName: "System.ChangedDate", Type: "dateTime"},
		{Name: "Steps", ReferenceName: exportStepsField, Type: "html"},
		{Name: "Parameters", ReferenceName: exportParametersField, Type: "html"},
		{Name: "Local Data Source", ReferenceName: exportDataSourceField, Type: "html"},
		{Name: "State", ReferenceName: "System.State", Type: "string"},
		{Name: "Area Path", ReferenceName: "System.AreaPath", Type: "treePath"},
	}...)
}
