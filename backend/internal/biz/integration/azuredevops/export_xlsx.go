package azuredevops

import (
	"unicode/utf8"

	"github.com/xuri/excelize/v2"
)

const XLSXContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

func exportWorkbook(rows [][]string) ([]byte, error) {
	if len(rows) == 0 || len(rows[0]) == 0 {
		return nil, invalidContentQuery("XLSX export requires selected columns")
	}

	workbook := excelize.NewFile()
	defer func() { _ = workbook.Close() }()
	sheet := workbook.GetSheetName(0)
	width := len(rows[0])
	for index, row := range rows {
		if len(row) != width {
			return nil, invalidContentQuery("XLSX row does not match the selected columns")
		}
		rowNumber := index + 1
		for column, value := range row {
			cell, err := excelize.CoordinatesToCellName(column+1, rowNumber)
			if err != nil {
				return nil, err
			}
			if utf8.RuneCountInString(value) > 32767 {
				return nil, invalidContentQuery(
					"XLSX cell " + cell + " exceeds 32767 characters; no file was exported",
				)
			}
			if err := workbook.SetCellStr(sheet, cell, value); err != nil {
				return nil, err
			}
		}
	}
	if err := styleExportWorkbook(workbook, sheet, width, len(rows)); err != nil {
		return nil, err
	}
	output, err := workbook.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	if output.Len() > MaxExportBytes {
		return nil, invalidContentQuery("XLSX exceeds the 8 MiB limit; narrow the saved query")
	}
	return output.Bytes(), nil
}

func styleExportWorkbook(
	workbook *excelize.File,
	sheet string,
	width, height int,
) error {
	style, err := workbook.NewStyle(&excelize.Style{Alignment: &excelize.Alignment{WrapText: true, Vertical: "top"}})
	if err != nil {
		return err
	}
	lastCell, err := excelize.CoordinatesToCellName(width, height)
	if err != nil {
		return err
	}
	if err := workbook.SetSheetDimension(sheet, "A1:"+lastCell); err != nil {
		return err
	}
	if err := workbook.SetCellStyle(sheet, "A1", lastCell, style); err != nil {
		return err
	}
	lastColumn, err := excelize.ColumnNumberToName(width)
	if err != nil {
		return err
	}
	if err := workbook.SetColWidth(sheet, "A", lastColumn, 24); err != nil {
		return err
	}
	return workbook.SetPanes(sheet, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})
}
