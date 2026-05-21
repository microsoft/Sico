# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

import argparse
import os

core_out_path = os.path.normpath("../core/app/pb")

import_whitelist = [
    "google/protobuf/struct.proto"
]

proto_outdir_map = {
}


def get_package_name_from_proto_file(filename: str) -> str:
    lines = open(filename, "r", encoding="utf-8").readlines()
    # find line like "package xxx;"
    for line in lines:
        line = line.strip()
        if line.startswith("package "):
            package_name = line[len("package "):].strip().rstrip(";")
            return package_name
    return ""

def get_import_list_in_proto_file(file: str) -> list[tuple[str, str, str]]:
    '''
    each item is (subdir, filename, package_name)
    '''
    lines = open(file, "r", encoding="utf-8").readlines()
    imports = []
    for line in lines:
        line = line.strip()
        if line.startswith("import "):
            import_path = line[len("import "):].strip().strip(";").strip().strip('"').strip()
            if import_path in import_whitelist:
                continue
            parts = import_path.split("/")
            if len(parts) != 2:
                raise ValueError(f"import path format error: {import_path}")
            package_name = get_package_name_from_proto_file(import_path)
            imports.append((parts[0], parts[1], package_name))
            # recurse
            sub_imports = get_import_list_in_proto_file(import_path)
            for sub_import in sub_imports:
                if sub_import not in imports:
                    imports.append(sub_import)

    return imports

def replace_contents(filename: str, imports: list[tuple[str, str, str]]) -> None:
    lines = open(filename, "r", encoding="utf-8").readlines()
    new_lines = []
    substitutions = []
    for (proto_subdir, import_filename, package_name) in imports:
        original_line = f"from .. import {package_name} as _{package_name}__"
        new_subdir = proto_outdir_map.get(proto_subdir, proto_subdir)
        new_line = f"from ...{new_subdir} import {package_name} as _{package_name}__"
        substitutions.append((original_line, new_line))
    for line in lines:
        for (original_line, new_line) in substitutions:
            if line.strip() == original_line:
                line = line.replace(original_line, new_line)
        new_lines.append(line)
    with open(filename, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

def relink_one(proto_subdir: str, out_subdir: str, filename: str) -> None:
    proto_file = os.path.join(proto_subdir, filename)
    package_name = get_package_name_from_proto_file(proto_file)
    imports = get_import_list_in_proto_file(proto_file)

    # remove imports not in this subdir
    for (imp_subdir, _imp_filename, imported_package_name) in imports:
        if imp_subdir == proto_subdir:
            continue
        unused_path = os.path.join(core_out_path, proto_subdir, imported_package_name)
        if os.path.exists(unused_path):
            print(f"Removing unused path: {unused_path} (proto_subdir={imp_subdir}, specified proto_subdir={proto_subdir})")
            os.remove(os.path.join(unused_path, "__init__.py"))
            os.removedirs(unused_path)

    generated_file = os.path.join(core_out_path, out_subdir, package_name, "__init__.py")
    replace_contents(generated_file, imports)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Relink python protobuf generated files")
    parser.add_argument("--proto_subdir", type=str, required=True, help="The subdir under proto/, e.g., workflow")
    parser.add_argument("--out_subdir", type=str, required=True, help="The output subdir under proto/gen_core/, e.g., workflow")
    parser.add_argument("--file", dest="files", type=str, action="append", required=True,
                        help="The protobuf filename, e.g., restful.proto. May be given multiple times.")
    args = parser.parse_args()

    for filename in args.files:
        relink_one(args.proto_subdir, args.out_subdir, filename)
