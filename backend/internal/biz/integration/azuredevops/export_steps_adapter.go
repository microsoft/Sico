package azuredevops

import (
	"context"
	"strings"
)

func (c *Connector) prepareStepsFieldAdapter(
	ctx context.Context,
	accessToken, organizationName, projectID string,
	snapshot *queryExportSnapshot,
) (exportFieldAdapter, error) {
	roots, err := exportCaseStepNodes(snapshot.Items, snapshot.Fields)
	if err != nil {
		return nil, err
	}
	shared, err := c.readExportSharedSteps(
		ctx,
		accessToken,
		organizationName,
		projectID,
		snapshot.ProjectName,
		snapshot.Result.AsOf,
		roots,
	)
	if err != nil {
		return nil, err
	}
	return stepsFieldAdapter(roots, shared), nil
}

func stepsFieldAdapter(
	roots map[int64][]exportStepNode,
	shared map[string][]exportStepNode,
) exportFieldAdapter {
	return func(item savedWorkItem) (string, error) {
		return exportStepsText(roots[item.ID], shared)
	}
}

func exportCaseStepNodes(items []savedWorkItem, fields []ExportField) (map[int64][]exportStepNode, error) {
	roots := make(map[int64][]exportStepNode)
	selected := false
	for _, field := range fields {
		selected = selected || field.ReferenceName == exportStepsField
	}
	if !selected {
		return roots, nil
	}
	for _, item := range items {
		raw, isText := item.Fields[exportStepsField].(string)
		if item.Fields[exportStepsField] != nil && !isText {
			return nil, invalidContentQuery("test-step XML must be text")
		}
		nodes, err := parseExportSteps(raw)
		if err != nil {
			return nil, err
		}
		roots[item.ID] = nodes
	}
	return roots, nil
}

func exportStepsText(nodes []exportStepNode, shared map[string][]exportStepNode) (string, error) {
	var text strings.Builder
	visitor := exportStepVisitor{
		shared:  shared,
		parents: map[string]bool{},
		emit: func(step exportStep) error {
			if text.Len() > 0 {
				text.WriteString("\n\n")
			}
			text.WriteString("Step " + step.Number)
			if step.SharedID != "" {
				text.WriteString("\nShared steps: #" + step.SharedID)
			}
			text.WriteString("\nAction: " + step.Action)
			text.WriteString("\nExpected result: " + step.Expected)
			if text.Len() > MaxExportBytes {
				return invalidContentQuery("test steps exceed the 8 MiB limit; narrow the saved query")
			}
			return nil
		},
	}
	if err := visitor.walk(nodes, "", ""); err != nil {
		return "", err
	}
	return text.String(), nil
}
