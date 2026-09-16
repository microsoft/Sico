package azuredevops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const (
	ContentKindWorkItems    = "work_items"
	ContentKindRepositories = "repositories"
	ContentKindTestPlans    = "test_plans"
	ContentKindTestCases    = "test_cases"
	ContentKindPipelines    = "pipelines"
	ContentKindPipelineRuns = "pipeline_runs"
	ContentKindSavedQueries = "saved_queries"
	ContentKindQueryResults = "saved_query_results"
	ContentKindWorkItem     = "work_item_detail"
)

const (
	defaultContentLimit int32 = 50
	maxContentPages     int   = 10
)

var ErrInvalidContentQuery = errors.New("invalid Azure DevOps content query")

type ContentQuery struct {
	Kind         string
	Search       string
	WorkItemType string
	State        string
	AssignedTo   string
	PlanID       int64
	SuiteID      int64
	PipelineID   int64
	Top          int32
	QueryID      string
	WorkItemID   int64
	Offset       int32
	AsOf         string
}

func (c *Connector) QueryProjectContent(
	ctx context.Context,
	accessToken, organizationName, projectID string,
	query ContentQuery,
) ([]map[string]any, error) {
	if accessToken == "" || organizationName == "" || projectID == "" {
		return nil, errors.New("access token, organization, and project are required")
	}
	if query.Top == 0 {
		query.Top = defaultContentLimit
	}
	if query.Top < 1 || query.Top > 100 {
		return nil, invalidContentQuery("content result limit must be between 1 and 100")
	}

	if query.Kind == ContentKindWorkItems {
		return c.queryWorkItems(ctx, accessToken, organizationName, projectID, query)
	}
	path, apiVersion, err := projectContentListEndpoint(query)
	if err != nil {
		return nil, err
	}
	return c.listProjectContent(
		ctx, accessToken, organizationName, projectID, path, apiVersion, query.Search, query.Top,
	)
}

func invalidContentQuery(message string) error {
	return fmt.Errorf("%w: %s", ErrInvalidContentQuery, message)
}

func (c *Connector) queryWorkItems(
	ctx context.Context,
	accessToken, organizationName, projectID string,
	query ContentQuery,
) ([]map[string]any, error) {
	clauses := []string{"[System.TeamProject] = @project"}
	if query.Search != "" {
		clauses = append(clauses, "[System.Title] CONTAINS '"+escapeWIQL(query.Search)+"'")
	}
	if query.WorkItemType != "" {
		clauses = append(clauses, "[System.WorkItemType] = '"+escapeWIQL(query.WorkItemType)+"'")
	}
	if query.State != "" {
		clauses = append(clauses, "[System.State] = '"+escapeWIQL(query.State)+"'")
	}
	if query.AssignedTo != "" {
		clauses = append(clauses, "[System.AssignedTo] CONTAINS '"+escapeWIQL(query.AssignedTo)+"'")
	}
	wiql := "SELECT [System.Id] FROM WorkItems WHERE " + strings.Join(clauses, " AND ") +
		" ORDER BY [System.ChangedDate] DESC"
	queryValues := url.Values{
		"$top": {strconv.FormatInt(int64(query.Top), 10)},
	}
	endpoint := c.projectEndpoint(organizationName, projectID, "_apis/wit/wiql", restAPIVersion, queryValues)
	request, err := c.bearerRequest(ctx, http.MethodPost, endpoint, accessToken, map[string]string{"query": wiql})
	if err != nil {
		return nil, err
	}
	var references struct {
		WorkItems []struct {
			ID int64 `json:"id"`
		} `json:"workItems"`
	}
	if err := c.doJSON(request, &references); err != nil {
		return nil, err
	}
	if len(references.WorkItems) == 0 {
		return []map[string]any{}, nil
	}
	ids := make([]string, 0, len(references.WorkItems))
	for _, workItem := range references.WorkItems {
		if workItem.ID > 0 {
			ids = append(ids, strconv.FormatInt(workItem.ID, 10))
		}
	}
	if len(ids) == 0 {
		return []map[string]any{}, nil
	}
	detailValues := url.Values{
		"ids": {strings.Join(ids, ",")},
		"fields": {
			"System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo," +
				"System.ChangedDate,System.Tags",
		},
		"errorPolicy": {"Omit"},
	}
	return c.fetchContentItems(
		ctx,
		accessToken,
		c.projectEndpoint(organizationName, projectID, "_apis/wit/workitems", restAPIVersion, detailValues),
		"",
		query.Top,
	)
}

func (c *Connector) listProjectContent(
	ctx context.Context,
	accessToken, organizationName, projectID, path, apiVersion, search string,
	top int32,
) ([]map[string]any, error) {
	values := url.Values{}
	if path == "_apis/pipelines" {
		values.Set("$top", strconv.FormatInt(int64(top), 10))
	}
	return c.fetchContentItems(
		ctx,
		accessToken,
		c.projectEndpoint(organizationName, projectID, path, apiVersion, values),
		search,
		top,
	)
}

func (c *Connector) fetchContentItems(
	ctx context.Context, accessToken, endpoint, search string, top int32,
) ([]map[string]any, error) {
	search = strings.ToLower(strings.TrimSpace(search))
	result := make([]map[string]any, 0, int(top))
	continuationTokens := make(map[string]struct{})
	nextEndpoint := endpoint
	for page := 0; page < maxContentPages && len(result) < int(top); page++ {
		request, err := c.bearerRequest(ctx, http.MethodGet, nextEndpoint, accessToken, nil)
		if err != nil {
			return nil, err
		}
		var response struct {
			Value []map[string]any `json:"value"`
		}
		headers, err := c.doJSONWithHeaders(request, &response)
		if err != nil {
			return nil, err
		}
		result = appendMatchingContentItems(result, response.Value, search, int(top))
		nextEndpoint, err = nextContentEndpoint(nextEndpoint, headers, continuationTokens)
		if err != nil {
			return nil, err
		}
		if nextEndpoint == "" {
			break
		}
	}
	return result, nil
}

func appendMatchingContentItems(
	result, items []map[string]any, search string, limit int,
) []map[string]any {
	for _, item := range items {
		sanitizeContentValue(item)
		if search != "" && !contentItemMatches(item, search) {
			continue
		}
		result = append(result, item)
		if len(result) == limit {
			break
		}
	}
	return result
}

func nextContentEndpoint(
	endpoint string, headers http.Header, continuationTokens map[string]struct{},
) (string, error) {
	continuationToken := strings.TrimSpace(headers.Get("x-ms-continuationtoken"))
	if continuationToken == "" {
		return "", nil
	}
	if _, duplicate := continuationTokens[continuationToken]; duplicate {
		return "", nil
	}
	continuationTokens[continuationToken] = struct{}{}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	values := parsed.Query()
	values.Set("continuationToken", continuationToken)
	parsed.RawQuery = values.Encode()
	return parsed.String(), nil
}

func sanitizeContentValue(value any) {
	switch typed := value.(type) {
	case map[string]any:
		if secret, _ := typed["isSecret"].(bool); secret {
			delete(typed, "value")
		}
		for key, child := range typed {
			if sensitiveContentKey(key) {
				delete(typed, key)
				continue
			}
			sanitizeContentValue(child)
		}
	case []any:
		for _, child := range typed {
			sanitizeContentValue(child)
		}
	}
}

func sensitiveContentKey(key string) bool {
	normalized := strings.ToLower(strings.NewReplacer(
		"_", "", "-", "", ".", "", " ", "",
	).Replace(key))
	if strings.HasSuffix(normalized, "token") || strings.Contains(normalized, "secret") ||
		strings.Contains(normalized, "password") || strings.Contains(normalized, "authorization") ||
		strings.Contains(normalized, "credential") {
		return true
	}
	switch normalized {
	case "apikey", "privatekey", "connectionstring", "pat":
		return true
	default:
		return false
	}
}

func contentItemMatches(item map[string]any, search string) bool {
	data, err := json.Marshal(item)
	return err == nil && strings.Contains(strings.ToLower(string(data)), search)
}

func escapeWIQL(value string) string {
	return strings.ReplaceAll(strings.TrimSpace(value), "'", "''")
}
