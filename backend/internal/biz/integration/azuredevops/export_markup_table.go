package azuredevops

import (
	"strings"

	htmlparser "golang.org/x/net/html"
)

type exportHTMLTableCell struct {
	text   string
	header bool
	scope  string
}

func exportHTMLTableText(node *htmlparser.Node) (string, bool) {
	rows, ok := exportHTMLTableRows(node)
	if !ok || len(rows) == 0 {
		return "", false
	}

	var text strings.Builder
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == htmlparser.ElementNode && child.Data == "caption" {
			text.WriteString(exportHTMLNodeText(child) + "\n")
		}
	}

	headers := exportHTMLColumnHeaders(rows)
	if len(headers) > 0 {
		rows = rows[1:]
	}
	for index, row := range rows {
		if index > 0 {
			text.WriteByte('\n')
			if len(headers) > 0 {
				text.WriteByte('\n')
			}
		}
		text.WriteString(exportHTMLTableRowText(row, headers))
	}
	return strings.TrimSpace(text.String()), true
}

func exportHTMLColumnHeaders(rows [][]exportHTMLTableCell) []string {
	if len(rows) < 2 {
		return nil
	}
	headers := make([]string, 0, len(rows[0]))
	seen := make(map[string]bool)
	for _, cell := range rows[0] {
		if !cell.header || cell.scope == "row" || cell.text == "" || seen[cell.text] {
			return nil
		}
		headers = append(headers, cell.text)
		seen[cell.text] = true
	}
	for _, row := range rows[1:] {
		if len(row) != len(headers) {
			return nil
		}
		for _, cell := range row {
			if cell.header {
				return nil
			}
		}
	}
	return headers
}

func exportHTMLTableRowText(row []exportHTMLTableCell, headers []string) string {
	if len(headers) == 0 && len(row) == 2 && row[0].header && row[0].scope != "col" && !row[1].header {
		return row[0].text + ": " + row[1].text
	}
	values := make([]string, len(row))
	escape := strings.NewReplacer("\\", "\\\\", "|", "\\|", "\r", "\\r", "\n", "\\n")
	for column, cell := range row {
		if len(headers) > 0 {
			values[column] = headers[column] + ": " + cell.text
		} else {
			values[column] = escape.Replace(cell.text)
		}
	}
	if len(headers) > 0 {
		return strings.Join(values, "\n")
	}
	return strings.Join(values, " | ")
}

func exportHTMLTableRows(node *htmlparser.Node) ([][]exportHTMLTableCell, bool) {
	var rows [][]exportHTMLTableCell
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if child.Type != htmlparser.ElementNode {
			continue
		}
		switch child.Data {
		case "thead", "tbody", "tfoot":
			group, ok := exportHTMLTableRows(child)
			if !ok {
				return nil, false
			}
			rows = append(rows, group...)
		case "tr":
			cells, ok := exportHTMLTableCells(child)
			if !ok {
				return nil, false
			}
			rows = append(rows, cells)
		case "caption", "colgroup":
		default:
			return nil, false
		}
	}
	return rows, true
}

func exportHTMLTableCells(row *htmlparser.Node) ([]exportHTMLTableCell, bool) {
	var cells []exportHTMLTableCell
	for child := row.FirstChild; child != nil; child = child.NextSibling {
		if child.Type != htmlparser.ElementNode {
			continue
		}
		if child.Data != "th" && child.Data != "td" {
			return nil, false
		}
		scope, ok := exportHTMLTableCellScope(child)
		if !ok {
			return nil, false
		}
		cells = append(cells, exportHTMLTableCell{
			text:   exportHTMLNodeText(child),
			header: child.Data == "th" || (row.Parent != nil && row.Parent.Data == "thead"),
			scope:  scope,
		})
	}
	return cells, len(cells) > 0
}

func exportHTMLTableCellScope(node *htmlparser.Node) (string, bool) {
	var scope string
	for _, attribute := range node.Attr {
		if (attribute.Key == "rowspan" || attribute.Key == "colspan") && attribute.Val != "1" {
			return "", false
		}
		if attribute.Key == "headers" && attribute.Val != "" {
			return "", false
		}
		if attribute.Key == "scope" {
			scope = strings.ToLower(attribute.Val)
		}
	}
	return scope, scope == "" || scope == "row" || scope == "col"
}
