import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { Badge } from "@/components/ui/badge";

type El = ReactElement<{ children?: ReactNode }>;

const elements = (node: ReactNode): El[] =>
  Children.toArray(node).filter((child): child is El => isValidElement(child));

/** Plain text of a rendered cell, for comparing rows. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** Columns that differ between two copies of the same thread, so they don't count. */
const VOLATILE_COLUMN = /\b(time|date|when|received|sent|at)\b/i;

/**
 * A table in an agent's reply (`.tblbox` in 06-chat-messages).
 *
 * Mailboxes repeat themselves: the same notification arrives twice, a thread shows up once
 * per message. Rows that match in every column except time/date are merged into the first
 * one, which gets a "×N" badge — so a summary of five emails reads as four, not as a list
 * with a duplicate in it.
 */
export function ChatTable({ children }: { children?: ReactNode }) {
  const parts = elements(children);
  const head = parts.find((part) => part.type === "thead");
  const body = parts.find((part) => part.type === "tbody");

  let rendered: ReactNode = children;
  if (head && body) {
    const headerRow = elements(head.props.children)[0];
    const headers = headerRow ? elements(headerRow.props.children).map((cell) => textOf(cell)) : [];
    const ignore = new Set(headers.flatMap((title, index) => (VOLATILE_COLUMN.test(title) ? [index] : [])));

    const rows = elements(body.props.children);
    const groups = new Map<string, { row: El; count: number }>();
    for (const row of rows) {
      const cells = elements(row.props.children);
      const key = cells
        .map((cell, index) => (ignore.has(index) ? "" : textOf(cell).trim().toLowerCase()))
        .join("\u0000");
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { row, count: 1 });
    }

    if (groups.size < rows.length) {
      const merged = [...groups.values()].map(({ row, count }, index) => {
        if (count === 1) return cloneElement(row, { key: index });
        const [first, ...rest] = elements(row.props.children);
        const badged = cloneElement(first, {
          children: (
            <>
              {first.props.children}{" "}
              <Badge variant="neutral" aria-label={`${count} times`}>
                ×{count}
              </Badge>
            </>
          ),
        });
        return cloneElement(row, { key: index }, badged, ...rest);
      });
      rendered = (
        <>
          {head}
          {cloneElement(body, {}, ...merged)}
        </>
      );
    }
  }

  return (
    <div className="my-3 overflow-hidden overflow-x-auto rounded-md border bg-card first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-body-s [&_td:first-child]:font-medium [&_td:first-child]:text-foreground">
        {rendered}
      </table>
    </div>
  );
}

export function ChatTableHeaderCell({ children }: { children?: ReactNode }) {
  return (
    <th className="bg-muted px-3 py-2.5 text-left text-caption font-medium text-muted-foreground">
      {children}
    </th>
  );
}

export function ChatTableCell({ children }: { children?: ReactNode }) {
  return <td className="border-t px-3 py-2.5 align-top text-muted-foreground">{children}</td>;
}
