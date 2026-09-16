package azuredevops

import (
	"context"
	"time"
)

const ExportSourceWorkItems = "work_items"

type ExportOptions struct {
	ColumnOptions []string
}

type queryExportSnapshot struct {
	Definition  *savedQueryDefinition
	Result      *savedQueryResult
	IDs         []int64
	Items       []savedWorkItem
	Fields      []ExportField
	ProjectName string
}

func (c *Connector) ExportSavedQueryFile(
	ctx context.Context,
	accessToken string,
	project ResolvedProject,
	queryID string,
	options ExportOptions,
) (*QueryExport, error) {
	if project.ID == "" || project.Name == "" || project.OrganizationName == "" {
		return nil, invalidContentQuery("a resolved Azure DevOps project is required")
	}

	if len(options.ColumnOptions) > 100 {
		return nil, invalidContentQuery("select at most 100 export fields")
	}

	snapshot, err := c.prepareQueryExport(ctx, accessToken, project, queryID, options)
	if err != nil {
		return nil, err
	}

	export, err := c.exportQuerySnapshot(
		ctx,
		accessToken,
		project.OrganizationName,
		project.ID,
		snapshot,
	)
	if err != nil {
		return nil, err
	}

	exportedAt := time.Now().UTC()
	export.ContentType = XLSXContentType
	export.FileExt = "xlsx"
	export.FileName = "ado-query-" + queryID + "-" + exportedAt.Format("20060102-150405") + ".xlsx"
	export.QueryID = queryID
	export.QueryName = snapshot.Definition.Name
	export.QueryPath = snapshot.Definition.Path
	export.QueryAsOf = snapshot.Result.AsOf
	export.ExportedAt = exportedAt.Format(time.RFC3339)
	export.Count = len(snapshot.IDs)

	return export, nil
}

func (c *Connector) prepareQueryExport(
	ctx context.Context,
	accessToken string,
	project ResolvedProject,
	queryID string,
	options ExportOptions,
) (*queryExportSnapshot, error) {
	organizationName, projectID, projectName := project.OrganizationName, project.ID, project.Name
	query := ContentQuery{QueryID: queryID, Top: 1}
	if err := validateSavedQueryRequest(accessToken, organizationName, projectID, query); err != nil {
		return nil, err
	}

	definition, result, err := c.executeSavedQuery(ctx, accessToken, organizationName, projectID, queryID)
	if err != nil {
		return nil, err
	}

	ids, err := flatExportIDs(result)
	if err != nil {
		return nil, err
	}
	if _, err := time.Parse(time.RFC3339Nano, result.AsOf); err != nil {
		return nil, invalidContentQuery("saved query did not return a valid asOf snapshot timestamp")
	}

	catalog, err := c.ListExportFields(ctx, accessToken, organizationName, projectID)
	if err != nil {
		return nil, err
	}

	fields, err := selectedDirectExportFields(catalog, options.ColumnOptions)
	if err != nil {
		return nil, err
	}

	items, err := c.readExportWorkItems(
		ctx,
		accessToken,
		organizationName,
		projectID,
		projectName,
		result.AsOf,
		ids,
		exportReadFields(fields),
	)
	if err != nil {
		return nil, err
	}

	return &queryExportSnapshot{
		Definition:  definition,
		Result:      result,
		IDs:         ids,
		Items:       items,
		Fields:      fields,
		ProjectName: projectName,
	}, nil
}

func flatExportIDs(result *savedQueryResult) ([]int64, error) {
	if result.QueryType != "flat" {
		return nil, invalidContentQuery("export supports only flat saved queries; linked and tree queries are rejected")
	}
	if len(result.WorkItems) == 0 || len(result.WorkItems) > MaxExportWorkItems {
		return nil, invalidContentQuery("export requires between 1 and 5000 work items")
	}

	ids := make([]int64, 0, len(result.WorkItems))
	seen := make(map[int64]bool, len(result.WorkItems))
	for _, reference := range result.WorkItems {
		if reference.ID <= 0 || seen[reference.ID] {
			return nil, invalidContentQuery("saved query returned invalid or duplicate work item IDs")
		}

		seen[reference.ID] = true
		ids = append(ids, reference.ID)
	}

	return ids, nil
}

func (c *Connector) exportQuerySnapshot(
	ctx context.Context,
	accessToken, organizationName, projectID string,
	snapshot *queryExportSnapshot,
) (*QueryExport, error) {
	adapters, err := c.prepareExportFieldAdapters(
		ctx,
		accessToken,
		organizationName,
		projectID,
		snapshot,
	)
	if err != nil {
		return nil, err
	}

	rows, err := directWorkItemsRows(snapshot.Items, snapshot.Fields, adapters)
	if err != nil {
		return nil, err
	}
	content, err := exportWorkbook(rows)
	if err != nil {
		return nil, err
	}

	return &QueryExport{Content: content, ExportSource: ExportSourceWorkItems}, nil
}
