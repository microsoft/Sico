package azuredevops

import (
	"encoding/xml"
	"errors"
	"html"
	"io"
	"strconv"
	"strings"
)

type exportStepNode struct {
	XMLName    xml.Name
	Reference  string `xml:"ref,attr"`
	Parameters []struct {
		Value string `xml:",innerxml"`
	} `xml:"parameterizedString"`
	Children []exportStepNode `xml:",any"`
}

type exportStep struct {
	Number   string
	Action   string
	Expected string
	SharedID string
}

func parseExportSteps(value string) ([]exportStepNode, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	decoder := xml.NewDecoder(strings.NewReader(value))
	decoder.CharsetReader = func(charset string, input io.Reader) (io.Reader, error) {
		if strings.EqualFold(charset, "utf-16") || strings.EqualFold(charset, "utf-8") {
			return input, nil
		}
		return nil, errors.New("unsupported test-step XML charset")
	}
	var root exportStepNode
	if err := decoder.Decode(&root); err != nil {
		return nil, invalidContentQuery("test-step XML is malformed")
	}
	if root.XMLName.Local != "steps" {
		return nil, invalidContentQuery("test-step XML has an unexpected root")
	}
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, invalidContentQuery("test-step XML is malformed")
		}
		switch trailing := token.(type) {
		case xml.CharData:
			if strings.TrimSpace(string(trailing)) == "" {
				continue
			}
		case xml.Comment, xml.ProcInst:
			continue
		}
		return nil, invalidContentQuery("test-step XML has content after its root")
	}
	return root.Children, nil
}

type exportStepVisitor struct {
	shared  map[string][]exportStepNode
	parents map[string]bool
	emit    func(exportStep) error
}

func exportSteps(
	nodes []exportStepNode,
	shared map[string][]exportStepNode,
	prefix string,
	parents map[string]bool,
) ([]exportStep, error) {
	steps := make([]exportStep, 0, len(nodes))
	size := 0
	visitor := exportStepVisitor{shared: shared, parents: parents, emit: func(step exportStep) error {
		size += len(step.Number) + len(step.Action) + len(step.Expected) + len(step.SharedID) + 8
		if size > MaxExportBytes {
			return invalidContentQuery("test steps exceed the 8 MiB limit; narrow the saved query")
		}
		steps = append(steps, step)
		return nil
	}}
	if err := visitor.walk(nodes, prefix, ""); err != nil {
		return nil, err
	}
	return steps, nil
}

func (visitor *exportStepVisitor) walk(
	nodes []exportStepNode,
	prefix, sharedID string,
) error {
	for index, node := range nodes {
		number := prefix + strconv.Itoa(index+1)
		switch node.XMLName.Local {
		case "step":
			if len(node.Parameters) != 2 {
				return invalidContentQuery("test step must have action and expected-result fields")
			}
			if err := visitor.emit(exportStep{Number: number, SharedID: sharedID,
				Action:   exportHTMLText(html.UnescapeString(node.Parameters[0].Value)),
				Expected: exportHTMLText(html.UnescapeString(node.Parameters[1].Value)),
			}); err != nil {
				return err
			}
		case "compref":
			if err := visitor.walkShared(node.Reference, number); err != nil {
				return err
			}
		default:
			return invalidContentQuery("unsupported test-step XML element: " + node.XMLName.Local)
		}
	}
	return nil
}

func (visitor *exportStepVisitor) walkShared(reference, number string) error {
	nodes, exists := visitor.shared[reference]
	if !exists || visitor.parents[reference] || len(visitor.parents) >= maxExportSharedDepth {
		return invalidContentQuery("shared steps are unavailable, cyclic, or nested too deeply")
	}
	visitor.parents[reference] = true
	defer delete(visitor.parents, reference)
	if len(nodes) == 0 {
		return visitor.emit(exportStep{Number: number, SharedID: reference})
	}
	return visitor.walk(nodes, number+".", reference)
}
