import { InputGroupButton } from "@sico/ui";
import { Plus } from "lucide-react";
import { type ChangeEvent, type JSX, useRef } from "react";

type Props = {
  onAddFile: (file: File) => void;
};

// The composer's attach control: a circular `+` trigger wired to a hidden
// file input (Figma 19358:64589).
export function ComposerAttachButton({ onAddFile }: Props): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (file) {
      onAddFile(file);
    }
    // Reset so re-picking the same file fires `change` again.
    input.value = "";
  };

  return (
    <>
      <InputGroupButton
        size="icon-sm"
        className="rounded-full"
        aria-label="Add attachment"
        onClick={() => fileInputRef.current?.click()}
      >
        <Plus />
      </InputGroupButton>
      <input
        ref={fileInputRef}
        type="file"
        aria-label="Attach a file"
        className="sr-only"
        onChange={handleFileChange}
      />
    </>
  );
}
