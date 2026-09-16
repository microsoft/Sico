import { Trans, useLingui } from "@lingui/react/macro";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@sico/ui";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { Ellipsis, LogOut } from "lucide-react";
import { type JSX } from "react";

import { ManageOrganizationMenuItem } from "./manage-organization-menu-item";
import { OrganizationAccountMenuSection } from "./organization-account-menu-section";
import { SwitchToSicoDevMenuItem } from "./switch-to-sico-dev-menu-item";
import {
  type LocalePreference,
  localePreferenceAtom,
} from "../../../atoms/locale-atom";
import { useOrganizationPermission } from "../../rbac/hooks/use-organization-permission";
import { useLogout } from "../../rbac-login/hooks/use-logout";
import { useRouteMode } from "../hooks/use-route-mode";

const LANGUAGE_ITEMS: readonly {
  readonly value: LocalePreference;
  readonly label: string;
}[] = [
  { value: "auto", label: "Auto detect" },
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
];

export function SidebarAccountMenu(): JSX.Element {
  const { t } = useLingui();
  const [localePreference, setLocalePreference] = useAtom(localePreferenceAtom);
  const userMode = useRouteMode();
  const navigate = useNavigate();
  const logout = useLogout();
  const permission = useOrganizationPermission();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="subtle"
            size="icon-xs"
            aria-label={t({
              id: "sidebar.footer.accountOptions",
              message: "Account options",
            })}
          />
        }
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-49">
        <OrganizationAccountMenuSection>
          <ManageOrganizationMenuItem
            visible={permission.canManage}
            onSelect={() => {
              void navigate({ to: "/organization" });
            }}
          />
        </OrganizationAccountMenuSection>
        {userMode === "operator" ? (
          <SwitchToSicoDevMenuItem
            visible={permission.canEnterStudio}
            onSelect={() => {
              void navigate({ to: "/studio/all", replace: true });
            }}
          />
        ) : (
          <DropdownMenuItem
            onClick={() => {
              void navigate({ to: "/digital-worker", replace: true });
            }}
          >
            <Trans id="sidebar.footer.goToSico">Go to SICO</Trans>
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {t({ id: "sidebar.footer.language", message: "Language" })}
          </DropdownMenuSubTrigger>
          {/* Base UI measures from the trigger edge; add the parent menu's
              4px content padding to keep 6px between the two popup borders. */}
          <DropdownMenuSubContent sideOffset={10}>
            <DropdownMenuRadioGroup
              value={localePreference}
              onValueChange={(next: string) => {
                if (next === "auto" || next === "en" || next === "zh-CN") {
                  setLocalePreference(next);
                }
              }}
            >
              {LANGUAGE_ITEMS.map((item) => (
                <DropdownMenuRadioItem key={item.value} value={item.value}>
                  {item.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => logout.mutate()}>
          <LogOut
            data-testid="sidebar-logout-icon"
            aria-hidden="true"
            className="size-3"
          />
          <Trans id="sidebar.footer.logout">Log out</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
