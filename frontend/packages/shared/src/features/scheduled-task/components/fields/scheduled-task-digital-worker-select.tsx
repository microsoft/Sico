import { useLingui } from "@lingui/react/macro";
import {
  Button,
  Field,
  FieldError,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@sico/ui";
import { type JSX } from "react";
import { type Control, Controller } from "react-hook-form";

import { DwAvatar } from "../../../../components/dw-avatar";
import { logger } from "../../../../utils/logger";
import { type Agent } from "../../../digital-worker/schemas/agent";
import { type ScheduledTaskFormValues } from "../../schemas/scheduled-task-form";

type Props = {
  agents: Agent[];
  control: Control<ScheduledTaskFormValues>;
  disabled: boolean;
  fetchNextPage: () => Promise<unknown>;
  hasNextPage: boolean;
  isError: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
  placeholder: string;
};

function loadMoreWorkers(fetchNextPage: () => Promise<unknown>): void {
  fetchNextPage().catch((error: unknown) => {
    logger.error("scheduled task: load more workers failed", { error });
  });
}

function agentLabel(agent: Agent): string {
  return agent.role ? `${agent.name}, ${agent.role}` : agent.name;
}

function renderWorkerOptions(agents: Agent[]): JSX.Element {
  return (
    <SelectContent
      align="start"
      alignItemWithTrigger={false}
      sideOffset={8}
      data-testid="scheduled-task-worker-options"
      className="max-h-60 !w-56"
    >
      {agents.map((agent) => (
        <SelectItem
          key={agent.id}
          value={String(agent.id)}
          label={agentLabel(agent)}
          className="text-foreground-primary"
        >
          <DwAvatar agent={agent} size="xs" decorative />
          <span className="max-w-32 truncate">{agentLabel(agent)}</span>
        </SelectItem>
      ))}
    </SelectContent>
  );
}

type TriggerProps = {
  invalid: boolean | undefined;
  placeholder: string;
  agents: Agent[];
};

function renderWorkerSelectTrigger({
  invalid,
  placeholder,
  agents,
}: TriggerProps): JSX.Element {
  return (
    <SelectTrigger
      id="scheduled-task-worker"
      size="sm"
      aria-invalid={invalid ? true : undefined}
      aria-required="true"
      className="hover:bg-button-subtle-fill-hover max-w-56 border-transparent px-2 py-0 data-[size=sm]:h-6"
    >
      <SelectValue placeholder={placeholder}>
        {(value: string | null) => {
          const selectedAgent = agents.find(
            (agent) => String(agent.id) === value,
          );
          return (
            <span className="flex min-w-0 items-center gap-1.5">
              {selectedAgent ? (
                <DwAvatar agent={selectedAgent} size="xs" decorative />
              ) : null}
              <span className="truncate">
                {selectedAgent ? agentLabel(selectedAgent) : placeholder}
              </span>
            </span>
          );
        }}
      </SelectValue>
    </SelectTrigger>
  );
}

export function ScheduledTaskDigitalWorkerSelect({
  agents,
  control,
  disabled,
  fetchNextPage,
  hasNextPage,
  isError,
  isFetchingNextPage,
  isPending,
  placeholder,
}: Props): JSX.Element {
  const { t } = useLingui();
  return (
    <Controller
      name="agentInstanceId"
      control={control}
      render={({ field, fieldState }) => (
        <Field
          data-invalid={fieldState.invalid ? true : undefined}
          orientation="horizontal"
          className="w-auto gap-0"
        >
          <FieldLabel htmlFor="scheduled-task-worker" className="sr-only">
            {t({
              id: "scheduledTask.form.worker.label",
              message: "Digital Worker",
            })}
          </FieldLabel>
          <Select
            items={agents.map((agent) => ({
              value: String(agent.id),
              label: agentLabel(agent),
            }))}
            value={field.value > 0 ? String(field.value) : null}
            onValueChange={(value) =>
              field.onChange(value === null ? 0 : Number(value))
            }
            disabled={disabled || isPending}
          >
            {renderWorkerSelectTrigger({
              invalid: fieldState.invalid,
              placeholder,
              agents,
            })}
            {renderWorkerOptions(agents)}
          </Select>
          {hasNextPage ? (
            <Button
              type="button"
              variant="subtle"
              size="sm"
              className="self-start"
              disabled={isFetchingNextPage}
              onClick={() => loadMoreWorkers(fetchNextPage)}
            >
              {t({
                id: "scheduledTask.form.worker.loadMore",
                message: "Load more workers",
              })}
            </Button>
          ) : null}
          {isError ? (
            <FieldError>
              {t({
                id: "scheduledTask.form.worker.loadError",
                message: "Couldn't load Digital Workers. Try again.",
              })}
            </FieldError>
          ) : null}
          {fieldState.error?.message ? (
            <FieldError>{fieldState.error.message}</FieldError>
          ) : null}
        </Field>
      )}
    />
  );
}
