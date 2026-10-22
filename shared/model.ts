// The shape of a board's content, shared by the app and the Worker. A board's Durable Object
// keeps every piece as a record `(kind, key, rev, data)`; `data` null means deleted.

export const HUES = ['rose', 'yellow', 'lime', 'cyan', 'indigo'] as const;
/** One of the five named colours, or a custom `#rrggbb`. Status values may also be `slate`. */
export type Hue = (typeof HUES)[number] | 'slate' | `#${string}`;

export type Role = 'admin' | 'member';

export type Kind = 'board' | 'member' | 'column' | 'field' | 'card' | 'comment' | 'file' | 'session' | 'log';
export const KINDS: Kind[] = ['board', 'member', 'column', 'field', 'card', 'comment', 'file', 'session', 'log'];

/** Kinds people's devices may write. The rest are written by the server only. */
export const CLIENT_KINDS: Kind[] = ['board', 'column', 'field', 'card', 'comment'];
/** Kinds only admins may write. */
export const ADMIN_KINDS: Kind[] = ['board', 'field'];

/** The board itself, key 'main'. */
export interface BoardRec {
  name: string;
  hue: Hue;
  /** Largest attachment, in MB (30 by default, at most 100). */
  maxUploadMB: number;
  /** Behind the columns (admins): a colour, an image (a file of the board, see BOARD_FILE), or none. */
  background?: { hue: Hue } | { image: string } | null;
}

/** The `cardId` of files that belong to the board itself (its background image), not a card. */
export const BOARD_FILE = '_board';

/** A person in the board, key = their user id. A mirror of the directory, kept by the server. */
export interface MemberRec {
  userId: string;
  name: string;
  email: string;
  hue: Hue;
  role: Role;
  /** Their profile photo's id (served at `/photos/<userId>/<photo>`), or none. */
  photo?: string | null;
}

export interface ColumnRec {
  id: string;
  name: string;
  order: number;
}

export type FieldType = 'text' | 'longtext' | 'number' | 'date' | 'datetime' | 'dropdown' | 'checkbox' | 'person';
export const FIELD_TYPES: FieldType[] = ['text', 'longtext', 'number', 'date', 'datetime', 'dropdown', 'checkbox', 'person'];

/** The two status values automation relies on. They can be renamed, never removed. */
export type StatusRole = 'in_progress' | 'completed';

export interface FieldOption {
  id: string;
  label: string;
  hue: Hue;
  role?: StatusRole;
}

/** The built-in fields every board has. Their record keys are these names. */
export type Builtin = 'start' | 'end' | 'status';

export interface FieldRec {
  id: string;
  builtin?: Builtin;
  name: string;
  type: FieldType;
  options?: FieldOption[];
  order: number;
}

export interface CardRec {
  id: string;
  columnId: string;
  order: number;
  title: string;
  desc: string;
  /** Field id → value: a string, number, boolean or null. Start, End and Status live here too. */
  values: Record<string, string | number | boolean | null>;
  assignees: string[];
  /** Each assignee whose part is done, and when (ms). */
  done: Record<string, number>;
  archived: boolean;
  createdBy: string;
  created: number;
}

export interface CommentRec {
  id: string;
  cardId: string;
  userId: string;
  text: string;
  at: number;
  editedAt?: number;
  deleted?: boolean;
}

export interface FileRec {
  id: string;
  cardId: string;
  name: string;
  mime: string;
  size: number;
  by: string;
  at: number;
  /** A thumbnail was stored next to it (images). */
  thumb: boolean;
}

/** Time worked on a card, from Elastic. `end` null: still running. */
export interface SessionRec {
  id: string;
  cardId: string;
  userId: string;
  start: number;
  end: number | null;
}

export type LogAction =
  | 'created'
  | 'archived'
  | 'restored'
  | 'moved'
  | 'renamed'
  | 'described'
  | 'changed'
  | 'status'
  | 'assigned'
  | 'unassigned'
  | 'part_done'
  | 'part_undone'
  | 'commented'
  | 'file_added'
  | 'file_removed'
  | 'worked'
  | 'deleted'
  | 'board_created'
  | 'board_renamed'
  | 'column_added'
  | 'column_renamed'
  | 'column_removed'
  | 'field_added'
  | 'field_changed'
  | 'field_removed'
  | 'member_added'
  | 'member_removed'
  | 'role_changed'
  | 'background_changed';

/** One entry in a card's log, or the board's (cardId null). Written by the server only. */
export interface LogRec {
  id: string;
  cardId: string | null;
  /** Who did it (null: done automatically). */
  userId: string | null;
  at: number;
  action: LogAction;
  detail: Record<string, string | number | boolean | null>;
}

export interface KindData {
  board: BoardRec;
  member: MemberRec;
  column: ColumnRec;
  field: FieldRec;
  card: CardRec;
  comment: CommentRec;
  file: FileRec;
  session: SessionRec;
  log: LogRec;
}

export const STATUS_FIELD: FieldRec = {
  id: 'status',
  builtin: 'status',
  name: 'Status',
  type: 'dropdown',
  order: 3,
  options: [
    { id: 'not', label: 'Not started', hue: 'slate' },
    { id: 'prog', label: 'In progress', hue: 'indigo', role: 'in_progress' },
    { id: 'done', label: 'Completed', hue: 'lime', role: 'completed' },
    { id: 'block', label: 'Blocked', hue: 'rose' },
  ],
};

/** The fields every new board starts with. */
export const DEFAULT_FIELDS: FieldRec[] = [
  { id: 'start', builtin: 'start', name: 'Start date', type: 'date', order: 1 },
  { id: 'end', builtin: 'end', name: 'End date', type: 'date', order: 2 },
  STATUS_FIELD,
];

export const MAX_UPLOAD_MB = 100;
export const DEFAULT_UPLOAD_MB = 30;

/** A random id: 16 characters from a URL-safe alphabet. */
export function newId(len = 16): string {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}

/** An order number between two neighbours (either may be missing), for fractional ordering. */
export function between(before: number | null | undefined, after: number | null | undefined): number {
  if (before == null && after == null) return 1;
  if (before == null) return after! - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}
