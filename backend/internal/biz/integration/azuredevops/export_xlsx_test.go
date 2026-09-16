package azuredevops

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/xuri/excelize/v2"
)

func TestExportWorkbookOpensAndContainsOnlyStrings(t *testing.T) {
	content, err := exportWorkbook([][]string{
		{"Title", "Value"},
		{"=1+1", "\u4e2d\u6587\nline"},
		{"@name", "00123"},
	})
	require.NoError(t, err)
	archive, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	require.NoError(t, err)
	assert.NotEmpty(t, archive.File)
	workbook, err := excelize.OpenReader(bytes.NewReader(content))
	require.NoError(t, err)
	defer func() { _ = workbook.Close() }()
	sheet := workbook.GetSheetName(0)
	dimension, err := workbook.GetSheetDimension(sheet)
	require.NoError(t, err)
	assert.Equal(t, "A1:B3", dimension)
	for _, cell := range []string{"A1", "B1", "A2", "B2", "A3", "B3"} {
		formula, err := workbook.GetCellFormula(sheet, cell)
		require.NoError(t, err)
		assert.Empty(t, formula)
		cellType, err := workbook.GetCellType(sheet, cell)
		require.NoError(t, err)
		assert.Equal(t, excelize.CellTypeSharedString, cellType)
	}
	value, err := workbook.GetCellValue(sheet, "A2")
	require.NoError(t, err)
	assert.Equal(t, "=1+1", value)
	value, err = workbook.GetCellValue(sheet, "B2")
	require.NoError(t, err)
	assert.Equal(t, "\u4e2d\u6587\nline", value)
	value, err = workbook.GetCellValue(sheet, "B3")
	require.NoError(t, err)
	assert.Equal(t, "00123", value)
	panes, err := workbook.GetPanes(sheet)
	require.NoError(t, err)
	assert.True(t, panes.Freeze)
	assert.Equal(t, 1, panes.YSplit)
	styleID, err := workbook.GetCellStyle(sheet, "B2")
	require.NoError(t, err)
	style, err := workbook.GetStyle(styleID)
	require.NoError(t, err)
	assert.True(t, style.Alignment.WrapText)
}

func TestExportWorkbookRejectsOversizedCellsAndMismatchedRows(t *testing.T) {
	for _, length := range []int{32767, 32768} {
		content, err := exportWorkbook([][]string{{"Title"}, {strings.Repeat("\u4e2d", length)}})
		if length == 32767 {
			require.NoError(t, err)
			assert.NotEmpty(t, content)
		} else {
			assert.ErrorContains(t, err, "32767 characters; no file was exported")
			assert.Nil(t, content)
		}
	}
	_, err := exportWorkbook([][]string{{"Title", "ID"}, {"one", "1", "extra"}})
	assert.Error(t, err)
	_, err = exportWorkbook(nil)
	assert.Error(t, err)
}
