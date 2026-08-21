package main

import (
	"fmt"
	"go/types"
	"path"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

const tracerName = "sico-backend/otelwrap"

type generator struct {
	pkg *packages.Package
	w   *writer

	qualifier func(pkg *types.Package) string

	errorType types.Type
}

func newGenerator(pkg *packages.Package, w *writer) *generator {
	g := &generator{pkg: pkg, w: w}

	g.errorType = types.Universe.Lookup("error").Type()
	g.qualifier = func(importedPackage *types.Package) string {
		if importedPackage == nil {
			return ""
		}
		if pkg.Types != nil && importedPackage.Path() == pkg.Types.Path() {
			return ""
		}
		alias := g.ensureImport(importedPackage.Path(), importedPackage.Name())
		g.w.used[alias] = true
		return alias
	}

	return g
}

func (g *generator) findTargetInterfaces() []ifaceInfo {
	scope := g.pkg.Types.Scope()
	if scope == nil {
		return nil
	}

	var interfaces []ifaceInfo
	for _, name := range scope.Names() {
		obj := scope.Lookup(name)
		typeName, ok := obj.(*types.TypeName)
		if !ok {
			continue
		}

		named, ok := typeName.Type().(*types.Named)
		if !ok {
			continue
		}
		iface, ok := named.Underlying().(*types.Interface)
		if !ok {
			continue
		}

		if !g.matchesTargetInterface(name) {
			continue
		}

		iface.Complete()
		if _, ok := g.sealedEmbeds(iface, g.pkg.Types); !ok {
			continue
		}
		interfaces = append(interfaces, ifaceInfo{name: name, obj: typeName})
	}

	sort.Slice(interfaces, func(i, j int) bool { return interfaces[i].name < interfaces[j].name })
	return interfaces
}

func (g *generator) matchesTargetInterface(name string) bool {
	if isBizPackage(g.pkg.PkgPath) {
		return name == "Service"
	}
	if isRepositoryPackage(g.pkg.PkgPath) {
		return strings.HasSuffix(name, "Repository") || strings.HasSuffix(name, "Repo")
	}
	return false
}

type embedInfo struct {
	pkgPath  string
	pkgName  string
	typeName string
}

func (g *generator) sealedEmbeds(iface *types.Interface, current *types.Package) ([]embedInfo, bool) {
	if iface == nil {
		return nil, true
	}
	currentPath := ""
	if current != nil {
		currentPath = current.Path()
	}

	var embeds []embedInfo
	seen := map[string]struct{}{}
	for index := 0; index < iface.NumMethods(); index++ {
		method := iface.Method(index)
		if method.Exported() || method.Pkg() == nil || method.Pkg().Path() == currentPath {
			continue
		}

		if !strings.HasPrefix(method.Name(), "mustEmbedUnimplemented") {
			return nil, false
		}
		typeName := strings.TrimPrefix(method.Name(), "mustEmbed")
		if typeName == method.Name() {
			return nil, false
		}

		pkg := method.Pkg()
		obj := pkg.Scope().Lookup(typeName)
		typeObject, ok := obj.(*types.TypeName)
		if !ok {
			return nil, false
		}
		named, ok := typeObject.Type().(*types.Named)
		if !ok {
			return nil, false
		}
		if _, ok := named.Underlying().(*types.Struct); !ok {
			return nil, false
		}

		key := pkg.Path() + ":" + typeName
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		embeds = append(embeds, embedInfo{pkgPath: pkg.Path(), pkgName: pkg.Name(), typeName: typeName})
	}

	sort.Slice(embeds, func(i, j int) bool {
		if embeds[i].pkgPath == embeds[j].pkgPath {
			return embeds[i].typeName < embeds[j].typeName
		}
		return embeds[i].pkgPath < embeds[j].pkgPath
	})
	return embeds, true
}

func isBizPackage(pkgPath string) bool {
	return strings.Contains(pkgPath, "/internal/biz/")
}

func isRepositoryPackage(pkgPath string) bool {
	return strings.HasSuffix(pkgPath, "/repository") && strings.Contains(pkgPath, "/internal/store/")
}

func (g *generator) addWrapperForInterface(iface ifaceInfo) {
	typeName := iface.obj.(*types.TypeName)
	named := typeName.Type().(*types.Named)
	interfaceType := named.Underlying().(*types.Interface)

	sealedEmbeds, ok := g.sealedEmbeds(interfaceType, g.pkg.Types)
	if !ok {
		return
	}

	for index := 0; index < interfaceType.NumMethods(); index++ {
		method := interfaceType.Method(index)
		if g.isForeignUnexportedMethod(method) {
			continue
		}
		signature := method.Type().(*types.Signature)
		g.collectImportsFromSignature(signature)
	}

	wrapFuncName := "WithTracing"
	if isRepositoryPackage(g.pkg.PkgPath) {
		wrapFuncName = "WithTracing" + iface.name
	}
	wrapperType := "otelTraced" + iface.name

	g.w.p("func %s(next %s) %s {", wrapFuncName, iface.name, iface.name)
	g.w.p("\tif next == nil {")
	g.w.p("\t\treturn nil")
	g.w.p("\t}")
	g.w.p("\treturn &%s{next: next}", wrapperType)
	g.w.p("}")
	g.w.p("")
	g.w.p("type %s struct {", wrapperType)
	for _, embedded := range sealedEmbeds {
		alias := g.ensureImport(embedded.pkgPath, embedded.pkgName)
		g.w.used[alias] = true
		g.w.p("\t%s.%s", alias, embedded.typeName)
	}
	g.w.p("\tnext %s", iface.name)
	g.w.p("}")
	g.w.p("")
	if isBizPackage(g.pkg.PkgPath) {
		g.w.p("func (w *%s) Unwrap() %s {", wrapperType, iface.name)
		g.w.p("\treturn w.next")
		g.w.p("}")
		g.w.p("")
	}

	for index := 0; index < interfaceType.NumMethods(); index++ {
		method := interfaceType.Method(index)
		if g.isForeignUnexportedMethod(method) {
			continue
		}
		signature := method.Type().(*types.Signature)
		g.emitMethod(wrapperType, iface.name, method.Name(), signature)
		g.w.p("")
	}
}

func (g *generator) isForeignUnexportedMethod(method *types.Func) bool {
	if method == nil || method.Exported() {
		return false
	}
	pkg := method.Pkg()
	if pkg == nil || g.pkg.Types == nil {
		return false
	}
	return pkg.Path() != g.pkg.Types.Path()
}

func (g *generator) ensureImport(pkgPath, suggested string) string {
	if existing, ok := g.w.imports[pkgPath]; ok {
		return existing
	}

	alias := suggested
	if alias == "" {
		alias = path.Base(pkgPath)
	}

	base := alias
	index := 2
	for {
		used := false
		for _, existingAlias := range g.w.imports {
			if existingAlias == alias {
				used = true
				break
			}
		}
		if !used {
			break
		}
		alias = fmt.Sprintf("%s%d", base, index)
		index++
	}

	g.w.imports[pkgPath] = alias
	return alias
}

func (g *generator) emitImports() {
	paths := make([]string, 0, len(g.w.imports))
	for pkgPath := range g.w.imports {
		paths = append(paths, pkgPath)
	}
	sort.Strings(paths)

	specs := make([]string, 0, len(paths))
	for _, pkgPath := range paths {
		alias := g.w.imports[pkgPath]
		if !g.w.used[alias] {
			continue
		}
		if alias == path.Base(pkgPath) || (pkgPath == "context" && alias == "context") {
			specs = append(specs, fmt.Sprintf("\t%q", pkgPath))
			continue
		}
		specs = append(specs, fmt.Sprintf("\t%s %q", alias, pkgPath))
	}
	if len(specs) == 0 {
		return
	}

	lines := strings.Split(g.w.buf.String(), "\n")
	packageLine := -1
	for index, line := range lines {
		if strings.HasPrefix(line, "package ") {
			packageLine = index
			break
		}
	}
	if packageLine < 0 {
		return
	}

	out := make([]string, 0, len(lines)+len(specs)+3)
	out = append(out, lines[:packageLine+1]...)
	out = append(out, "", "import (")
	out = append(out, specs...)
	out = append(out, ")", "")
	out = append(out, lines[packageLine+1:]...)
	g.w.buf.Reset()
	g.w.buf.WriteString(strings.Join(out, "\n"))
}

func (g *generator) collectImportsFromSignature(signature *types.Signature) {
	params := signature.Params()
	for index := 0; index < params.Len(); index++ {
		g.collectImportsFromType(params.At(index).Type())
	}
	results := signature.Results()
	for index := 0; index < results.Len(); index++ {
		g.collectImportsFromType(results.At(index).Type())
	}
}

func (g *generator) collectImportsFromType(valueType types.Type) {
	switch typed := valueType.(type) {
	case *types.Pointer:
		g.collectImportsFromType(typed.Elem())
	case *types.Slice:
		g.collectImportsFromType(typed.Elem())
	case *types.Array:
		g.collectImportsFromType(typed.Elem())
	case *types.Map:
		g.collectImportsFromType(typed.Key())
		g.collectImportsFromType(typed.Elem())
	case *types.Chan:
		g.collectImportsFromType(typed.Elem())
	case *types.Signature:
		g.collectImportsFromSignature(typed)
	case *types.Named:
		if pkg := typed.Obj().Pkg(); pkg != nil {
			if g.pkg.Types == nil || pkg.Path() != g.pkg.Types.Path() {
				alias := g.ensureImport(pkg.Path(), pkg.Name())
				g.w.used[alias] = true
			}
		}
		if typed.TypeArgs() != nil {
			for index := 0; index < typed.TypeArgs().Len(); index++ {
				g.collectImportsFromType(typed.TypeArgs().At(index))
			}
		}
	}
}

func (g *generator) emitMethod(
	wrapperType string,
	interfaceName string,
	methodName string,
	signature *types.Signature,
) {
	paramsDecl, args := g.renderParams(signature)
	resultsDecl, returns := g.renderResults(signature)

	g.w.p("func (w *%s) %s(%s)%s {", wrapperType, methodName, paramsDecl, resultsDecl)

	contextVariable := g.findContextParam(signature)
	if contextVariable != "" {
		g.w.used[g.ensureImport("go.opentelemetry.io/otel", "otel")] = true
		spanName := fmt.Sprintf("%s.%s", interfaceName, methodName)
		g.w.p("\t%s, span := otel.Tracer(%q).Start(%s, %q)", contextVariable, tracerName, contextVariable, spanName)
		g.w.p("\tdefer span.End()")
		g.w.p("")
	}

	call := fmt.Sprintf("w.next.%s(%s)", methodName, strings.Join(args, ", "))
	if returns == "" {
		g.w.p("\t%s", call)
		g.w.p("}")
		return
	}

	lhs := strings.Join(returnsSplit(returns), ", ")
	g.w.p("\t%s := %s", lhs, call)

	errorVariable := g.findFirstErrorResult(signature, returns)
	if contextVariable != "" && errorVariable != "" {
		g.w.used[g.ensureImport("go.opentelemetry.io/otel/codes", "codes")] = true
		g.w.p("\tif %s != nil {", errorVariable)
		g.w.p("\t\tspan.RecordError(%s)", errorVariable)
		g.w.p("\t\tspan.SetStatus(codes.Error, %s.Error())", errorVariable)
		g.w.p("\t}")
	}

	g.w.p("\treturn %s", returns)
	g.w.p("}")
}

func returnsSplit(returns string) []string {
	parts := strings.Split(returns, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		values = append(values, strings.TrimSpace(part))
	}
	return values
}

func (g *generator) renderParams(signature *types.Signature) (string, []string) {
	params := signature.Params()
	args := make([]string, 0, params.Len())
	declarations := make([]string, 0, params.Len())

	for index := 0; index < params.Len(); index++ {
		variable := params.At(index)
		name := normalizeIdent(variable.Name())
		if name == "_" {
			name = fmt.Sprintf("arg%d", index)
		}

		valueType := variable.Type()
		isVariadic := signature.Variadic() && index == params.Len()-1
		if isVariadic {
			sliceType, _ := valueType.(*types.Slice)
			if sliceType != nil {
				valueType = sliceType.Elem()
			}
		}

		typeString := types.TypeString(valueType, g.qualifier)
		if isVariadic {
			declarations = append(declarations, fmt.Sprintf("%s ...%s", name, typeString))
			args = append(args, name+"...")
			continue
		}
		declarations = append(declarations, fmt.Sprintf("%s %s", name, typeString))
		args = append(args, name)
	}

	return strings.Join(declarations, ", "), args
}

func (g *generator) renderResults(signature *types.Signature) (string, string) {
	results := signature.Results()
	if results.Len() == 0 {
		return "", ""
	}

	returnNames := make([]string, 0, results.Len())
	declarations := make([]string, 0, results.Len())
	for index := 0; index < results.Len(); index++ {
		variable := results.At(index)
		name := normalizeIdent(variable.Name())
		if name == "_" {
			name = fmt.Sprintf("ret%d", index)
		}
		returnNames = append(returnNames, name)
		declarations = append(declarations, types.TypeString(variable.Type(), g.qualifier))
	}

	declaration := " " + declarations[0]
	if results.Len() > 1 {
		declaration = " (" + strings.Join(declarations, ", ") + ")"
	}
	return declaration, strings.Join(returnNames, ", ")
}

func (g *generator) findContextParam(signature *types.Signature) string {
	params := signature.Params()
	if params.Len() == 0 {
		return ""
	}
	variable := params.At(0)
	if !isContextType(variable.Type()) {
		return ""
	}
	name := normalizeIdent(variable.Name())
	if name == "_" {
		name = "arg0"
	}
	g.w.used[g.ensureImport("context", "context")] = true
	return name
}

func isContextType(valueType types.Type) bool {
	named, ok := valueType.(*types.Named)
	if !ok {
		return false
	}
	obj := named.Obj()
	if obj == nil || obj.Pkg() == nil {
		return false
	}
	return obj.Pkg().Path() == "context" && obj.Name() == "Context"
}

func (g *generator) findFirstErrorResult(signature *types.Signature, returns string) string {
	results := signature.Results()
	returnNames := returnsSplit(returns)
	for index := 0; index < results.Len(); index++ {
		if types.Identical(results.At(index).Type(), g.errorType) {
			if index < len(returnNames) {
				return returnNames[index]
			}
			return ""
		}
	}
	return ""
}
