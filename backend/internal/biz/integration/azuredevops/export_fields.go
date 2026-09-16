package azuredevops

import (
	"cmp"
	"context"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

const (
	ExportFieldGroupDetail = "detail"
	ExportFieldGroupOther  = "other"
)

type ExportField struct {
	Name          string `json:"name"`
	ReferenceName string `json:"referenceName"`
	Type          string `json:"type"`
	IsIdentity    bool   `json:"isIdentity,omitempty"`
	Required      bool   `json:"required"`
	Group         string `json:"group"`
}

var directExportBaseFields = []ExportField{
	{Name: "ID", ReferenceName: "System.Id", Type: "integer", Required: true},
	{Name: "Work Item Type", ReferenceName: "System.WorkItemType", Type: "string", Required: true},
	{Name: "Title", ReferenceName: "System.Title", Type: "string", Required: true},
}

var detailExportFieldOrder = []string{
	"System.Id",
	"System.WorkItemType",
	"System.Title",
	exportStepsField,
	"System.State",
	"System.AssignedTo",
	"Microsoft.VSTS.Common.Priority",
	"System.AreaPath",
	"System.IterationPath",
	"Microsoft.VSTS.TCM.AutomationStatus",
	"System.ChangedDate",
	"System.Tags",
	"System.Description",
	"System.Rev",
}

func (c *Connector) ListExportFields(
	ctx context.Context,
	accessToken, organizationName, projectID string,
) ([]ExportField, error) {
	if accessToken == "" || organizationName == "" || projectID == "" {
		return nil, invalidContentQuery("access token, organization, and project are required")
	}

	var definitions struct {
		Value []struct {
			ExportField
			Usage     string `json:"usage"`
			IsDeleted bool   `json:"isDeleted"`
		} `json:"value"`
	}
	err := c.readExportMetadata(
		ctx,
		accessToken,
		organizationName,
		projectID,
		"_apis/wit/fields",
		url.Values{"$expand": {"extensionFields"}},
		&definitions,
	)
	if err != nil {
		return nil, err
	}

	fields := make([]ExportField, 0, len(definitions.Value))
	seen := make(map[string]bool, len(definitions.Value))
	for _, definition := range definitions.Value {
		if definition.IsDeleted || seen[definition.ReferenceName] {
			continue
		}
		if definition.ReferenceName == "" || definition.Name == "" {
			continue
		}
		switch definition.Usage {
		case "", "workItem", "workItemTypeExtension":
		default:
			continue
		}

		field := definition.ExportField
		field.Group = ExportFieldGroupOther
		if slices.Contains(detailExportFieldOrder, field.ReferenceName) {
			field.Group = ExportFieldGroupDetail
		}
		field.Required = false
		for _, base := range directExportBaseFields {
			field.Required = field.Required || field.ReferenceName == base.ReferenceName
		}
		seen[field.ReferenceName] = true
		fields = append(fields, field)
	}
	slices.SortFunc(fields, compareExportFields)
	return fields, nil
}

func compareExportFields(left, right ExportField) int {
	if left.Group != right.Group {
		return strings.Compare(left.Group, right.Group)
	}
	if left.Group == ExportFieldGroupDetail {
		return cmp.Compare(
			slices.Index(detailExportFieldOrder, left.ReferenceName),
			slices.Index(detailExportFieldOrder, right.ReferenceName),
		)
	}
	if order := strings.Compare(strings.ToLower(left.Name), strings.ToLower(right.Name)); order != 0 {
		return order
	}
	return strings.Compare(left.ReferenceName, right.ReferenceName)
}

func (c *Connector) readExportMetadata(
	ctx context.Context,
	accessToken, organizationName, projectID, path string,
	values url.Values,
	target any,
) error {
	endpoint := c.projectEndpoint(organizationName, projectID, path, restAPIVersion, values)
	request, err := c.bearerRequest(ctx, http.MethodGet, endpoint, accessToken, nil)
	if err != nil {
		return err
	}
	return c.doJSON(request, target)
}
