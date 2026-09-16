package azuredevops

func directWorkItemsRows(
	items []savedWorkItem,
	fields []ExportField,
	adapters exportFieldAdapters,
) ([][]string, error) {
	rows := make([][]string, 1, len(items)+1)
	rows[0] = directExportHeaders(fields)
	size := 0
	for _, item := range items {
		row, err := directExportItemRow(item, fields, adapters)
		if err != nil {
			return nil, err
		}
		for _, value := range row {
			size += len(value)
		}
		if size > MaxExportBytes {
			return nil, invalidContentQuery("export data exceeds the 8 MiB limit; narrow the saved query")
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func directExportHeaders(fields []ExportField) []string {
	headers := make([]string, 0, len(fields))
	for _, field := range fields {
		headers = append(headers, field.Name)
	}
	return headers
}

func directExportItemRow(
	item savedWorkItem,
	fields []ExportField,
	adapters exportFieldAdapters,
) ([]string, error) {
	row := make([]string, 0, len(fields))
	for _, field := range fields {
		value, err := adapters.format(item, field)
		if err != nil {
			return nil, err
		}
		row = append(row, value)
	}
	return row, nil
}
