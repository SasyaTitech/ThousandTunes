/// <reference types="vite/client" />
import type { Book } from "@/lib/journal";

// Every JSON file in this folder is a textbook. To add one, drop a file here
// that follows the same shape as the existing ones; it appears in the
// textbook menu on the next build. Only outlines belong here (titles, pages,
// minutes and tempo targets), never the book's own text or scores.
const files = import.meta.glob<Book>("./*.json", { eager: true, import: "default" });

export const BOOKS: Book[] = Object.keys(files).sort().map(k => files[k]);
