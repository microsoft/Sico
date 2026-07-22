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

/**
 * @fileoverview Rule to detect and fix spacing issues in className attributes (ignoring template literals)
 */

"use strict";

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow double spaces, leading spaces, and trailing spaces in className string literals",
      category: "Styling",
      recommended: true,
    },
    fixable: "code",
    schema: [], // no options
  },
  create: function (context) {
    const sourceCode = context.getSourceCode();

    /**
     * Checks and fixes spacing issues in a string literal
     */
    function checkAndFixStringLiteral(node) {
      const nodeValue = node.value;

      // Skip if not a string
      if (typeof nodeValue !== "string") {
        return;
      }

      // Check for double spaces, leading spaces, or trailing spaces
      const hasDoubleSpaces = nodeValue.includes("  ");
      const hasLeadingSpace = nodeValue.startsWith(" ");
      const hasTrailingSpace = nodeValue.endsWith(" ");

      if (hasDoubleSpaces || hasLeadingSpace || hasTrailingSpace) {
        context.report({
          node: node,
          message: "Spacing issues found in className string",
          fix: function (fixer) {
            // Preserve the original quote style
            const originalText = sourceCode.getText(node);
            const quoteChar = originalText[0]; // Get the original quote character (' or ")

            // First trim leading/trailing spaces, then replace multiple spaces with single spaces
            let fixed = nodeValue.trim().replace(/\s{2,}/g, " ");

            // Construct the replacement with the original quote style
            return fixer.replaceText(node, `${quoteChar}${fixed}${quoteChar}`);
          },
        });
      }
    }

    /**
     * Identify if a call expression is a class utility function
     */
    function isClassUtilityFunction(callExpression) {
      if (
        !callExpression ||
        !callExpression.callee ||
        !callExpression.callee.name
      ) {
        return false;
      }

      return "clsx" === callExpression.callee.name;
    }

    return {
      // Handle direct className string literals
      'JSXAttribute[name.name="className"] > Literal': checkAndFixStringLiteral,

      // Handle string literals inside JSX expressions (including in function calls)
      'JSXAttribute[name.name="className"] > JSXExpressionContainer Literal':
        function (node) {
          // Find parent call expression if any
          let parent = node.parent;
          while (
            parent &&
            parent.type !== "CallExpression" &&
            parent.type !== "JSXExpressionContainer"
          ) {
            parent = parent.parent;
          }

          // Check if we're in a class utility function or directly in a JSX expression
          if (
            (parent &&
              parent.type === "CallExpression" &&
              isClassUtilityFunction(parent)) ||
            (parent && parent.type === "JSXExpressionContainer")
          ) {
            checkAndFixStringLiteral(node);
          }
        },

      // Deliberately not including any TemplateLiteral selectors
    };
  },
};
