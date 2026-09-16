package azuredevops

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListExportFieldsDiscoversCustomAndReadOnlyFields(test *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		assert.Equal(test, "/office/project-id/_apis/wit/fields", request.URL.Path)
		assert.Equal(test, "extensionFields", request.URL.Query().Get("$expand"))
		_, _ = io.WriteString(response, `{"value":[`+
			`{"referenceName":"System.Id","name":"Work Item ID","type":"integer",`+
			`"usage":"workItem","readOnly":true},`+
			`{"referenceName":"Microsoft.VSTS.TCM.Steps","name":"Steps","type":"html","usage":"workItem"},`+
			`{"referenceName":"Custom.Component","name":"Component","type":"string","usage":"workItem"},`+
			`{"referenceName":"Custom.Owner","name":"Release Owner","type":"string","isIdentity":true},`+
			`{"referenceName":"Custom.Archived","name":"Archived","type":"string","isDeleted":true},`+
			`{"referenceName":"System.Links.LinkType","name":"Link Type","type":"string","usage":"workItemLink"},`+
			`{"referenceName":"Custom.Tree","name":"Tree","type":"string","usage":"tree"},`+
			`{"referenceName":"WEF.BoardColumn","name":"Board Column","type":"string",`+
			`"usage":"workItemTypeExtension"}]}`)
	}))
	defer server.Close()

	fields, err := testConnector(test, server.URL).ListExportFields(
		context.Background(),
		"delegated",
		"office",
		"project-id",
	)

	require.NoError(test, err)
	require.Len(test, fields, 5)
	byReference := make(map[string]ExportField, len(fields))
	for _, field := range fields {
		byReference[field.ReferenceName] = field
	}
	assert.Equal(test, "Work Item ID", byReference["System.Id"].Name)
	assert.True(test, byReference["System.Id"].Required)
	assert.Equal(test, ExportFieldGroupDetail, byReference["System.Id"].Group)
	assert.Equal(test, "Steps", byReference[exportStepsField].Name)
	assert.Equal(test, "string", byReference["Custom.Component"].Type)
	assert.Equal(test, ExportFieldGroupOther, byReference["Custom.Component"].Group)
	assert.True(test, byReference["Custom.Owner"].IsIdentity)
	assert.Contains(test, byReference, "WEF.BoardColumn")
	assert.NotContains(test, byReference, "System.Links.LinkType")
	assert.NotContains(test, byReference, "Custom.Tree")
	assert.NotContains(test, byReference, "Custom.Archived")
}

func TestListExportFieldsGroupsDetailsBeforeOtherFields(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		assert.Equal(t, http.MethodGet, request.Method)
		assert.Equal(t, "Bearer delegated", request.Header.Get("Authorization"))
		assert.Equal(t, "7.1", request.URL.Query().Get("api-version"))
		assert.Equal(t, "/office/project-id/_apis/wit/fields", request.URL.Path)
		_, _ = io.WriteString(response, `{"value":[`+
			`{"referenceName":"System.Id","name":"ID","type":"integer"},`+
			`{"referenceName":"System.WorkItemType","name":"Work Item Type","type":"string"},`+
			`{"referenceName":"System.Title","name":"Title","type":"string"},`+
			`{"referenceName":"System.State","name":"State","type":"string"},`+
			`{"referenceName":"Microsoft.VSTS.TCM.Steps","name":"Steps","type":"html"},`+
			`{"referenceName":"Microsoft.VSTS.TCM.Parameters","name":"Parameters","type":"plainText"},`+
			`{"referenceName":"Custom.Component","name":"Component","type":"string"}]}`)
	}))
	defer server.Close()

	fields, err := testConnector(t, server.URL).ListExportFields(
		context.Background(),
		"delegated",
		"office",
		"project-id",
	)

	require.NoError(t, err)
	require.Len(t, fields, 7)
	for index, base := range directExportBaseFields {
		base.Group = ExportFieldGroupDetail
		assert.Equal(t, base, fields[index])
	}
	assert.Equal(t, "System.State", fields[4].ReferenceName)
	assert.Equal(t, "Steps", fields[3].Name)
	assert.Equal(t, exportStepsField, fields[3].ReferenceName)
	assert.False(t, fields[3].Required)
	assert.False(t, fields[4].Required)
	assert.Equal(t, "Custom.Component", fields[5].ReferenceName)
	assert.Equal(t, "Microsoft.VSTS.TCM.Parameters", fields[6].ReferenceName)
	assert.Equal(t, ExportFieldGroupOther, fields[5].Group)
	assert.Equal(t, ExportFieldGroupOther, fields[6].Group)
}

func TestListExportFieldsRequiresProjectContext(t *testing.T) {
	_, err := testConnector(t, "https://provider.invalid").ListExportFields(
		context.Background(), "delegated", "office", "",
	)
	assert.ErrorIs(t, err, ErrInvalidContentQuery)
}

func TestListExportFieldsIncludesFieldsOutsideTheDetailView(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		assert.Equal(t, http.MethodGet, request.Method)
		assert.Equal(t, "/office/project-id/_apis/wit/fields", request.URL.Path)
		_, _ = io.WriteString(response, `{"value":[`+
			`{"referenceName":"System.Id","name":"ID","type":"integer"},`+
			`{"referenceName":"System.WorkItemType","name":"Work Item Type","type":"string"},`+
			`{"referenceName":"System.Title","name":"Title","type":"string"},`+
			`{"referenceName":"Bug.Only","name":"Bug Details","type":"html"}]}`)
	}))
	defer server.Close()
	fields, err := testConnector(t, server.URL).ListExportFields(
		context.Background(), "delegated", "office", "project-id",
	)
	require.NoError(t, err)
	require.Len(t, fields, 4)
	assert.Equal(t, "Bug.Only", fields[3].ReferenceName)
	assert.Equal(t, ExportFieldGroupOther, fields[3].Group)
}

func TestExportIdentityUsesGlobalMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		assert.Equal(t, "/office/project-id/_apis/wit/fields", request.URL.Path)
		_, _ = io.WriteString(response, `{"value":[`+
			`{"referenceName":"System.AssignedTo","name":"Assigned To","type":"string","isIdentity":true},`+
			`{"referenceName":"Custom.Object","name":"Object","type":"string"}]}`)
	}))
	defer server.Close()
	catalog, err := testConnector(t, server.URL).ListExportFields(
		context.Background(), "delegated", "office", "project-id",
	)
	require.NoError(t, err)
	require.Len(t, catalog, 2)
	assert.Equal(t, "string", catalog[0].Type)
	assert.True(t, catalog[0].IsIdentity)
	value := map[string]any{"displayName": "Fixture User", "uniqueName": "fixture@example.invalid"}
	text, err := exportFieldText(value, catalog[0])
	require.NoError(t, err)
	assert.Equal(t, "Fixture User <fixture@example.invalid>", text)
	text, err = exportFieldText(value, ExportField{Type: "string"})
	require.NoError(t, err)
	assert.JSONEq(t, `{"displayName":"Fixture User","uniqueName":"fixture@example.invalid"}`, text)
}

func TestSelectedDirectExportFieldsNeverAppendsColumns(test *testing.T) {
	selected := []string{"System.Id", "System.WorkItemType", "System.Title", exportStepsField}

	fields, err := selectedDirectExportFields(exportTestCatalog(), selected)

	require.NoError(test, err)
	require.Len(test, fields, len(selected))
	for index, reference := range selected {
		assert.Equal(test, reference, fields[index].ReferenceName)
	}
	_, err = selectedDirectExportFields(exportTestCatalog(), []string{exportStepsField})
	assert.ErrorContains(test, err, "select required export field System.Id")
	_, err = selectedDirectExportFields(exportTestCatalog(), append(selected, "Custom.Unavailable"))
	assert.ErrorContains(test, err, "not available")
}
