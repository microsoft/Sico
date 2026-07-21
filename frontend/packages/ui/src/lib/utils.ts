// eslint-disable-next-line no-restricted-imports -- cn is the approved wrapper around clsx
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(...inputs));
}
