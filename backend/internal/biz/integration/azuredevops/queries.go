package azuredevops

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"
)

type ContentPage struct {
	Items    []map[string]any
	Metadata map[string]any
}

type savedWorkItemReference struct {
	ID int64 `json:"id"`
}

type savedWorkItem struct {
	ID     int64          `json:"id"`
	Rev    int32          `json:"rev"`
	Fields map[string]any `json:"fields"`
}

type savedQueryDefinition struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Path     string `json:"path"`
	IsFolder bool   `json:"isFolder"`
}

type savedQueryColumn struct {
	Name          string `json:"name"`
	ReferenceName string `json:"referenceName"`
}

type savedQueryRelation struct {
	Source *savedWorkItemReference `json:"source"`
	Target *savedWorkItemReference `json:"target"`
	Rel    string                  `json:"rel"`
}

type savedQueryResult struct {
	QueryType string                   `json:"queryType"`
	AsOf      string                   `json:"asOf"`
	Columns   []savedQueryColumn       `json:"columns"`
	WorkItems []savedWorkItemReference `json:"workItems"`
	Relations []savedQueryRelation     `json:"workItemRelations"`
}

func (c *Connector) QueryProjectContentPage(
	ctx context.Context,
	accessToken string,
	project ResolvedProject,
	query ContentQuery,
) (*ContentPage, error) {
	if project.ID == "" || project.Name == "" || project.OrganizationName == "" {
		return nil, invalidContentQuery("a resolved Azure DevOps project is required")
	}

	if query.Top == 0 {
		query.Top = defaultContentLimit
	}
	if query.Top < 1 || query.Top > 100 || query.Offset < 0 || query.Offset > 20000 {
		return nil, invalidContentQuery("invalid content page")
	}

	switch query.Kind {
	case ContentKindSavedQueries:
		items, err := c.ListSavedQueries(ctx, accessToken, project.OrganizationName, project.ID, query.QueryID)
		return &ContentPage{Items: items}, err
	case ContentKindQueryResults:
		return c.runSavedQuery(ctx, accessToken, project, query)
	case ContentKindWorkItem:
		item, err := c.getWorkItemDetails(ctx, accessToken, project, query.WorkItemID, query.AsOf)
		if err != nil {
			return nil, err
		}

		return &ContentPage{Items: []map[string]any{item}}, nil
	default:
		items, err := c.QueryProjectContent(ctx, accessToken, project.OrganizationName, project.ID, query)
		return &ContentPage{Items: items}, err
	}
}

func (c *Connector) ListSavedQueries(
	ctx context.Context,
	accessToken, organizationName, projectID, folderID string,
) ([]map[string]any, error) {
	if accessToken == "" || organizationName == "" || projectID == "" {
		return nil, invalidContentQuery("access token, organization, and project are required")
	}

	path := "_apis/wit/queries"
	if folderID != "" {
		if err := validateSavedQueryID(folderID); err != nil {
			return nil, err
		}

		path += "/" + url.PathEscape(folderID)
	}

	endpoint := c.projectEndpoint(
		organizationName,
		projectID,
		path,
		restAPIVersion,
		url.Values{
			"$depth":  {"1"},
			"$expand": {"minimal"},
		},
	)
	request, err := c.bearerRequest(ctx, http.MethodGet, endpoint, accessToken, nil)
	if err != nil {
		return nil, err
	}

	var response struct {
		Value    []map[string]any `json:"value"`
		Children []map[string]any `json:"children"`
		IsFolder bool             `json:"isFolder"`
	}
	if err := c.doJSON(request, &response); err != nil {
		return nil, err
	}

	items := response.Value
	if folderID != "" {
		if !response.IsFolder {
			return nil, invalidContentQuery("selected query is not a folder")
		}

		items = response.Children
	}

	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		summary := make(map[string]any)
		for _, key := range []string{
			"id", "name", "path", "isFolder", "hasChildren", "queryType", "isPublic", "isInvalidSyntax",
		} {
			if value, exists := item[key]; exists {
				summary[key] = value
			}
		}
		result = append(result, summary)
	}

	return result, nil
}

func (c *Connector) runSavedQuery(
	ctx context.Context,
	accessToken string,
	project ResolvedProject,
	query ContentQuery,
) (*ContentPage, error) {
	organizationName, projectID, projectName := project.OrganizationName, project.ID, project.Name
	if err := validateSavedQueryRequest(accessToken, organizationName, projectID, query); err != nil {
		return nil, err
	}

	definition, result, err := c.executeSavedQuery(ctx, accessToken, organizationName, projectID, query.QueryID)
	if err != nil {
		return nil, err
	}

	ids := savedQueryResultIDs(result)
	if len(ids) > 20000 {
		return nil, invalidContentQuery("saved query exceeds the 20000-work-item limit")
	}

	visible, err := c.savedQueryProjectMembership(
		ctx,
		accessToken,
		organizationName,
		projectID,
		projectName,
		ids,
		result.AsOf,
	)
	if err != nil {
		return nil, err
	}

	visibleIDs := make([]int64, 0, len(visible))
	for _, id := range ids {
		if visible[id] {
			visibleIDs = append(visibleIDs, id)
		}
	}

	fields, columns := savedQueryFields(result.Columns)
	start := min(int(query.Offset), len(visibleIDs))
	end := min(start+int(query.Top), len(visibleIDs))
	pageIDs := visibleIDs[start:end]

	items, err := c.readSavedWorkItems(
		ctx,
		accessToken,
		organizationName,
		projectID,
		pageIDs,
		fields,
		result.AsOf,
	)
	if err != nil {
		return nil, err
	}
	if err := validateSavedQueryBatch(items, pageIDs, projectName); err != nil {
		return nil, err
	}

	return &ContentPage{
		Items: c.orderedSavedWorkItems(organizationName, projectID, pageIDs, items),
		Metadata: map[string]any{
			"queryId":          definition.ID,
			"queryName":        definition.Name,
			"queryPath":        definition.Path,
			"queryType":        result.QueryType,
			"asOf":             result.AsOf,
			"columns":          columns,
			"relations":        savedQueryRelations(result.Relations, visible),
			"total":            len(visibleIDs),
			"offset":           start,
			"nextOffset":       end,
			"hasNext":          end < len(visibleIDs),
			"unavailableCount": len(ids) - len(visibleIDs),
		},
	}, nil
}

func (c *Connector) executeSavedQuery(
	ctx context.Context,
	accessToken, organizationName, projectID, queryID string,
) (*savedQueryDefinition, *savedQueryResult, error) {
	endpoint := c.projectEndpoint(
		organizationName,
		projectID,
		"_apis/wit/queries/"+url.PathEscape(queryID),
		restAPIVersion,
		nil,
	)
	request, err := c.bearerRequest(ctx, http.MethodGet, endpoint, accessToken, nil)
	if err != nil {
		return nil, nil, err
	}

	var definition savedQueryDefinition
	if err := c.doJSON(request, &definition); err != nil {
		return nil, nil, err
	}
	if definition.IsFolder || !strings.EqualFold(definition.ID, queryID) {
		return nil, nil, invalidContentQuery("select a saved query, not a folder")
	}

	endpoint = c.projectEndpoint(
		organizationName,
		projectID,
		"_apis/wit/wiql/"+url.PathEscape(queryID),
		restAPIVersion,
		nil,
	)
	request, err = c.bearerRequest(ctx, http.MethodGet, endpoint, accessToken, nil)
	if err != nil {
		return nil, nil, err
	}

	var result savedQueryResult
	if err := c.doJSON(request, &result); err != nil {
		return nil, nil, err
	}

	return &definition, &result, nil
}

func savedQueryResultIDs(result *savedQueryResult) []int64 {
	ids := make([]int64, 0, len(result.WorkItems))
	seen := make(map[int64]bool)
	appendID := func(id int64) {
		if id > 0 && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, reference := range result.WorkItems {
		appendID(reference.ID)
	}
	for _, relation := range result.Relations {
		if relation.Source != nil {
			appendID(relation.Source.ID)
		}
		if relation.Target != nil {
			appendID(relation.Target.ID)
		}
	}
	return ids
}

func savedQueryFields(queryColumns []savedQueryColumn) ([]string, []any) {
	fields := []string{"System.TeamProject", "System.Title", "System.WorkItemType", "System.State", "System.AssignedTo"}
	fieldSet := make(map[string]bool)
	for _, field := range fields {
		fieldSet[field] = true
	}
	columns := make([]any, 0, len(queryColumns))
	for _, column := range queryColumns {
		if column.ReferenceName == "" {
			continue
		}
		columns = append(columns, map[string]any{"name": column.Name, "referenceName": column.ReferenceName})
		if !fieldSet[column.ReferenceName] {
			fieldSet[column.ReferenceName] = true
			fields = append(fields, column.ReferenceName)
		}
	}
	return fields, columns
}

func (c *Connector) orderedSavedWorkItems(
	organizationName, projectID string,
	pageIDs []int64,
	items []savedWorkItem,
) []map[string]any {
	byID := make(map[int64]savedWorkItem, len(items))
	for _, item := range items {
		byID[item.ID] = item
	}
	pageItems := make([]map[string]any, 0, len(pageIDs))
	for _, id := range pageIDs {
		if item, exists := byID[id]; exists {
			pageItems = append(pageItems, c.savedWorkItemContent(organizationName, projectID, item))
		}
	}
	return pageItems
}

func savedQueryRelations(queryRelations []savedQueryRelation, visible map[int64]bool) []any {
	relations := make([]any, 0, len(queryRelations))
	for _, relation := range queryRelations {
		if relation.Target == nil || !visible[relation.Target.ID] {
			continue
		}
		var sourceID int64
		if relation.Source != nil {
			if !visible[relation.Source.ID] {
				continue
			}
			sourceID = relation.Source.ID
		}
		relations = append(relations, map[string]any{
			"sourceId": sourceID, "targetId": relation.Target.ID, "rel": relation.Rel,
		})
	}
	return relations
}

func validateSavedQueryRequest(
	accessToken, organizationName, projectID string,
	query ContentQuery,
) error {
	if accessToken == "" || organizationName == "" || projectID == "" || query.QueryID == "" {
		return invalidContentQuery("access token, organization, project, and queryId are required")
	}
	if query.Top < 1 || query.Top > 100 || query.Offset < 0 || query.Offset > 20000 {
		return invalidContentQuery("invalid saved query page")
	}
	return validateSavedQueryID(query.QueryID)
}

func validateSavedQueryID(queryID string) error {
	parsed, err := uuid.Parse(queryID)
	if err != nil || !strings.EqualFold(parsed.String(), queryID) || parsed == uuid.Nil {
		return invalidContentQuery("queryId must be a nonzero UUID")
	}
	return nil
}

func (c *Connector) savedQueryProjectMembership(
	ctx context.Context,
	accessToken, organizationName, projectID, projectName string,
	ids []int64,
	asOf string,
) (map[int64]bool, error) {
	group, groupContext := errgroup.WithContext(ctx)
	group.SetLimit(4)
	batches := make([][]savedWorkItem, (len(ids)+199)/200)
	for start := 0; start < len(ids); start += 200 {
		batchIndex := start / 200
		batchIDs := ids[start:min(start+200, len(ids))]
		group.Go(func() error {
			items, err := c.readSavedWorkItems(
				groupContext, accessToken, organizationName, projectID,
				batchIDs, []string{"System.TeamProject"}, asOf,
			)
			if err != nil {
				return err
			}
			if err := validateSavedQueryBatch(items, batchIDs, projectName); err != nil {
				return err
			}
			batches[batchIndex] = items
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return nil, err
	}
	visible := make(map[int64]bool, len(ids))
	for _, batch := range batches {
		for _, item := range batch {
			visible[item.ID] = true
		}
	}
	return visible, nil
}

func validateSavedQueryBatch(items []savedWorkItem, ids []int64, projectName string) error {
	requested := make(map[int64]bool, len(ids))
	for _, id := range ids {
		requested[id] = true
	}
	for _, item := range items {
		if !requested[item.ID] {
			return errors.New("azure DevOps returned an unexpected work item")
		}
		if err := validateWorkItemProject(item, projectName); err != nil {
			return err
		}
	}
	return nil
}

func (c *Connector) getWorkItemDetails(
	ctx context.Context,
	accessToken string,
	project ResolvedProject,
	workItemID int64,
	asOf string,
) (map[string]any, error) {
	organizationName, projectID, projectName := project.OrganizationName, project.ID, project.Name
	if accessToken == "" || organizationName == "" || projectID == "" || workItemID <= 0 {
		return nil, invalidContentQuery("access token, organization, project, and workItemId are required")
	}
	if asOf != "" {
		if _, err := time.Parse(time.RFC3339Nano, asOf); err != nil {
			return nil, invalidContentQuery("asOf must be an RFC3339 timestamp")
		}
	}

	items, err := c.readSavedWorkItems(
		ctx,
		accessToken,
		organizationName,
		projectID,
		[]int64{workItemID},
		[]string{
			"System.TeamProject",
			"System.Title",
			"System.WorkItemType",
			"System.State",
			"System.AssignedTo",
			"System.AreaPath",
			"System.IterationPath",
			"System.Tags",
			"System.Description",
			"System.ChangedDate",
			"Microsoft.VSTS.Common.Priority",
			"Microsoft.VSTS.TCM.Steps",
			"Microsoft.VSTS.TCM.Parameters",
			"Microsoft.VSTS.TCM.LocalDataSource",
			"Microsoft.VSTS.TCM.AutomationStatus",
			"Microsoft.VSTS.TCM.AutomatedTestName",
		},
		asOf,
	)
	if err != nil {
		return nil, err
	}
	if len(items) != 1 || items[0].ID != workItemID {
		return nil, invalidContentQuery("work item is unavailable")
	}
	if err := validateWorkItemProject(items[0], projectName); err != nil {
		return nil, err
	}

	return c.savedWorkItemContent(organizationName, projectID, items[0]), nil
}

func (c *Connector) contentProjectName(
	ctx context.Context,
	accessToken, organizationName, projectID string,
) (string, error) {
	endpoint := c.organizationEndpoint(
		organizationName,
		"_apis/projects/"+url.PathEscape(projectID),
		restAPIVersion,
		nil,
	)
	request, err := c.bearerRequest(ctx, http.MethodGet, endpoint, accessToken, nil)
	if err != nil {
		return "", err
	}

	var project Project
	if err := c.doJSON(request, &project); err != nil {
		return "", err
	}
	if !strings.EqualFold(project.ID, projectID) || project.Name == "" {
		return "", errors.New("azure DevOps returned an unexpected project")
	}

	return project.Name, nil
}

func (c *Connector) readSavedWorkItems(
	ctx context.Context,
	accessToken, organizationName, projectID string,
	ids []int64,
	fields []string,
	asOf string,
) ([]savedWorkItem, error) {
	if len(ids) == 0 {
		return []savedWorkItem{}, nil
	}

	values := make([]string, len(ids))
	for index, id := range ids {
		values[index] = strconv.FormatInt(id, 10)
	}

	query := url.Values{
		"ids":         {strings.Join(values, ",")},
		"fields":      {strings.Join(fields, ",")},
		"errorPolicy": {"Omit"},
	}
	if asOf != "" {
		query.Set("asOf", asOf)
	}

	request, err := c.bearerRequest(
		ctx,
		http.MethodGet,
		c.projectEndpoint(organizationName, projectID, "_apis/wit/workitems", restAPIVersion, query),
		accessToken,
		nil,
	)
	if err != nil {
		return nil, err
	}

	var response struct {
		Value []savedWorkItem `json:"value"`
	}
	if err := c.doJSON(request, &response); err != nil {
		return nil, err
	}

	return response.Value, nil
}

func validateWorkItemProject(item savedWorkItem, projectName string) error {
	actual, _ := item.Fields["System.TeamProject"].(string)
	if !strings.EqualFold(actual, projectName) {
		return invalidContentQuery("saved query or work item includes data outside the selected Azure DevOps project")
	}
	return nil
}

func (c *Connector) savedWorkItemContent(
	organizationName, projectID string,
	item savedWorkItem,
) map[string]any {
	content := map[string]any{
		"id":     item.ID,
		"rev":    item.Rev,
		"fields": item.Fields,
		"webUrl": c.workItemURL(organizationName, projectID, item.ID),
	}
	sanitizeContentValue(content)
	return content
}
