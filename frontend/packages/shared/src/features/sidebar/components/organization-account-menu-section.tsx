import { Trans, useLingui } from "@lingui/react/macro";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@sico/ui";
import { useSetAtom } from "jotai";
import { type JSX, type PropsWithChildren } from "react";

import { useBoundOrganizationQuery } from "../../../hooks/use-bound-organization";
import { selectedOrganizationIdAtom } from "../../organization/atoms/selected-organization-atom";
import { OrganizationAvatar } from "../../organization/components/organization-avatar";
import { useUserOrganizationsQuery } from "../../organization/hooks/use-organization-query";

export function OrganizationAccountMenuSection({
  children,
}: PropsWithChildren): JSX.Element | null {
  const { t } = useLingui();
  const organizations = useUserOrganizationsQuery();
  const currentOrganization = useBoundOrganizationQuery();
  const setSelectedOrganizationId = useSetAtom(selectedOrganizationIdAtom);

  if (organizations.isError || currentOrganization.isError) {
    return (
      <DropdownMenuItem disabled>
        <Trans id="sidebar.footer.organizationsLoadError">
          Couldn&apos;t load organizations
        </Trans>
      </DropdownMenuItem>
    );
  }
  if (organizations.isPending || currentOrganization.isPending) {
    return (
      <DropdownMenuItem disabled>
        <Trans id="sidebar.footer.organizationsLoading">
          Loading organizations…
        </Trans>
      </DropdownMenuItem>
    );
  }
  if (!currentOrganization.data) {
    return null;
  }

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel
          className="text-foreground-primary flex items-center gap-2"
          data-testid="current-organization"
        >
          <span aria-hidden className="shrink-0">
            <OrganizationAvatar
              name={currentOrganization.data.name}
              iconUrl={currentOrganization.data.iconUrl}
            />
          </span>
          <span className="flex min-w-0 flex-1 flex-col items-start">
            <span className="w-full truncate text-sm font-normal">
              {currentOrganization.data.name}
            </span>
            <span className="text-foreground-tertiary text-xs font-normal">
              {t({
                id: "sidebar.footer.currentOrganization",
                message: "Current Organization",
              })}
            </span>
          </span>
        </DropdownMenuLabel>
      </DropdownMenuGroup>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          {t({
            id: "sidebar.footer.switchOrganization",
            message: "Switch Organization",
          })}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent sideOffset={10} className="min-w-49">
          <DropdownMenuRadioGroup
            value={String(currentOrganization.data.id)}
            onValueChange={(value) => {
              const selected = organizations.data.find(
                ({ id }) => String(id) === value,
              );
              if (selected && selected.id !== currentOrganization.data?.id) {
                setSelectedOrganizationId(selected.id);
                window.location.reload();
              }
            }}
          >
            {organizations.data.map((organization) => (
              <DropdownMenuRadioItem
                key={organization.id}
                value={String(organization.id)}
                label={organization.name}
              >
                <span aria-hidden className="shrink-0">
                  <OrganizationAvatar
                    name={organization.name}
                    iconUrl={organization.iconUrl}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {organization.name}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {children}
      <DropdownMenuSeparator />
    </>
  );
}
