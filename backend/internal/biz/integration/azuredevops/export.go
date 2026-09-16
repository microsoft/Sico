package azuredevops

const (
	MaxExportWorkItems = 5000
	MaxExportBytes     = 8 << 20
)

type QueryExport struct {
	Content      []byte
	FileName     string
	ContentType  string
	FileExt      string
	ExportSource string
	QueryID      string
	QueryName    string
	QueryPath    string
	QueryAsOf    string
	ExportedAt   string
	Count        int
}
