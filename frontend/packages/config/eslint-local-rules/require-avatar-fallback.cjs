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
