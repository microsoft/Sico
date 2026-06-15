// Copyright (c) 2026 Sico Authors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// Command dbgen generates the backend's GORM DAL layer (the typed query
// helpers and model structs) from the live MySQL schema.
//
// For every entry declared in the stores table below, dbgen will:
//
//  1. Apply all pending golang-migrate migrations so the target database
//     matches the source tree.
//  2. Ask gorm.io/gen to introspect the listed tables and emit a `query`
//     package (typed chainable query API) together with a sibling `model`
//     package (struct definitions).
//  3. Override selected JSON columns so their Go type matches hand-written
//     domain types (see jsonColumn) and install millisecond-precision
//     auto timestamps on the conventional created_at / updated_at columns.
//
// Typical usage from the backend module root:
//
//	go run ./cmd/dbgen
//
// The generated files under internal/store/**/dal/query and the adjacent
// model package are meant to be committed; never hand-edit them — rerun
// dbgen whenever the DB schema or the stores table changes. Database
// connection settings are read from the backend's standard mysql config
// via internal/infra/mysql.New.
package main

import (
	"fmt"
	"log"
	"path"
	"path/filepath"
	"reflect"
	"strings"

	"gorm.io/gen"
	"gorm.io/gorm"

	messageEntity "sico-backend/internal/entity/conversation/message"
	migrationImpl "sico-backend/internal/infra/migration"
	mysqlImpl "sico-backend/internal/infra/mysql"
	agentCommon "sico-backend/internal/transport/http/dto/agent/common"
	commondto "sico-backend/internal/transport/http/dto/common"
	conversationdto "sico-backend/internal/transport/http/dto/conversation"
	"sico-backend/pkg/env"
)

// jsonColumn describes a table column whose DB representation is JSON and
// whose Go type must be overridden to match sample.
type jsonColumn struct {
	name   string
	sample any
}

// tableSpec describes a single database table together with the columns that
// must be generated as custom Go types (serialized as JSON on the DB side).
type tableSpec struct {
	name        string
	jsonColumns []jsonColumn
	// datatypesJSONColumns lists JSON columns whose Go type must be the
	// self-serializing gorm datatypes.JSON ([]byte). Unlike jsonColumns these
	// must NOT receive a `serializer:json` tag: datatypes.JSON already
	// implements driver.Valuer / sql.Scanner, so layering the JSON serializer on
	// top would re-encode the raw bytes (base64) and corrupt the column.
	datatypesJSONColumns []string
}

// storeSpec groups the tables that belong to one generated query package.
type storeSpec struct {
	// outDir is the query-package path relative to the backend repository root.
	outDir string
	// fieldNullable enables gen.Config.FieldNullable for this package.
	fieldNullable bool
	tables        []tableSpec
}

// stores enumerates every query package the generator should produce. Using
// explicit slices (rather than maps) makes the generation order deterministic
// so the emitted code diffs cleanly across runs.
var stores = []storeSpec{
	{
		outDir:        "internal/store/agent/singleagent/internal/dal/query",
		fieldNullable: true,
		tables: []tableSpec{
			{name: "t_single_agent"},
			{
				name: "t_single_agent_instance",
				jsonColumns: []jsonColumn{
					{name: "attachments", sample: []*agentCommon.Attachment{}},
				},
			},
		},
	},
	{
		outDir: "internal/store/project/internal/dal/query",
		tables: []tableSpec{
			{name: "t_project"},
			{name: "t_project_user"},
			{name: "t_project_asset"},
		},
	},
	{
		outDir: "internal/store/conversation/conversation/internal/dal/query",
		tables: []tableSpec{
			{name: "t_conversation"},
		},
	},
	{
		outDir: "internal/store/conversation/message/internal/dal/query",
		tables: []tableSpec{
			{
				name: "t_message",
				jsonColumns: []jsonColumn{
					{name: "ext", sample: &messageEntity.MessageExtraInfo{}},
					{name: "function_context", sample: &conversationdto.FunctionContext{}},
					{name: "attachments", sample: []*commondto.Attachment{}},
				},
			},
		},
	},
	{
		outDir: "internal/store/rbac/internal/dal/query",
		tables: []tableSpec{
			{name: "t_user"},
			{name: "t_role"},
			{name: "t_user_role"},
			{name: "t_casbin_rule"},
		},
	},
	{
		outDir: "internal/store/knowledge/internal/dal/query",
		tables: []tableSpec{
			{name: "t_knowledge_document"},
			{name: "t_knowledge_tag"},
			{name: "t_knowledge_document_tag"},
			{name: "t_knowledge_playbook"},
			{name: "t_knowledge_playbook_tag"},
		},
	},
	{
		outDir: "internal/store/skill/internal/dal/query",
		tables: []tableSpec{
			{name: "t_skill"},
			{name: "t_skill_version"},
		},
	},
	{
		outDir:        "internal/store/taskruntime/internal/dal/query",
		fieldNullable: true,
		tables: []tableSpec{
			{
				name:                 "t_task_runtime_batch",
				datatypesJSONColumns: []string{"counts_json", "batch_json"},
			},
			{
				name:                 "t_task_runtime_run",
				datatypesJSONColumns: []string{"run_json", "result_json"},
			},
		},
	},
}

func main() {
	if err := run(); err != nil {
		log.Fatalf("dbgen: %v", err)
	}
}

func run() error {
	if err := env.LoadDotEnv(""); err != nil {
		log.Printf("warning: failed to load .env file: %v", err)
	}
	if err := applyMigrations(); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	db, err := mysqlImpl.New()
	if err != nil {
		return fmt.Errorf("open mysql: %w", err)
	}
	defer closeDB(db)

	root := env.FindBackendRootPath()
	for _, s := range stores {
		if err := generateStore(db, root, s); err != nil {
			return fmt.Errorf("generate %q: %w", s.outDir, err)
		}
	}
	return nil
}

func applyMigrations() error {
	version, err := migrationImpl.NewMigrator().Run()
	if err != nil {
		return err
	}

	log.Printf("migrations applied, version=%d", version)

	return nil
}

func closeDB(db *gorm.DB) {
	sqlDB, err := db.DB()
	if err != nil {
		log.Printf("resolve underlying sql.DB failed: %v", err)
		return
	}

	if err := sqlDB.Close(); err != nil {
		log.Printf("close sql.DB failed: %v", err)
	}
}

// generateStore produces the GORM query package described by s.
func generateStore(db *gorm.DB, root string, s storeSpec) error {
	g := gen.NewGenerator(gen.Config{
		OutPath:       filepath.Join(root, s.outDir),
		Mode:          gen.WithoutContext | gen.WithDefaultQuery | gen.WithQueryInterface,
		FieldNullable: s.fieldNullable,
	})
	g.UseDB(db)
	g.WithOpts(gen.FieldType("deleted_at", "gorm.DeletedAt"))
	if storeUsesDatatypesJSON(s) {
		// Ensure the generated model package imports gorm.io/datatypes for the
		// columns retyped as datatypes.JSON below.
		g.WithImportPkgPath("gorm.io/datatypes")
	}

	// Derive the import path of the models package that the generator will
	// emit. Types declared inside that package must be rendered unqualified
	// so the generated code compiles without extra imports.
	modelPkgPath := path.Join(path.Dir(s.outDir), g.ModelPkgPath)

	// Record which configured JSON columns are actually applied to a generated
	// field. Unmatched entries almost always mean a typo or a stale column name
	// after a schema change, which would silently fall back to a default Go
	// type — failing loudly is far safer for generated code.
	applied := make(map[string]map[string]bool, len(s.tables))
	models := make([]any, 0, len(s.tables))
	for _, t := range s.tables {
		hits := make(map[string]bool, len(t.jsonColumns))
		applied[t.name] = hits
		models = append(models, g.GenerateModel(t.name, modelOptions(t, modelPkgPath, hits)...))
	}

	g.ApplyBasic(models...)
	g.Execute()

	var missing []string
	for _, t := range s.tables {
		for _, c := range t.jsonColumns {
			if !applied[t.name][c.name] {
				missing = append(missing, fmt.Sprintf("%s.%s", t.name, c.name))
			}
		}
		for _, c := range t.datatypesJSONColumns {
			if !applied[t.name][c] {
				missing = append(missing, fmt.Sprintf("%s.%s", t.name, c))
			}
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("json column overrides did not match any generated field: %s", strings.Join(missing, ", "))
	}
	return nil
}

// storeUsesDatatypesJSON reports whether any table in s declares a column that
// must be retyped as datatypes.JSON.
func storeUsesDatatypesJSON(s storeSpec) bool {
	for _, t := range s.tables {
		if len(t.datatypesJSONColumns) > 0 {
			return true
		}
	}

	return false
}

func modelOptions(t tableSpec, modelPkgPath string, hits map[string]bool) []gen.ModelOpt {
	opts := make([]gen.ModelOpt, 0, len(t.jsonColumns)+2)
	for _, c := range t.jsonColumns {
		opts = append(opts, gen.FieldModify(jsonColumnModifier(c, modelPkgPath, hits)))
	}

	if len(t.datatypesJSONColumns) > 0 {
		opts = append(opts, gen.FieldModify(datatypesJSONModifier(t.datatypesJSONColumns, hits)))
	}
	opts = append(opts, gen.FieldModify(timestampModifier))

	return opts
}

// datatypesJSONModifier retypes the named columns to the self-serializing
// gorm datatypes.JSON. It records each applied column in hits so the caller can
// detect stale configuration, and deliberately leaves the gorm tag untouched
// (no `serializer:json`) so datatypes.JSON handles its own Scan/Value.
func datatypesJSONModifier(columns []string, hits map[string]bool) func(gen.Field) gen.Field {
	want := make(map[string]bool, len(columns))
	for _, c := range columns {
		want[c] = true
	}

	return func(f gen.Field) gen.Field {
		if !want[f.ColumnName] {
			return f
		}
		hits[f.ColumnName] = true
		f.Type = "datatypes.JSON"
		return f
	}
}

// jsonColumnModifier retypes a column to match the Go type of c.sample and
// tags it with the gorm `serializer:json` tag. When the modifier matches, it
// records the hit in hits so the caller can detect stale configuration.
func jsonColumnModifier(c jsonColumn, modelPkgPath string, hits map[string]bool) func(gen.Field) gen.Field {
	return func(f gen.Field) gen.Field {
		if f.ColumnName != c.name {
			return f
		}
		hits[c.name] = true
		f.Type = renderGoType(reflect.TypeOf(c.sample), true, modelPkgPath)
		f.GORMTag.Set("serializer", "json")
		return f
	}
}

// timestampModifier enables millisecond-precision auto timestamps on the
// conventional created_at / updated_at columns.
//
// See https://gorm.io/docs/models.html#Creating-Updating-Time-Unix-Milli-Nano-Seconds-Tracking
func timestampModifier(f gen.Field) gen.Field {
	switch f.ColumnName {
	case "created_at":
		f.GORMTag.Set("autoCreateTime", "milli")
	case "updated_at":
		f.GORMTag.Set("autoUpdateTime", "milli")
	}

	return f
}

// renderGoType converts a reflect.Type into the Go source representation used
// by the generator. Types declared in the target model package are emitted
// unqualified; everything else falls back to the fully-qualified name.
//
// byValue controls whether a non-composite type is rendered as a value (true)
// or as a pointer (false). Pointer types in the input always produce pointer
// output, regardless of the caller's request.
func renderGoType(t reflect.Type, byValue bool, modelPkgPath string) string {
	switch t.Kind() {
	case reflect.Pointer:
		return renderGoType(t.Elem(), false, modelPkgPath)
	case reflect.Slice:
		return "[]" + renderGoType(t.Elem(), byValue, modelPkgPath)
	}

	name := t.String()
	if strings.HasSuffix(t.PkgPath(), modelPkgPath) {
		name = t.Name()
	}
	if byValue {
		return name
	}

	return "*" + name
}
