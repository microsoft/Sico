package azuredevops

import (
	"encoding/json"
	"encoding/xml"
	"io"
	"strings"

	htmlparser "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

func exportHTMLRenderer(element atom.Atom) func(*htmlparser.Node) (string, bool) {
	switch element {
	case atom.Table:
		return exportHTMLTableText
	case atom.Ol, atom.Ul:
		return exportHTMLListText
	case atom.Dl:
		return exportHTMLDefinitionText
	case atom.Pre:
		return exportHTMLPreText
	default:
		return nil
	}
}

func exportMarkupText(value string) string {
	if json.Valid([]byte(value)) {
		return value
	}
	decoder := xml.NewDecoder(strings.NewReader(value))
	decoder.CharsetReader = func(_ string, input io.Reader) (io.Reader, error) {
		return input, nil
	}
	for {
		token, err := decoder.Token()
		if err != nil {
			return exportHTMLText(value)
		}
		switch element := token.(type) {
		case xml.StartElement:
			if element.Name.Space != "" && element.Name.Space != "http://www.w3.org/1999/xhtml" {
				return value
			}
			tag := atom.Lookup([]byte(strings.ToLower(element.Name.Local)))
			if exportHTMLRenderer(tag) == nil && exportHTMLOpaque(tag) {
				return value
			}
			return exportHTMLText(value)
		case xml.ProcInst:
			return value
		case xml.Directive:
			if !strings.EqualFold(strings.TrimSpace(string(element)), "DOCTYPE html") {
				return value
			}
		}
	}
}

func exportHTMLText(value string) string {
	root, err := htmlparser.Parse(strings.NewReader(value))
	if err != nil {
		return value
	}
	return exportHTMLNodeText(root)
}

func exportHTMLNodeText(node *htmlparser.Node) string {
	var text strings.Builder
	appendExportHTMLText(node, &text)
	return strings.TrimSpace(text.String())
}

func appendExportHTMLText(node *htmlparser.Node, text *strings.Builder) {
	if node.Type == htmlparser.TextNode {
		text.WriteString(node.Data)
		return
	}
	if node.Type == htmlparser.ElementNode && appendExportHTMLStructure(node, text) {
		return
	}
	block := exportHTMLBlock(node.DataAtom)
	if block {
		exportHTMLLineBreak(text)
	}
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		appendExportHTMLText(child, text)
	}
	if node.Type != htmlparser.ElementNode {
		return
	}
	appendExportMediaText(node, text)
	if node.DataAtom == atom.Br {
		text.WriteByte('\n')
	} else if block {
		exportHTMLLineBreak(text)
	}
}

func appendExportHTMLStructure(node *htmlparser.Node, text *strings.Builder) bool {
	if node.DataAtom == atom.Script || node.DataAtom == atom.Style {
		return true
	}
	render := exportHTMLRenderer(node.DataAtom)
	if render == nil && !exportHTMLOpaque(node.DataAtom) {
		return false
	}
	exportHTMLLineBreak(text)
	var content string
	var converted bool
	if render != nil {
		content, converted = render(node)
	}
	if converted {
		text.WriteString(content)
	} else {
		_ = htmlparser.Render(text, node)
	}
	exportHTMLLineBreak(text)
	return true
}

func exportHTMLBlock(element atom.Atom) bool {
	switch element {
	case atom.P, atom.Div, atom.Li, atom.Tr, atom.Blockquote, atom.Dt, atom.Dd,
		atom.H1, atom.H2, atom.H3, atom.H4, atom.H5, atom.H6, atom.Hr,
		atom.Article, atom.Section, atom.Header, atom.Footer, atom.Figure, atom.Figcaption:
		return true
	default:
		return false
	}
}

func exportHTMLOpaque(element atom.Atom) bool {
	if exportHTMLBlock(element) {
		return false
	}
	switch element {
	case atom.Html, atom.Head, atom.Body, atom.Title, atom.Script, atom.Style,
		atom.A, atom.Abbr, atom.B, atom.Bdi, atom.Bdo, atom.Br, atom.Caption, atom.Cite,
		atom.Code, atom.Col, atom.Colgroup, atom.Dfn, atom.Em, atom.Font, atom.I, atom.Img,
		atom.Ins, atom.Kbd, atom.Mark, atom.Q, atom.Rp, atom.Rt, atom.Ruby, atom.S, atom.Samp,
		atom.Small, atom.Span, atom.Strike, atom.Strong, atom.Sub, atom.Sup, atom.Tbody,
		atom.Td, atom.Tfoot, atom.Th, atom.Thead, atom.Time, atom.Tt, atom.U, atom.Var, atom.Wbr:
		return false
	default:
		return true
	}
}

func exportHTMLLineBreak(text *strings.Builder) {
	if text.Len() > 0 && !strings.HasSuffix(text.String(), "\n") {
		text.WriteByte('\n')
	}
}

func exportHTMLAttribute(node *htmlparser.Node, name string) (string, bool) {
	for _, attribute := range node.Attr {
		if attribute.Key == name {
			return attribute.Val, true
		}
	}
	return "", false
}

func exportHTMLPreText(node *htmlparser.Node) (string, bool) {
	var text strings.Builder
	for child := node.FirstChild; child != nil; child = child.NextSibling {
		appendExportHTMLText(child, &text)
	}
	content := text.String()
	fenceLength := 3
	for _, line := range strings.Split(content, "\n") {
		backticks := len(line) - len(strings.TrimLeft(line, "`"))
		fenceLength = max(fenceLength, backticks+1)
	}
	fence := strings.Repeat("`", fenceLength)
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return fence + "\n" + content + fence, true
}

func appendExportMediaText(node *htmlparser.Node, text *strings.Builder) {
	switch node.Data {
	case "img":
		for _, attribute := range node.Attr {
			if attribute.Key == "alt" || attribute.Key == "src" {
				text.WriteString(" [" + attribute.Val + "] ")
			}
		}
	case "a":
		for _, attribute := range node.Attr {
			if attribute.Key == "href" {
				text.WriteString(" [" + attribute.Val + "]")
			}
		}
	}
}
