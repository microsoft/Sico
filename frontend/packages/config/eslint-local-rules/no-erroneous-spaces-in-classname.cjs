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
