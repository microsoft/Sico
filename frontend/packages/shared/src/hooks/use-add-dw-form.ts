import { zodResolver } from "@hookform/resolvers/zod";
import {
  type FormEventHandler,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useForm, type UseFormReturn } from "react-hook-form";

import { type ImageUpload, useImageUpload } from "./use-image-upload";
import {
  ADD_DW_INITIAL_VALUES,
  addDwSchema,
  type AddDwValues,
} from "../features/digital-worker/components/add-dw-fields";
import {
  DW_AVATAR_PRESETS,
  type DwAvatarPreset,
} from "../features/digital-worker/constants";
import { loadAvatarPreset } from "../features/digital-worker/services/load-avatar-preset";

type AddDwFormOptions = {
  open: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: AddDwValues, signal: AbortSignal) => Promise<void>;
  initialValues?: AddDwValues;
};

type AddDwForm = {
  form: UseFormReturn<AddDwValues>;
  preset: DwAvatarPreset;
  onSelectPreset: (preset: DwAvatarPreset) => void;
  isSaving: boolean;
  isUploading: boolean;
  handleOpenChange: (open: boolean) => void;
  handleSubmit: FormEventHandler<HTMLFormElement>;
};

type SubmitContext = Pick<
  AddDwFormOptions,
  "onSubmit" | "open" | "isPending"
> & {
  form: UseFormReturn<AddDwValues>;
  preset: DwAvatarPreset;
  upload: ImageUpload;
};
type DwSubmission = {
  isSaving: boolean;
  cancel: () => void;
  handleSubmit: FormEventHandler<HTMLFormElement>;
};

async function submitPreset(
  ctx: SubmitContext,
  signal: AbortSignal,
): Promise<void> {
  // Read afresh after awaits; the same AbortSignal can change while suspended.
  const isCancelled = (): boolean => signal.aborted;
  await ctx.form.handleSubmit(async (values) => {
    if (isCancelled()) {
      return;
    }
    const file = await loadAvatarPreset(ctx.preset, signal);
    if (!file || isCancelled()) {
      return;
    }
    const uri = await ctx.upload.uploadFile(file);
    if (uri && !isCancelled()) {
      await ctx.onSubmit({ ...values, iconUri: uri }, signal);
    }
  })();
}

function useDwSubmission(ctx: SubmitContext): DwSubmission {
  const [isSaving, setIsSaving] = useState(false);
  const activeRef = useRef<AbortController | null>(null);
  const blockedRef = useRef(false);
  blockedRef.current = !ctx.open || ctx.isPending;
  const { reset } = ctx.upload;
  const cancel = useCallback((): void => {
    activeRef.current?.abort();
    activeRef.current = null;
    reset();
    setIsSaving(false);
  }, [reset]);
  useEffect(
    () => () => {
      activeRef.current?.abort();
      activeRef.current = null;
    },
    [],
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (blockedRef.current || activeRef.current) {
      return;
    }
    const attempt = new AbortController();
    activeRef.current = attempt;
    setIsSaving(true);
    // Lock before RHF validation and local asset loading, not only the upload.
    void submitPreset(ctx, attempt.signal).finally(() => {
      if (activeRef.current === attempt) {
        activeRef.current = null;
        setIsSaving(false);
      }
    });
  };
  return { isSaving, cancel, handleSubmit };
}

function useAvatarPreset(
  open: boolean,
  initialValues: AddDwValues,
): Pick<AddDwForm, "preset" | "onSelectPreset"> {
  const [selection, setSelection] = useState<{
    open: boolean;
    initialValues: AddDwValues;
    preset: DwAvatarPreset;
  }>({ open, initialValues, preset: DW_AVATAR_PRESETS[0] });
  const current =
    selection.open === open && selection.initialValues === initialValues;
  if (!current) {
    setSelection({ open, initialValues, preset: DW_AVATAR_PRESETS[0] });
  }
  return {
    preset: current ? selection.preset : DW_AVATAR_PRESETS[0],
    onSelectPreset: (preset) =>
      setSelection((previous) => ({ ...previous, preset })),
  };
}

export function useAddDwForm({
  open,
  isPending,
  onOpenChange,
  onSubmit,
  initialValues = ADD_DW_INITIAL_VALUES,
}: AddDwFormOptions): AddDwForm {
  const form = useForm<AddDwValues>({
    resolver: zodResolver(addDwSchema),
    defaultValues: initialValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
  const { preset, onSelectPreset } = useAvatarPreset(open, initialValues);
  const upload = useImageUpload((uri) => form.setValue("iconUri", uri ?? ""));
  const { isSaving, cancel, handleSubmit } = useDwSubmission({
    form,
    preset,
    upload,
    open,
    isPending,
    onSubmit,
  });
  useEffect(() => {
    cancel();
    if (open) {
      form.reset(initialValues);
    }
  }, [open, form, initialValues, cancel]);
  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) {
      cancel();
    }
    onOpenChange(nextOpen);
  };
  return {
    form,
    preset,
    onSelectPreset,
    handleOpenChange,
    handleSubmit,
    isSaving: isSaving || isPending,
    isUploading: isSaving && !isPending,
  };
}
