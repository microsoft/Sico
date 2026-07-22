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

import dwDefaultAvatarAsset from "./assets/dw-default-avatar.svg?url";
import projectDefaultAvatarAsset from "./assets/project-default-avatar.svg?url";

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
  type AvatarSize,
} from "./components/ui/avatar";

/**
 * URL of the Digital Worker default avatar SVG. Use as the
 * `<AvatarFallback>` content for DW surfaces; real users should get
 * text initials instead. Enforced via `local-rules/require-avatar-fallback`.
 *
 * @example
 * <Avatar>
 *   <AvatarFallback>
 *     <img src={DW_DEFAULT_AVATAR_URL} alt="" className="size-full" />
 *   </AvatarFallback>
 * </Avatar>
 */
export const DW_DEFAULT_AVATAR_URL: string = dwDefaultAvatarAsset;

/**
 * URL of the project default avatar SVG. Use as the fallback when a
 * project has no `iconUrl`.
 */
export const PROJECT_DEFAULT_AVATAR_URL: string = projectDefaultAvatarAsset;
export { Badge, badgeVariants } from "./components/ui/badge";
export type { BadgeColor } from "./components/ui/badge";
export {
  Button,
  buttonVariants,
  type ButtonProps,
} from "./components/ui/button";
export {
  Dialog,
  DialogClose,
  DialogContent,
  dialogContentVariants,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "./components/ui/dropdown-menu";
export {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  fieldVariants,
  type FieldErrorProps,
  type FieldLegendProps,
  type FieldProps,
} from "./components/ui/field";
export { Input } from "./components/ui/input";
export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupTextarea,
  InputGroupText,
  inputGroupAddonVariants,
  inputGroupButtonVariants,
  type InputGroupAddonProps,
  type InputGroupButtonProps,
} from "./components/ui/input-group";
export { Label } from "./components/ui/label";
export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./components/ui/popover";
export { Skeleton } from "./components/ui/skeleton";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
export { Spinner } from "./components/ui/spinner";
// `Toaster` mounts both surfaces (white + inverted); `toast` is a thin
// SICO wrapper that routes `invert: true` calls to the inverted surface.
// Consumers don't depend on `sonner` directly.
export { Toaster, toast } from "./components/ui/sonner";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
export {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  tabsListVariants,
} from "./components/ui/tabs";
export { Textarea } from "./components/ui/textarea";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
export { Checkbox } from "./components/ui/checkbox";
