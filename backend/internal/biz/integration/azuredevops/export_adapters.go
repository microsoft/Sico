package azuredevops

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"
)

type exportFieldAdapter func(savedWorkItem) (string, error)

type exportFieldAdapters map[string]exportFieldAdapter

func (adapters exportFieldAdapters) format(item savedWorkItem, field ExportField) (string, error) {
	if adapter := adapters[field.ReferenceName]; adapter != nil {
		return adapter(item)
	}
	return exportFieldText(item.Fields[field.ReferenceName], field)
}

func defaultExportFieldAdapters() exportFieldAdapters {
	return exportFieldAdapters{
		"System.Id": func(item savedWorkItem) (string, error) {
			return strconv.FormatInt(item.ID, 10), nil
		},
	}
}

func (c *Connector) prepareExportFieldAdapters(
	ctx context.Context,
	accessToken, organizationName, projectID string,
	snapshot *queryExportSnapshot,
) (exportFieldAdapters, error) {
	adapters := defaultExportFieldAdapters()
	if !slices.ContainsFunc(snapshot.Fields, func(field ExportField) bool {
		return field.ReferenceName == exportStepsField
	}) {
		return adapters, nil
	}

	adapter, err := c.prepareStepsFieldAdapter(ctx, accessToken, organizationName, projectID, snapshot)
	if err != nil {
		return nil, err
	}
	adapters[exportStepsField] = adapter
	return adapters, nil
}

func exportFieldText(value any, field ExportField) (string, error) {
	if value == nil {
		return "", nil
	}
	if text, ok := value.(string); ok {
		if field.Type == "html" || field.Type == "history" {
			return exportMarkupText(text), nil
		}
		return text, nil
	}
	if identity, ok := value.(map[string]any); ok && (field.Type == "identity" || field.IsIdentity) {
		name, _ := identity["displayName"].(string)
		uniqueName, _ := identity["uniqueName"].(string)
		if name != "" && uniqueName != "" && name != uniqueName {
			return name + " <" + uniqueName + ">", nil
		}
		if name != "" {
			return name, nil
		}
		if uniqueName != "" {
			return uniqueName, nil
		}
	}
	content, err := json.Marshal(value)
	if err != nil {
		return "", invalidContentQuery("work item field cannot be represented as JSON: " + err.Error())
	}
	return string(content), nil
}
