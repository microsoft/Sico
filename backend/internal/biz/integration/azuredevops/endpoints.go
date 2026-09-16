package azuredevops

import (
	"net/url"
	"strconv"
	"strings"
)

const (
	restAPIVersion     = "7.1"
	testPlanAPIVersion = "7.1-preview.1"
	testCaseAPIVersion = "7.1-preview.3"
)

func serviceEndpoint(
	baseURL, path, apiVersion string,
	values url.Values,
) string {
	query := make(url.Values, len(values)+1)
	for name, entries := range values {
		query[name] = entries
	}
	query.Set("api-version", apiVersion)

	return strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(path, "/") + "?" + query.Encode()
}

func (c *Connector) organizationEndpoint(
	organizationName, path, apiVersion string,
	values url.Values,
) string {
	return serviceEndpoint(
		c.config.DevAzureBaseURL,
		url.PathEscape(organizationName)+"/"+strings.TrimLeft(path, "/"),
		apiVersion,
		values,
	)
}

func (c *Connector) projectEndpoint(
	organizationName, projectID, path, apiVersion string,
	values url.Values,
) string {
	return c.organizationEndpoint(
		organizationName,
		url.PathEscape(projectID)+"/"+strings.TrimLeft(path, "/"),
		apiVersion,
		values,
	)
}

func (c *Connector) oauthEndpoint(tenant, operation string) string {
	return strings.TrimRight(c.config.AuthorityURL, "/") + "/" + url.PathEscape(tenant) +
		"/oauth2/v2.0/" + operation
}

func (c *Connector) workItemURL(
	organizationName, projectID string,
	workItemID int64,
) string {
	return strings.TrimRight(c.config.DevAzureBaseURL, "/") + "/" + url.PathEscape(organizationName) +
		"/" + url.PathEscape(projectID) + "/_workitems/edit/" + strconv.FormatInt(workItemID, 10)
}

func projectContentListEndpoint(query ContentQuery) (string, string, error) {
	switch query.Kind {
	case ContentKindRepositories:
		return "_apis/git/repositories", restAPIVersion, nil
	case ContentKindTestPlans:
		return "_apis/testplan/plans", testPlanAPIVersion, nil
	case ContentKindTestCases:
		if query.PlanID <= 0 || query.SuiteID <= 0 {
			return "", "", invalidContentQuery("planId and suiteId are required for test cases")
		}

		path := "_apis/testplan/Plans/" + strconv.FormatInt(query.PlanID, 10) +
			"/Suites/" + strconv.FormatInt(query.SuiteID, 10) + "/TestCase"
		return path, testCaseAPIVersion, nil
	case ContentKindPipelines:
		return "_apis/pipelines", restAPIVersion, nil
	case ContentKindPipelineRuns:
		if query.PipelineID <= 0 {
			return "", "", invalidContentQuery("pipelineId is required for pipeline runs")
		}

		path := "_apis/pipelines/" + strconv.FormatInt(query.PipelineID, 10) + "/runs"
		return path, restAPIVersion, nil
	default:
		return "", "", invalidContentQuery("unsupported Azure DevOps content kind")
	}
}
