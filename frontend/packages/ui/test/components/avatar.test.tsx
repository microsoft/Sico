import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";

describe("Avatar", () => {
  it("renders without throwing", (): void => {
    render(
      <Avatar data-testid="avatar">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByTestId("avatar")).toBeInTheDocument();
  });

  it("applies the root base classes", (): void => {
    render(
      <Avatar data-testid="avatar">
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    const avatar = screen.getByTestId("avatar");
    expect(avatar).toHaveClass("group/avatar");
    expect(avatar).toHaveClass("relative");
    expect(avatar).toHaveClass("rounded-full");
    expect(avatar).toHaveClass("after:border-divider");
  });

  describe("sizes", () => {
    it("size=xs → size-5", (): void => {
      render(
        <Avatar size="xs" data-testid="avatar">
          <AvatarFallback>A</AvatarFallback>
        </Avatar>,
      );
      expect(screen.getByTestId("avatar")).toHaveClass("data-[size=xs]:size-5");
    });

    it("size=sm → size-6", (): void => {
      render(
        <Avatar size="sm" data-testid="avatar">
          <AvatarFallback>A</AvatarFallback>
        </Avatar>,
      );
      expect(screen.getByTestId("avatar")).toHaveClass("data-[size=sm]:size-6");
    });

    it("size=default → size-8 (root base size)", (): void => {
      render(
        <Avatar data-testid="avatar">
          <AvatarFallback>A</AvatarFallback>
        </Avatar>,
      );
      expect(screen.getByTestId("avatar")).toHaveClass("size-8");
    });

    it("size=lg → size-10", (): void => {
      render(
        <Avatar size="lg" data-testid="avatar">
          <AvatarFallback>A</AvatarFallback>
        </Avatar>,
      );
      expect(screen.getByTestId("avatar")).toHaveClass(
        "data-[size=lg]:size-10",
      );
    });

    it("size=2xl → size-12", (): void => {
      render(
        <Avatar size="2xl" data-testid="avatar">
          <AvatarFallback>A</AvatarFallback>
        </Avatar>,
      );
      expect(screen.getByTestId("avatar")).toHaveClass(
        "data-[size=2xl]:size-12",
      );
    });
  });

  describe("AvatarFallback", () => {
    it("applies fallback base classes (layout + tokens)", (): void => {
      render(
        <Avatar>
          <AvatarFallback data-testid="fallback">AB</AvatarFallback>
        </Avatar>,
      );
      const fallback = screen.getByTestId("fallback");
      expect(fallback).toHaveClass("flex");
      expect(fallback).toHaveClass("items-center");
      expect(fallback).toHaveClass("justify-center");
      expect(fallback).toHaveClass("rounded-full");
      expect(fallback).toHaveClass("bg-surface-sunken");
      expect(fallback).toHaveClass("text-foreground-tertiary");
      expect(fallback).toHaveClass("text-sm");
    });

    it("size=sm parent → text-xs on fallback", (): void => {
      render(
        <Avatar size="sm">
          <AvatarFallback data-testid="fallback">AB</AvatarFallback>
        </Avatar>,
      );
      expect(screen.getByTestId("fallback")).toHaveClass(
        "group-data-[size=sm]/avatar:text-xs",
      );
    });

    it("size=xs parent → text-xs on fallback", (): void => {
      render(
        <Avatar size="xs">
          <AvatarFallback data-testid="fallback">AB</AvatarFallback>
        </Avatar>,
      );
      expect(screen.getByTestId("fallback")).toHaveClass(
        "group-data-[size=xs]/avatar:text-xs",
      );
    });
  });

  describe("AvatarBadge", () => {
    it("applies badge base classes (tokens + ring)", (): void => {
      render(
        <Avatar>
          <AvatarFallback>A</AvatarFallback>
          <AvatarBadge data-testid="badge" />
        </Avatar>,
      );
      const badge = screen.getByTestId("badge");
      expect(badge).toHaveClass("bg-surface-inverted");
      expect(badge).toHaveClass("text-foreground-on-inverted");
      expect(badge).toHaveClass("ring-2");
      expect(badge).toHaveClass("ring-surface-basic");
      expect(badge).toHaveClass("rounded-full");
    });

    it("size=xs parent → badge size-1.5 + svg hidden", (): void => {
      render(
        <Avatar size="xs">
          <AvatarFallback>A</AvatarFallback>
          <AvatarBadge data-testid="badge" />
        </Avatar>,
      );
      expect(screen.getByTestId("badge")).toHaveClass(
        "group-data-[size=xs]/avatar:size-1.5",
      );
    });

    it("size=sm parent → badge size-2 + svg hidden", (): void => {
      render(
        <Avatar size="sm">
          <AvatarFallback>A</AvatarFallback>
          <AvatarBadge data-testid="badge" />
        </Avatar>,
      );
      expect(screen.getByTestId("badge")).toHaveClass(
        "group-data-[size=sm]/avatar:size-2",
      );
    });

    it("size=default parent → badge size-2.5", (): void => {
      render(
        <Avatar>
          <AvatarFallback>A</AvatarFallback>
          <AvatarBadge data-testid="badge" />
        </Avatar>,
      );
      expect(screen.getByTestId("badge")).toHaveClass(
        "group-data-[size=default]/avatar:size-2.5",
      );
    });

    it("size=lg parent → badge size-3", (): void => {
      render(
        <Avatar size="lg">
          <AvatarFallback>A</AvatarFallback>
          <AvatarBadge data-testid="badge" />
        </Avatar>,
      );
      expect(screen.getByTestId("badge")).toHaveClass(
        "group-data-[size=lg]/avatar:size-3",
      );
    });

    it("size=2xl parent → badge size-3.5", (): void => {
      render(
        <Avatar size="2xl">
          <AvatarFallback>A</AvatarFallback>
          <AvatarBadge data-testid="badge" />
        </Avatar>,
      );
      expect(screen.getByTestId("badge")).toHaveClass(
        "group-data-[size=2xl]/avatar:size-3.5",
      );
    });
  });

  describe("AvatarGroup", () => {
    it("applies group base classes (stacking + ring)", (): void => {
      render(
        <AvatarGroup data-testid="group">
          <Avatar>
            <AvatarFallback>A</AvatarFallback>
          </Avatar>
        </AvatarGroup>,
      );
      const group = screen.getByTestId("group");
      expect(group).toHaveClass("group/avatar-group");
      expect(group).toHaveClass("-space-x-2");
      expect(group).toHaveClass("*:data-[slot=avatar]:ring-2");
      expect(group).toHaveClass("*:data-[slot=avatar]:ring-surface-basic");
    });
  });

  describe("AvatarGroupCount", () => {
    it("applies count base classes (tokens + ring)", (): void => {
      render(
        <AvatarGroup>
          <AvatarGroupCount data-testid="count">+3</AvatarGroupCount>
        </AvatarGroup>,
      );
      const count = screen.getByTestId("count");
      expect(count).toHaveClass("bg-surface-sunken");
      expect(count).toHaveClass("text-foreground-tertiary");
      expect(count).toHaveClass("ring-2");
      expect(count).toHaveClass("ring-surface-basic");
      expect(count).toHaveClass("rounded-full");
    });

    it("group size=xs → count size-5", (): void => {
      render(
        <AvatarGroup data-size="xs">
          <AvatarGroupCount data-testid="count">+3</AvatarGroupCount>
        </AvatarGroup>,
      );
      expect(screen.getByTestId("count")).toHaveClass(
        "group-has-data-[size=xs]/avatar-group:size-5",
      );
    });

    it("group size=sm → count size-6", (): void => {
      render(
        <AvatarGroup data-size="sm">
          <AvatarGroupCount data-testid="count">+3</AvatarGroupCount>
        </AvatarGroup>,
      );
      expect(screen.getByTestId("count")).toHaveClass(
        "group-has-data-[size=sm]/avatar-group:size-6",
      );
    });

    it("group size=lg → count size-10", (): void => {
      render(
        <AvatarGroup data-size="lg">
          <AvatarGroupCount data-testid="count">+3</AvatarGroupCount>
        </AvatarGroup>,
      );
      expect(screen.getByTestId("count")).toHaveClass(
        "group-has-data-[size=lg]/avatar-group:size-10",
      );
    });

    it("group size=2xl → count size-12", (): void => {
      render(
        <AvatarGroup data-size="2xl">
          <AvatarGroupCount data-testid="count">+3</AvatarGroupCount>
        </AvatarGroup>,
      );
      expect(screen.getByTestId("count")).toHaveClass(
        "group-has-data-[size=2xl]/avatar-group:size-12",
      );
    });
  });
});
