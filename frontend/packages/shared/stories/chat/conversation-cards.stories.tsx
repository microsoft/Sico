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

import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { AxiosInstance } from "axios";
import type { ReactElement } from "react";

import type { MessageAttachment } from "@/features/chat/atoms/chat-atom";
import { AgentCard } from "@/features/chat/components/cards/agent-card";
import { UserCard } from "@/features/chat/components/cards/user-card";
import { AttachmentList } from "@/features/chat/components/message/attachment-list";
import { ExperiencePill } from "@/features/chat/components/message/experience-pill";
import { Timestamp } from "@/features/chat/components/message/timestamp";
import { ChatAgentProvider } from "@/features/chat/services/chat-agent-context";
import type { Agent } from "@/features/digital-worker";
import { ApiClientProvider } from "@/services/api-client-context";

// Scenario stories for the conversation leaf cards. Rather than isolate each
// component, these compose them into the real turn shapes MessageCard builds —
// a user question with an attachment, an agent reply with an experience pill +
// timestamp — using strings/attachments captured from the dw/385 conversation,
// so the layout reads the way the live thread does. Each card is also reachable
// on its own via the Controls in the focused stories at the bottom.

// A real captured turn time (dw/385); fixed so the timestamp render is stable.
const CREATED_AT = 1778310340511;

// A real sent attachment from turn 29 (an .xlsx → the file-card branch).
const XLSX_ATTACHMENT: MessageAttachment = {
  id: "att-1",
  name: "test_demo 2.xlsx",
  size: 18_000,
  type: "document",
  uri: "default_space/7637415111316996096.xlsx",
  sasUrl: "https://example.test/test_demo-2.xlsx",
};

// A trimmed real agent reply (turn 29) exercising Markdown headings + lists.
const AGENT_MARKDOWN = `I have analyzed the test case provided in the Excel file:

- **Title:** Sync Settings Bottom Sheet via Sign-In Path
- **Description:** Open Edge, tap Sign in, then tap "Sync settings".

## Status: Blocked

This is an **Android** test case, which needs an Android emulator to run.`;

// Real reply (turn 6) with two GFM tables + headings + blockquote + lists —
// the richest Markdown sample the dw/385 capture carries.
const AGENT_MARKDOWN_TABLE = `## Execution Summary

| Item | Value |
|------|-------|
| Total test cases | 1 |
| Passed | 0 |
| Failed | 0 |
| Blocked | 1 |
| Execution success rate | 0% |

## Detailed Results

- **Case Name**: Edge close all tabs on Windows
- **Status**: Blocked
- **Failure reason**: No assigned Windows sandbox available

> No assigned wincua sandbox is currently available for acquire.`;

// Real reply (turn 5) rich in inline code, numbered + bullet lists, headings.
const AGENT_MARKDOWN_RICH = `## What I did

- Loaded the \`web-regression-testing\` skill instructions
- Tried to acquire a **Windows (\`wincua\`) sandbox**
- Retried once as required by the skill

## Test case prepared

1. Open Microsoft Edge on Windows desktop.
2. Open 3 websites in 3 separate tabs.
3. Trigger the **Close all tabs** action.
4. Verify all tabs are closed.`;

// The dw/385 capture has NO fenced code block and NO markdown link (verified),
// so these two cases are hand-authored to cover those Markdown render paths.
const AGENT_MARKDOWN_CODE = `Here's a minimal Playwright check:

\`\`\`ts
test("closes all tabs", async ({ page }) => {
  await page.goto("edge://settings");
  await page.getByRole("button", { name: "Close all" }).click();
});
\`\`\`

Run it with \`npx playwright test\`.`;

const AGENT_MARKDOWN_LINK = `See the [Playwright docs](https://playwright.dev/docs/intro) for setup, and the [Edge release notes](https://learn.microsoft.com/deployedge/microsoft-edge-relnote-stable-channel) for the build under test.`;

// The conversation column the live thread renders in (right-aligned user
// bubbles, left-aligned agent content), so each scenario reads in context.
function Column({ children }: { children: ReactElement }): ReactElement {
  return (
    <div className="bg-background max-w-190 p-4">
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

// One rendered turn: the data-author wrapper MessageCard uses so user turns
// right-align and agent turns left-align. Mirrors MessageCard's root `gap-4`
// (the uniform 16px part spacing, Figma 18991-47827) so the stories read the
// way the live turn does.
function Turn({
  author,
  children,
}: {
  author: "human" | "ai";
  children: ReactElement;
}): ReactElement {
  return (
    <div
      data-author={author}
      className="flex flex-col gap-4 data-[author=human]:items-end"
    >
      {children}
    </div>
  );
}

type StoryArgs = Record<string, never>;

// ExperiencePill reads the live agent (for its owning projectId) and calls
// `useNavigate`, so the stories need the chat providers + a router in context. A
// memory router with the nested experience-detail route the pill jumps to
// (`/project/$projectId/experience/$assetId`) keeps the jump live, and a seeded
// agent gives `View more` a real projectId.
const STORY_AGENT_ID = 601;
const storyAgent: Agent = {
  id: STORY_AGENT_ID,
  name: "Max",
  project: { id: 84, name: "SICO" },
};

function withRouter(Story: () => ReactElement): ReactElement {
  const rootRoute = createRootRoute({ component: Story });
  const experienceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/project/$projectId/experience/$assetId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([experienceRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData(["agents", "detail", STORY_AGENT_ID], storyAgent);
  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={{} as AxiosInstance}>
        <ChatAgentProvider agentInstanceId={STORY_AGENT_ID} conversationId={1}>
          <RouterProvider router={router} />
        </ChatAgentProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}

const meta: Meta<StoryArgs> = {
  title: "Chat/ConversationCards",
  parameters: { layout: "fullscreen" },
  decorators: [withRouter],
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** A user turn that sent a file: the AttachmentList file card sits above the
 *  lavender UserCard bubble (Figma 17506-138317, P8/P9). */
export const UserTurnWithAttachment: Story = {
  render: (): ReactElement => (
    <Column>
      <Turn author="human">
        <>
          <AttachmentList attachments={[XLSX_ATTACHMENT]} />
          <UserCard text="run test cases in this excel file" />
        </>
      </Turn>
    </Column>
  ),
};

/** A completed agent turn: the Markdown reply, then the Experience pill and the
 *  per-turn timestamp as siblings below it (Figma 18991-47827, P21). */
export const AgentTurnCompleted: Story = {
  render: (): ReactElement => (
    <Column>
      <Turn author="ai">
        <>
          <AgentCard text={AGENT_MARKDOWN} />
          <ExperiencePill experienceCount={5} planCompleted playbookId={42} />
          <Timestamp createdAt={CREATED_AT} />
        </>
      </Turn>
    </Column>
  ),
};

/** A two-turn exchange — a short user question and the agent's short reply —
 *  the plainest back-and-forth shape. */
export const ShortExchange: Story = {
  render: (): ReactElement => (
    <Column>
      <>
        <Turn author="human">
          <UserCard text="test closing all tabs on Edge" />
        </Turn>
        <Turn author="ai">
          <>
            <AgentCard text="To generate good test cases, I need a bit more scope. Which Edge — desktop or mobile?" />
            <Timestamp createdAt={CREATED_AT} />
          </>
        </Turn>
      </>
    </Column>
  ),
};

/** The Experience pill in isolation across its three states: a positive count
 *  (opens the popover — the `New strategies` row + a live `View more` that
 *  navigates to the playbook detail), the `Generating experience` fallback on a
 *  completed plan with no count, and nothing while a plan still runs. */
export const ExperiencePillStates: Story = {
  render: (): ReactElement => (
    <div className="bg-background flex flex-col items-start gap-3 p-4">
      <ExperiencePill experienceCount={5} planCompleted playbookId={42} />
      <ExperiencePill experienceCount={0} planCompleted />
      <ExperiencePill experienceCount={0} planCompleted={false} />
    </div>
  ),
};

/** AgentCard Markdown variants — the render paths react-markdown + remark-gfm
 *  cover. Tables, inline code, lists, headings, and blockquote use real dw/385
 *  replies; the fenced code block and links are hand-authored (the capture has
 *  neither). Stacked so every element type is visible at once. */
export const AgentMarkdownVariants: Story = {
  render: (): ReactElement => (
    <Column>
      <>
        <Turn author="ai">
          <AgentCard text={AGENT_MARKDOWN_TABLE} />
        </Turn>
        <Turn author="ai">
          <AgentCard text={AGENT_MARKDOWN_RICH} />
        </Turn>
        <Turn author="ai">
          <AgentCard text={AGENT_MARKDOWN_CODE} />
        </Turn>
        <Turn author="ai">
          <AgentCard text={AGENT_MARKDOWN_LINK} />
        </Turn>
      </>
    </Column>
  ),
};

/** A streaming agent reply — `streaming` splits the body into a settled prefix
 *  + a live tail, each its own memoized block (§6.E7c). Visually identical to a
 *  settled reply; this pins the streaming render path. */
export const AgentStreaming: Story = {
  render: (): ReactElement => (
    <Column>
      <Turn author="ai">
        <AgentCard text={AGENT_MARKDOWN_RICH} streaming />
      </Turn>
    </Column>
  ),
};
