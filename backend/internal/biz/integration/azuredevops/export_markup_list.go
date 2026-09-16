package azuredevops

import (
	"strconv"
	"strings"

	htmlparser "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

func exportHTMLListText(node *htmlparser.Node) (string, bool) {
	items, ok := exportHTMLListItems(node)
	if !ok {
		return "", false
	}
	number, increment, ok := exportHTMLListSequence(node, len(items))
	if !ok {
		return "", false
	}
	lines := make([]string, 0, len(items))
	for index, item := range items {
		prefix := "- "
		if node.DataAtom == atom.Ol {
			if value, exists := exportHTMLAttribute(item, "value"); exists {
				var err error
				number, err = strconv.Atoi(strings.TrimSpace(value))
				if err != nil {
					return "", false
				}
			}
			prefix = strconv.Itoa(number) + ". "
		}
		indent := strings.Repeat(" ", len(prefix))
		content := strings.ReplaceAll(exportHTMLNodeText(item), "\n", "\n"+indent)
		lines = append(lines, prefix+content)
		next := number + increment
		if index+1 < len(items) && ((increment > 0 && next < number) || (increment < 0 && next > number)) {
			return "", false
		}
		number = next
	}
	return strings.Join(lines, "\n"), true
}

func exportHTMLListItems(node *htmlparser.Node) ([]*htmlparser.Node, bool) {
	var items []*htmlparser.Node
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == htmlparser.TextNode && strings.TrimSpace(child.Data) != "" {
			return nil, false
		}
		if child.Type != htmlparser.ElementNode {
			continue
		}
		if child.DataAtom != atom.Li {
			return nil, false
		}
		items = append(items, child)
	}
	return items, len(items) > 0
}

func exportHTMLListSequence(node *htmlparser.Node, count int) (int, int, bool) {
	number, increment := 1, 1
	if node.DataAtom != atom.Ol {
		return number, increment, true
	}
	if style, exists := exportHTMLAttribute(node, "type"); exists && style != "1" {
		return 0, 0, false
	}
	if _, reversed := exportHTMLAttribute(node, "reversed"); reversed {
		number, increment = count, -1
	}
	if start, exists := exportHTMLAttribute(node, "start"); exists {
		var err error
		number, err = strconv.Atoi(strings.TrimSpace(start))
		if err != nil {
			return 0, 0, false
		}
	}
	return number, increment, true
}

func exportHTMLDefinitionText(node *htmlparser.Node) (string, bool) {
	var term string
	var lines []string
	hasDefinition := true
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == htmlparser.TextNode && strings.TrimSpace(child.Data) != "" {
			return "", false
		}
		if child.Type != htmlparser.ElementNode {
			continue
		}
		switch child.DataAtom {
		case atom.Dt:
			if !hasDefinition {
				return "", false
			}
			term = exportHTMLNodeText(child)
			hasDefinition = false
		case atom.Dd:
			if term == "" {
				return "", false
			}
			lines = append(lines, term+": "+exportHTMLNodeText(child))
			hasDefinition = true
		default:
			return "", false
		}
	}
	return strings.Join(lines, "\n"), hasDefinition && len(lines) > 0
}
