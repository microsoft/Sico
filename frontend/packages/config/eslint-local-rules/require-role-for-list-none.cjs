/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

"use strict";

function getTagName(node) {
  if (node.name.type === "JSXIdentifier") {
    // <ul/>, <ol/>
    return node.name.name;
  } else if (node.name.type === "JSXMemberExpression") {
    // <motion.ul/>, <motion.ol/>
    return node.name.property.name;
  }
  return null;
}

function containsListNone(node) {
  if (!node) {
    return false;
  }

  switch (node.type) {
    case "Literal":
      return (
        typeof node.value === "string" &&
        node.value.split(/\s+/).includes("list-none")
      );

    case "TemplateLiteral":
      return node.quasis.some((quasi) =>
        quasi.value.cooked.split(/\s+/).includes("list-none"),
      );

    case "BinaryExpression":
      return containsListNone(node.left) || containsListNone(node.right);

    case "ConditionalExpression":
      return (
        containsListNone(node.consequent) || containsListNone(node.alternate)
      );

    case "ArrayExpression":
      return node.elements.some(containsListNone);

    case "CallExpression":
      return node.arguments.some(containsListNone);

    default:
      return false;
  }
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce role='list' on elements (ul/ol) with class 'list-none' for Safari which removes the role when styled with 'list-style: none'",
      category: "Accessibility",
      recommended: false,
    },
    fixable: "code",
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const tagName = getTagName(node);
        if (tagName !== "ul" && tagName !== "ol") {
          return;
        }

        const classAttr = node.attributes.find(
          (attr) =>
            attr.type === "JSXAttribute" &&
            (attr.name.name === "className" || attr.name.name === "class"),
        );

        if (!classAttr || !classAttr.value) {
          return;
        }

        let classValue = null;
        if (classAttr.value.type === "Literal") {
          classValue = classAttr.value;
        } else if (classAttr.value.type === "JSXExpressionContainer") {
          classValue = classAttr.value.expression;
        }

        if (!classValue) {
          return;
        }

        const hasListNone = containsListNone(classValue);

        if (!hasListNone) {
          return;
        }

        const roleAttr = node.attributes.find(
          (attr) => attr.type === "JSXAttribute" && attr.name.name === "role",
        );

        if (!roleAttr) {
          context.report({
            node,
            message:
              "Elements (ul/ol) with class 'list-none' must have role=\"list\" for Safari which removes the role when styled with 'list-style: none'.",
            fix(fixer) {
              if (node.attributes.length > 0) {
                return fixer.insertTextAfter(
                  node.attributes[0],
                  ' role="list"',
                );
              } else {
                const tagEnd = node.name.range[1];
                return fixer.insertTextAfterRange(
                  [tagEnd - 1, tagEnd],
                  ' role="list"',
                );
              }
            },
          });
        }
      },
    };
  },
};
