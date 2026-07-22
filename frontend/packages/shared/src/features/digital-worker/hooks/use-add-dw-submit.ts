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

import { toast } from "@sico/ui";

import { useCreateAgentInstanceMutation } from "./use-create-agent-mutation";
import { apiErrorMessage } from "../../../utils/api-error-message";
import { type SingleAgentCard } from "../../studio/schemas/single-agent-card";
import { type AddDwValues } from "../components/add-dw-fields";

type UseAddDwSubmit = {
  onSubmit: (values: AddDwValues) => void;
  isPending: boolean;
};

/**
 * Encapsulates the Add DW create flow: validates the signed-in user, resolves
 * the role from the picked template, fires the create mutation, and toasts
 * success/error (closing the dialog on success). Returns the RHF submit handler
 * plus the pending flag for the footer button.
 */
export function useAddDwSubmit(
  email: string | undefined,
  templates: SingleAgentCard[],
  onClose: () => void,
): UseAddDwSubmit {
  const mutation = useCreateAgentInstanceMutation();

  const onSubmit = (values: AddDwValues): void => {
    if (!email) {
      toast.error("You must be signed in to add a digital worker.");
      return;
    }
    const role = templates.find((t) => t.agentId === values.agentId)?.role;
    mutation.mutate(
      {
        agentId: values.agentId,
        name: values.name,
        role,
        iconUri: values.iconUri,
        employerUsername: email,
        projectId: Number(values.projectId),
      },
      {
        onSuccess: () => {
          toast.success("Digital worker added.", { invert: true });
          onClose();
        },
        onError: (error) => {
          toast.error(
            apiErrorMessage(error, "We couldn't add the digital worker."),
          );
        },
      },
    );
  };

  return { onSubmit, isPending: mutation.isPending };
}
