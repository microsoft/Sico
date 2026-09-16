package azuredevops

import (
	"context"
	"strconv"

	"golang.org/x/sync/errgroup"
)

const (
	exportStepsField     = "Microsoft.VSTS.TCM.Steps"
	maxExportSharedSteps = 1000
	maxExportSharedDepth = 8
)

func selectedDirectExportFields(catalog []ExportField, selected []string) ([]ExportField, error) {
	if len(selected) > 100 {
		return nil, invalidContentQuery("select at most 100 export fields")
	}

	available := make(map[string]ExportField, len(catalog))
	for _, field := range catalog {
		available[field.ReferenceName] = field
	}
	fields := make([]ExportField, 0, len(selected))
	seen := make(map[string]bool)
	for _, reference := range selected {
		field, exists := available[reference]
		if !exists {
			return nil, invalidContentQuery("export field is not available for this project: " + reference)
		}
		if !seen[reference] {
			fields = append(fields, field)
			seen[reference] = true
		}
	}

	for _, field := range directExportBaseFields {
		if !seen[field.ReferenceName] {
			return nil, invalidContentQuery("select required export field " + field.ReferenceName)
		}
	}
	return fields, nil
}

func exportReadFields(fields []ExportField) []string {
	references := []string{"System.TeamProject"}
	for _, field := range fields {
		if field.ReferenceName != "System.TeamProject" {
			references = append(references, field.ReferenceName)
		}
	}
	return references
}

func (c *Connector) readExportWorkItems(
	ctx context.Context,
	accessToken, organizationName, projectID, projectName, asOf string,
	ids []int64,
	fields []string,
) ([]savedWorkItem, error) {
	if len(ids) > MaxExportWorkItems {
		return nil, invalidContentQuery("export exceeds the 5000-work-item limit")
	}
	requested := make(map[int64]bool, len(ids))
	for _, id := range ids {
		if id <= 0 || requested[id] {
			return nil, invalidContentQuery("export requires unique positive work item IDs")
		}
		requested[id] = true
	}
	group, groupContext := errgroup.WithContext(ctx)
	group.SetLimit(4)
	batches := make([][]savedWorkItem, (len(ids)+199)/200)
	for start := 0; start < len(ids); start += 200 {
		batchIndex := start / 200
		batchIDs := ids[start:min(start+200, len(ids))]
		group.Go(func() error {
			items, err := c.readSavedWorkItems(
				groupContext, accessToken, organizationName, projectID, batchIDs, fields, asOf,
			)
			if err != nil {
				return err
			}
			if err := validateExportBatch(items, batchIDs, projectName); err != nil {
				return err
			}
			batches[batchIndex] = items
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return nil, err
	}
	byID := make(map[int64]savedWorkItem, len(ids))
	for _, batch := range batches {
		for _, item := range batch {
			byID[item.ID] = item
		}
	}
	items := make([]savedWorkItem, 0, len(ids))
	for _, id := range ids {
		items = append(items, byID[id])
	}
	return items, nil
}

func validateExportBatch(items []savedWorkItem, ids []int64, projectName string) error {
	requested := make(map[int64]bool, len(ids))
	for _, id := range ids {
		requested[id] = true
	}
	seen := make(map[int64]bool, len(items))
	for _, item := range items {
		if !requested[item.ID] || seen[item.ID] {
			return invalidContentQuery("Azure DevOps returned an unexpected or duplicate work item ID")
		}
		if err := validateWorkItemProject(item, projectName); err != nil {
			return err
		}
		if itemType, ok := item.Fields["System.WorkItemType"].(string); !ok || itemType == "" {
			return invalidContentQuery("Azure DevOps returned a work item without its type")
		}
		seen[item.ID] = true
	}
	if len(seen) != len(ids) {
		return invalidContentQuery("query work items are unavailable at the saved-query snapshot; no file was exported")
	}
	return nil
}

func (c *Connector) readExportSharedSteps(
	ctx context.Context,
	accessToken, organizationName, projectID, projectName, asOf string,
	roots map[int64][]exportStepNode,
) (map[string][]exportStepNode, error) {
	shared := make(map[string][]exportStepNode)
	seen := make(map[string]bool)
	var pending []int64
	for _, nodes := range roots {
		if err := collectExportSharedReferences(nodes, seen, &pending); err != nil {
			return nil, err
		}
	}
	for depth := 0; len(pending) > 0; depth++ {
		if depth >= maxExportSharedDepth {
			return nil, invalidContentQuery("shared steps exceed the 8-level depth limit")
		}
		items, err := c.readExportWorkItems(
			ctx,
			accessToken,
			organizationName,
			projectID,
			projectName,
			asOf,
			pending,
			[]string{"System.TeamProject", "System.WorkItemType", exportStepsField},
		)
		if err != nil {
			return nil, err
		}
		pending = nil
		for _, item := range items {
			nodes, err := parseExportSharedItem(item)
			if err != nil {
				return nil, err
			}
			reference := strconv.FormatInt(item.ID, 10)
			shared[reference] = nodes
			if err := collectExportSharedReferences(nodes, seen, &pending); err != nil {
				return nil, err
			}
		}
	}
	if err := validateExportSharedGraph(shared); err != nil {
		return nil, err
	}
	return shared, nil
}

func validateExportSharedGraph(shared map[string][]exportStepNode) error {
	depths := make(map[string]int)
	for reference := range shared {
		if _, err := exportSharedDepth(reference, shared, depths, map[string]bool{}); err != nil {
			return err
		}
	}
	return nil
}

func exportSharedDepth(
	reference string,
	shared map[string][]exportStepNode,
	depths map[string]int,
	parents map[string]bool,
) (int, error) {
	if parents[reference] || len(parents) >= maxExportSharedDepth {
		return 0, invalidContentQuery("shared steps are cyclic or exceed the 8-level depth limit")
	}
	if depth := depths[reference]; depth > 0 {
		return depth, nil
	}
	nodes, exists := shared[reference]
	if !exists {
		return 0, invalidContentQuery("shared steps are unavailable")
	}
	parents[reference] = true
	defer delete(parents, reference)
	depth := 1
	for _, node := range nodes {
		if node.XMLName.Local != "compref" {
			continue
		}
		childDepth, err := exportSharedDepth(node.Reference, shared, depths, parents)
		if err != nil {
			return 0, err
		}
		depth = max(depth, childDepth+1)
	}
	if depth > maxExportSharedDepth {
		return 0, invalidContentQuery("shared steps exceed the 8-level depth limit")
	}
	depths[reference] = depth
	return depth, nil
}

func parseExportSharedItem(item savedWorkItem) ([]exportStepNode, error) {
	if item.Fields["System.WorkItemType"] != "Shared Steps" {
		return nil, invalidContentQuery("referenced work item is not Shared Steps")
	}
	raw, ok := item.Fields[exportStepsField].(string)
	if !ok {
		return nil, invalidContentQuery("referenced shared-step XML is unavailable")
	}
	return parseExportSteps(raw)
}

func collectExportSharedReferences(
	nodes []exportStepNode,
	seen map[string]bool,
	pending *[]int64,
) error {
	for _, node := range nodes {
		if node.XMLName.Local != "compref" {
			continue
		}
		id, err := strconv.ParseInt(node.Reference, 10, 64)
		if err != nil || id <= 0 || strconv.FormatInt(id, 10) != node.Reference {
			return invalidContentQuery("shared-step reference must be a positive work item ID")
		}
		if !seen[node.Reference] {
			if len(seen) >= maxExportSharedSteps {
				return invalidContentQuery("shared steps exceed the 1000-dependency limit")
			}
			seen[node.Reference] = true
			*pending = append(*pending, id)
		}
	}
	return nil
}
