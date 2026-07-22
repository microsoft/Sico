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

/**
 * Enforces that every `<Avatar>` JSX element contains an
 * `<AvatarFallback>` child somewhere in its JSXChildren.
 *
 * Why: `<AvatarImage>` only renders once the picture has loaded.
 * Without a fallback, the avatar collapses to an empty rounded
 * shell during loading / error states — every product surface
 * must supply either initials or the `DW_DEFAULT_AVATAR_URL` SVG.
 *
 * Note: This rule recognises `<Avatar>` by its JSX tag name only.
 * Renamed imports (`import { Avatar as User }`) bypass the rule by
 * design — that pattern doesn't appear in the codebase and tracking
 * import bindings would couple this rule to module resolution.
 */

function getTagName(node) {
  if (node.name.type === "JSXIdentifier") {
    return node.name.name;
  }
  if (node.name.type === "JSXMemberExpression") {
    return node.name.property.name;
  }
  return null;
}

function hasFallbackChild(children) {
  return children.some((child) => {
    if (child.type !== "JSXElement") {
      return false;
    }
    const tagName = getTagName(child.openingElement);
    return tagName === "AvatarFallback";
  });
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce that every <Avatar> contains an <AvatarFallback> child so the shell never collapses to an empty rounded box during image loading or error states.",
      category: "Best Practices",
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      missingFallback:
        "<Avatar> must contain an <AvatarFallback> child. Supply either initials (<AvatarFallback>JD</AvatarFallback>) or the default SVG (<AvatarFallback><img src={DW_DEFAULT_AVATAR_URL} alt='' /></AvatarFallback>).",
    },
  },
  create(context) {
    return {
      JSXElement(node) {
        const tagName = getTagName(node.openingElement);
        if (tagName !== "Avatar") {
          return;
        }

        // Self-closing <Avatar /> can never contain a fallback child.
        if (node.openingElement.selfClosing) {
          context.report({
            node,
            messageId: "missingFallback",
          });
          return;
        }

        if (!hasFallbackChild(node.children)) {
          context.report({
            node,
            messageId: "missingFallback",
          });
        }
      },
    };
  },
};
