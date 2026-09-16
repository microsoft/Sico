package azuredevops

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	exportParametersField = "Microsoft.VSTS.TCM.Parameters"
	exportDataSourceField = "Microsoft.VSTS.TCM.LocalDataSource"
)

func TestExportFieldAdaptersHandleMetadataFormats(test *testing.T) {
	for _, fixture := range []struct {
		name     string
		field    ExportField
		value    any
		expected string
	}{
		{
			name:     "plain text",
			field:    ExportField{Type: "string"},
			value:    "Keep <literal> & @name",
			expected: "Keep <literal> & @name",
		},
		{name: "zero", field: ExportField{Type: "integer"}, value: 0, expected: "0"},
		{name: "false", field: ExportField{Type: "boolean"}, value: false, expected: "false"},
		{name: "decimal", field: ExportField{Type: "double"}, value: 1.25, expected: "1.25"},
		{name: "missing", field: ExportField{Type: "string"}, expected: ""},
		{name: "date", field: ExportField{Type: "dateTime"}, value: exportTestAsOf, expected: exportTestAsOf},
		{
			name:     "html",
			field:    ExportField{ReferenceName: "Custom.Notes", Type: "html"},
			value:    "<p>First<br/>Second</p><p>Third</p>",
			expected: "First\nSecond\nThird",
		},
		{
			name:     "history value",
			field:    ExportField{Type: "history"},
			value:    "<p>Latest comment</p>",
			expected: "Latest comment",
		},
		{
			name:     "generic XML retains keys and markup",
			field:    ExportField{ReferenceName: "Custom.StructuredText", Type: "html"},
			value:    "<record><content>&lt;p&gt;First&lt;/p&gt;</content><note><![CDATA[Second]]></note></record>",
			expected: "<record><content>&lt;p&gt;First&lt;/p&gt;</content><note><![CDATA[Second]]></note></record>",
		},
		{
			name:     "namespaced XML is not mistaken for HTML",
			field:    ExportField{Type: "html"},
			value:    `<data xmlns="urn:custom"><title>Capacity</title><value>4</value></data>`,
			expected: `<data xmlns="urn:custom"><title>Capacity</title><value>4</value></data>`,
		},
		{
			name:     "declared XML retains HTML-like element names",
			field:    ExportField{Type: "html"},
			value:    `<?xml version="1.0" encoding="utf-16"?><data><title>Capacity</title><value>4</value></data>`,
			expected: `<?xml version="1.0" encoding="utf-16"?><data><title>Capacity</title><value>4</value></data>`,
		},
		{
			name:     "JSON in an HTML field remains structured",
			field:    ExportField{Type: "html"},
			value:    `{"Action":"Keep <b>literal</b>","result":false}`,
			expected: `{"Action":"Keep <b>literal</b>","result":false}`,
		},
		{
			name:     "HTML document type",
			field:    ExportField{Type: "html"},
			value:    `<!DOCTYPE html><html><body><p>Visible text</p></body></html>`,
			expected: "Visible text",
		},
		{
			name:     "attribute-only XML",
			field:    ExportField{Type: "html"},
			value:    `<record><reference id="201"/></record>`,
			expected: `<record><reference id="201"/></record>`,
		},
		{
			name:     "unrecognized XML preserves attributes",
			field:    ExportField{Type: "html"},
			value:    `<record><value unit="hours">4</value></record>`,
			expected: `<record><value unit="hours">4</value></record>`,
		},
		{
			name:     "parameters XML marked as html",
			field:    ExportField{ReferenceName: exportParametersField, Type: "html"},
			value:    `<parameters><param name="account" bind="default"/></parameters>`,
			expected: `<parameters><param name="account" bind="default"/></parameters>`,
		},
		{
			name:     "data source XML marked as html",
			field:    ExportField{ReferenceName: exportDataSourceField, Type: "html"},
			value:    `<NewDataSet><Table1><name>A &amp; B</name></Table1></NewDataSet>`,
			expected: `<NewDataSet><Table1><name>A &amp; B</name></Table1></NewDataSet>`,
		},
		{
			name:     "identity metadata",
			field:    ExportField{Type: "string", IsIdentity: true},
			value:    map[string]any{"displayName": "Person", "uniqueName": "person@example.invalid"},
			expected: "Person <person@example.invalid>",
		},
		{
			name:     "legacy identity text",
			field:    ExportField{Type: "string", IsIdentity: true},
			value:    "Person <person@example.invalid>",
			expected: "Person <person@example.invalid>",
		},
		{
			name:     "unknown identity object is not discarded",
			field:    ExportField{Type: "identity"},
			value:    map[string]any{"id": "identity-id"},
			expected: `{"id":"identity-id"}`,
		},
		{
			name:     "multi-value extension text is not split or reordered",
			field:    ExportField{ReferenceName: "Custom.MultiValue", Type: "string"},
			value:    "Second;First; value with spaces",
			expected: "Second;First; value with spaces",
		},
		{
			name:     "unknown metadata type retains object keys",
			field:    ExportField{Type: "futureFieldType"},
			value:    map[string]any{"count": 0, "enabled": false},
			expected: `{"count":0,"enabled":false}`,
		},
		{
			name:     "custom object is not assumed to be a person",
			field:    ExportField{Type: "string"},
			value:    map[string]any{"displayName": "Component", "number": 2},
			expected: `{"displayName":"Component","number":2}`,
		},
		{
			name:     "array",
			field:    ExportField{Type: "string"},
			value:    []any{"one", false, 0},
			expected: `["one",false,0]`,
		},
	} {
		test.Run(fixture.name, func(test *testing.T) {
			item := savedWorkItem{ID: 101, Fields: map[string]any{fixture.field.ReferenceName: fixture.value}}

			text, err := defaultExportFieldAdapters().format(item, fixture.field)

			require.NoError(test, err)
			assert.Equal(test, fixture.expected, text)
		})
	}
}

func TestExportFieldAdaptersSupportStandardFieldTypes(test *testing.T) {
	for _, fixture := range []struct {
		fieldType string
		value     any
		expected  string
	}{
		{fieldType: "string", value: "Keep <literal>", expected: "Keep <literal>"},
		{fieldType: "integer", value: 0, expected: "0"},
		{fieldType: "dateTime", value: exportTestAsOf, expected: exportTestAsOf},
		{fieldType: "plainText", value: "First\nSecond <literal>", expected: "First\nSecond <literal>"},
		{fieldType: "html", value: "<p>Visible text</p>", expected: "Visible text"},
		{fieldType: "treePath", value: `Project\Area\Subarea`, expected: `Project\Area\Subarea`},
		{fieldType: "history", value: "<p>Latest comment only</p>", expected: "Latest comment only"},
		{fieldType: "double", value: 0.25, expected: "0.25"},
		{fieldType: "guid", value: testSavedQueryID, expected: testSavedQueryID},
		{fieldType: "boolean", value: false, expected: "false"},
		{fieldType: "identity", value: map[string]any{"displayName": "Person"}, expected: "Person"},
		{fieldType: "picklistString", value: "Custom value", expected: "Custom value"},
		{fieldType: "picklistInteger", value: 0, expected: "0"},
		{fieldType: "picklistDouble", value: 1.25, expected: "1.25"},
	} {
		test.Run(fixture.fieldType, func(test *testing.T) {
			field := ExportField{
				Name:          "Steps",
				ReferenceName: "Custom.Editor",
				Type:          fixture.fieldType,
			}
			item := savedWorkItem{Fields: map[string]any{field.ReferenceName: fixture.value}}

			text, err := defaultExportFieldAdapters().format(item, field)

			require.NoError(test, err)
			assert.Equal(test, fixture.expected, text)
		})
	}
}

func TestUnselectedStepsDoNotParseOrFetchDependencies(test *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		test.Errorf("unexpected metadata or shared-step request: %s", request.URL.Path)
		response.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	item := exportTestWorkItem(101, "Custom Work Item")
	item.Fields[exportStepsField] = "<broken XML"
	item.Fields["Custom.Notes"] = "<p>Generic content</p>"
	fields := append(append([]ExportField(nil), directExportBaseFields...),
		ExportField{Name: "Notes", ReferenceName: "Custom.Notes", Type: "html"})
	snapshot := &queryExportSnapshot{Items: []savedWorkItem{item}, Fields: fields}

	adapters, err := testConnector(test, server.URL).prepareExportFieldAdapters(
		context.Background(),
		"delegated",
		"office",
		"project-id",
		snapshot,
	)

	require.NoError(test, err)
	rows, err := directWorkItemsRows(snapshot.Items, fields, adapters)
	require.NoError(test, err)
	assert.Equal(test, []string{"101", "Custom Work Item", "Item 101", "Generic content"}, rows[1])
}
