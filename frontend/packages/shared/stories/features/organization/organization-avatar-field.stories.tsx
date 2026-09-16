import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios, { type AxiosAdapter } from "axios";
import {
  createRef,
  type JSX,
  type ReactNode,
  type RefObject,
  useRef,
  useState,
} from "react";

import avatarImage from "@/assets/dw-avatars/7661735044884463616.png";
import {
  ORGANIZATION_ENDPOINTS,
  PROJECT_ENDPOINTS,
} from "@/constants/endpoints";
import { EditOrgNameDialog } from "@/features/organization/components/edit-org-name-dialog";
import { OrganizationAvatarField } from "@/features/organization/components/organization-avatar-field";
import { makeOkEnvelope } from "@/schemas/api";
import { ApiClientProvider } from "@/services/api-client-context";

// Static Storybook uses source-copy fixtures instead of generated catalogs.
i18n.load("en", {
  "common.action.cancel": "Cancel",
  "common.action.save": "Save",
  "organization.edit.failed": "Couldn't update this organization.",
  "organization.edit.success": "Organization updated.",
  "organization.editName.avatar.label": "Organization avatar",
  "organization.editName.avatar.choose": "Choose organization avatar",
  "organization.editName.avatar.change": "Change avatar",
  "organization.editName.avatar.fileInput": "Organization avatar file",
  "organization.editName.label": "Organization name",
  "organization.editName.placeholder": "Enter organization name",
  "organization.edit.title": "Edit Organization",
  "organization.editName.validation.required": "Organization name is required",
});
if (!i18n.locale) {
  i18n.activate("en");
}

function StoryWithInputRef({
  children,
}: {
  readonly children: (
    inputRef: RefObject<HTMLInputElement | null>,
  ) => ReactNode;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  return <>{children(inputRef)}</>;
}

// This adapter intentionally mocks only the dialog's image-upload and update calls.
const dialogAdapter: AxiosAdapter = async (config) => {
  if (config.method === "post" && config.url === PROJECT_ENDPOINTS.asset) {
    return {
      config,
      data: makeOkEnvelope({
        id: 1,
        sasUrl: "https://mock.example/organization-avatar.png",
        uri: "/organization-avatar.png",
        metaInfo: {
          fileName: "avatar.png",
          fileSize: 1024,
          fileType: "image",
          contentType: "image/png",
          fileExt: "png",
        },
      }),
      headers: {},
      status: 200,
      statusText: "OK",
    };
  }
  if (config.method === "put" && config.url === ORGANIZATION_ENDPOINTS.root) {
    return {
      config,
      data: makeOkEnvelope({}),
      headers: {},
      status: 200,
      statusText: "OK",
    };
  }
  throw new Error(`Unhandled story request: ${config.url}`);
};

function EditDialogStory(): JSX.Element {
  const [apiClient] = useState(() => axios.create({ adapter: dialogAdapter }));
  const [open, setOpen] = useState(true);
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <EditOrgNameDialog
          organizationId={1}
          currentName="Sico"
          currentIconUrl={avatarImage}
          open={open}
          onOpenChange={setOpen}
        />
      </ApiClientProvider>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Components/OrganizationAvatarField",
  component: OrganizationAvatarField,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <I18nProvider i18n={i18n}>
        <StoryWithInputRef>
          {(inputRef) => (
            <div className="w-80">
              <Story args={{ inputRef }} />
            </div>
          )}
        </StoryWithInputRef>
      </I18nProvider>
    ),
  ],
  args: {
    name: "Sico",
    inputRef: createRef<HTMLInputElement>(),
    onPick: async (): Promise<void> => {},
    uploading: false,
    disabled: false,
  },
} satisfies Meta<typeof OrganizationAvatarField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The initial-letter fallback shown before the organization has an avatar. */
export const Default: Story = {};

/** A persisted organization image replaces the initial-letter fallback. */
export const SavedImage: Story = {
  args: { currentIconUrl: avatarImage },
};

/** The pending upload overlay keeps the selected avatar visible while work runs. */
export const Uploading: Story = {
  args: { currentIconUrl: avatarImage, uploading: true },
};

/** The disabled field prevents opening the native image picker during saving. */
export const Disabled: Story = {
  args: { disabled: true },
};

/** A failing image request leaves the organization initial visible as a fallback. */
export const ImageFailureFallback: Story = {
  args: { currentIconUrl: "https://invalid.example/organization-avatar.png" },
};

/** The field composed in its live edit dialog with isolated mocked API responses. */
export const InEditDialog: Story = {
  parameters: {
    docs: {
      source: {
        code: '<EditOrgNameDialog organizationId={1} currentName="Sico" open onOpenChange={setOpen} />',
      },
    },
  },
  render: () => <EditDialogStory />,
};
