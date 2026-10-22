// The app's state: who's signed in, their boards (each a BoardState kept in sync with its
// board), what's on screen, and every action people take. Changes are applied here at once,
// saved to IndexedDB with a note to send them, and sent by sync.ts when there's a connection.

import {
  between,
  type BoardRec,
  type CardRec,
  type ColumnRec,
  type CommentRec,
  type FieldRec,
  type Hue,
  type Kind,
  newId,
  type Role,
} from '../../shared/model';
import { settle } from '../../shared/rules';
import { API, ApiError, call, setToken, whenSignedOut } from './api';
import { BoardState } from './board.svelte';
import * as db from './db';
import { splitRid } from './db';
import { Files } from './files.svelte';
import { addPasskey, passkeySignIn, passkeysAvailable } from './passkeys';
import { Sync } from './sync';

export interface User {
  id: string;
  email: string;
  name: string | null;
  hue: Hue;
}

export interface BoardItem {
  id: string;
  name: string;
  hue: Hue;
  role: Role;
}

export interface Invite {
  id: string;
  role: Role;
  expires: number;
  board: { name: string; hue: Hue };
  by: string | null;
}

export type Screen =
  | { name: 'home' }
  | { name: 'board'; id: string }
  | { name: 'boardSettings'; id: string }
  | { name: 'mycards' }
  | { name: 'settings' };

export type Theme = 'auto' | 'light' | 'dark';

const THEME_KEY = 'boardo:theme';
const SCREEN_KEY = 'boardo:screen';
const PASSKEY_ASK_KEY = 'boardo:passkey-ask';

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, v: string | null): void {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* private mode */
  }
}

export class App {
  ready = $state(false);
  user = $state<User | null>(null);
  token: string | null = null;
  boards = $state.raw<BoardItem[]>([]);
  invites = $state.raw<Invite[]>([]);
  data = $state.raw<Record<string, BoardState>>({});
  screen = $state<Screen>({ name: 'home' });
  /** The board whose Activity panel is open. */
  activity = $state<string | null>(null);
  /** The card open in the card sheet. */
  open = $state<{ board: string; id: string } | null>(null);
  /** Overlays: New board, invites to show after a link was opened. */
  sheet = $state<'newBoard' | null>(null);
  toast = $state<{ text: string; id: number } | null>(null);
  theme = $state<Theme>('auto');
  online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
  /** An invite link was opened (`?invite=`): accepted once signed in. */
  inviteToken: string | null = null;
  /** Just signed in with a code on a device that can hold a passkey, and none is set up yet. */
  offerPasskey = $state(false);
  /** My cards: group by deadline or by project. */
  myCardsBy = $state<'deadline' | 'project'>('deadline');

  files = new Files((t) => this.say(t));
  private sync: Sync;
  private pending = new Map<string, number>();
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.sync = new Sync(API, {
      changed: (board, ids) => void this.reload(board, ids),
      status: (board, s) => {
        const b = this.data[board];
        if (b) b.status = s;
      },
      signedOut: () => void this.signedOut(),
      removed: (board) => this.boardGone(board),
    });
    whenSignedOut(() => void this.signedOut());
    const t = readLocal(THEME_KEY);
    this.theme = t === 'light' || t === 'dark' ? t : 'auto';
  }

  // ---------- starting up ----------

  async init(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const invite = params.get('invite');
    // A card's own link (`?card=<board>/<card>`), as Elastic opens it.
    const cardLink = params.get('card')?.split('/');
    if (invite) this.inviteToken = invite;
    if (invite || cardLink) history.replaceState(null, '', location.pathname);
    const session = await db.getMeta<{ token: string; user: User }>('session');
    if (session) {
      this.token = session.token;
      this.user = session.user;
      setToken(session.token);
      this.boards = (await db.getMeta<BoardItem[]>('boards')) ?? [];
      await this.loadLocal();
      this.restoreScreen();
      if (cardLink?.length === 2 && this.boards.some((b) => b.id === cardLink[0])) {
        this.go({ name: 'board', id: cardLink[0] });
        this.open = { board: cardLink[0], id: cardLink[1] };
      }
      this.sync.start(session.token, this.boards.map((b) => b.id));
      void this.refresh();
      await this.files.load();
      void this.files.pump();
    }
    if (typeof addEventListener === 'function') {
      addEventListener('online', () => {
        this.online = true;
        void this.refresh();
        void this.files.pump();
      });
      addEventListener('offline', () => (this.online = false));
      document.addEventListener('visibilitychange', () => {
        const v = !document.hidden;
        this.sync.setVisible(v);
        if (v) {
          void this.refresh();
          void this.files.pump();
        }
      });
    }
    this.ready = true;
    void db.requestPersistence();
  }

  private async loadLocal(): Promise<void> {
    const all = await db.getRecords();
    const data: Record<string, BoardState> = {};
    for (const b of this.boards) data[b.id] = new BoardState(b.id);
    const by = new Map<string, { kind: Kind; key: string; data: unknown }[]>();
    for (const r of all) {
      if (!data[r.board]) continue;
      let list = by.get(r.board);
      if (!list) by.set(r.board, (list = []));
      list.push(r);
    }
    for (const [id, recs] of by) data[id].apply(recs);
    this.data = data;
  }

  private restoreScreen(): void {
    try {
      const s = JSON.parse(readLocal(SCREEN_KEY) ?? 'null') as Screen | null;
      if (!s) return;
      if ('id' in s && !this.boards.some((b) => b.id === s.id)) return;
      // Activity used to be a screen of its own.
      if ((s.name as string) === 'activity' && 'id' in s) return void (this.screen = { name: 'board', id: s.id });
      this.screen = s;
    } catch {
      /* ignore */
    }
  }

  /** The board list and invites, from the server. Boards gone from it are dropped here. */
  async refresh(): Promise<void> {
    if (!this.token) return;
    let res: { user: User; boards: BoardItem[]; invites: Invite[] };
    try {
      res = await call('/boards');
    } catch {
      return;
    }
    this.user = res.user;
    await db.putMeta('session', { token: this.token, user: res.user });
    await this.setBoards(res.boards);
    this.invites = res.invites;
    if (this.inviteToken) {
      const t = this.inviteToken;
      this.inviteToken = null;
      await this.acceptInvite({ token: t });
    }
  }

  private async setBoards(list: BoardItem[]): Promise<void> {
    const ids = new Set(list.map((b) => b.id));
    for (const b of this.boards) if (!ids.has(b.id)) await db.dropBoard(b.id);
    const data: Record<string, BoardState> = {};
    for (const b of list) data[b.id] = this.data[b.id] ?? new BoardState(b.id);
    this.boards = list;
    this.data = data;
    await db.putMeta('boards', list);
    this.sync.setBoards(list.map((b) => b.id));
    const s = this.screen;
    if ('id' in s && !ids.has(s.id)) this.go({ name: 'home' });
    if (this.open && !ids.has(this.open.board)) this.open = null;
    if (this.activity && !ids.has(this.activity)) this.activity = null;
  }

  private boardGone(id: string): void {
    const b = this.boards.find((x) => x.id === id);
    if (!b) return;
    void this.setBoards(this.boards.filter((x) => x.id !== id));
    this.say(`You're no longer in ${b.name}.`);
  }

  /** Records that changed from the board: reload them, unless a change made here is still saving. */
  private async reload(board: string, ids: string[]): Promise<void> {
    const b = this.data[board];
    if (!b) return;
    const recs: { kind: Kind; key: string; data: unknown }[] = [];
    for (const id of ids) {
      if (this.pending.get(id)) continue;
      const [, kind, key] = splitRid(id);
      recs.push({ kind, key, data: await db.getRecord(id) });
    }
    b.apply(recs);
    // The board's own name and colour show in the board list too.
    if (recs.some((r) => r.kind === 'board') && b.board)
      this.boards = this.boards.map((x) => (x.id === board ? { ...x, name: b.board!.name, hue: b.board!.hue } : x));
  }

  // ---------- signing in ----------

  async sendCode(email: string): Promise<void> {
    await call('/auth/code/send', { email });
  }

  async verifyCode(email: string, code: string): Promise<void> {
    const res = await call<{ token: string; user: User; fresh: boolean }>('/auth/code/verify', { email, code });
    await this.signedIn(res);
    void this.maybeOfferPasskey();
  }

  /** Sign in with a passkey (`autofill`: picked from the email field's suggestions). */
  async signInWithPasskey(autofill = false): Promise<void> {
    await this.signedIn(await passkeySignIn<{ token: string; user: User; fresh: boolean }>(autofill));
  }

  private async maybeOfferPasskey(): Promise<void> {
    if (!passkeysAvailable() || readLocal(PASSKEY_ASK_KEY) === 'no') return;
    try {
      const { passkeys } = await call<{ passkeys: unknown[] }>('/me/passkeys');
      this.offerPasskey = !passkeys.length;
    } catch {
      /* offline: ask another time */
    }
  }

  async addPasskey(): Promise<void> {
    await addPasskey();
    this.offerPasskey = false;
  }

  /** Not now: the offer comes back after the next sign-in with a code; Don't ask stops it. */
  dismissPasskey(forGood: boolean): void {
    this.offerPasskey = false;
    if (forGood) writeLocal(PASSKEY_ASK_KEY, 'no');
  }

  private async signedIn(res: { token: string; user: User }): Promise<void> {
    this.token = res.token;
    this.user = res.user;
    setToken(res.token);
    await db.putMeta('session', { token: res.token, user: res.user });
    this.boards = [];
    this.data = {};
    this.screen = { name: 'home' };
    this.sync.start(res.token, []);
    await this.refresh();
  }

  async saveProfile(patch: { name?: string; hue?: Hue }): Promise<void> {
    const res = await call<{ user: User }>('/me', patch);
    this.user = res.user;
    await db.putMeta('session', { token: this.token, user: res.user });
  }

  async signOut(): Promise<void> {
    try {
      await call('/auth/signout');
    } catch {
      /* gone anyway */
    }
    await this.signedOut();
  }

  async deleteAccount(): Promise<void> {
    await call('/me/delete');
    await this.signedOut();
  }

  /** Signed out (here or elsewhere): nothing about any board stays on this device. */
  private async signedOut(): Promise<void> {
    if (!this.token) return;
    this.sync.stop();
    this.token = null;
    setToken(null);
    await db.clearAll();
    this.files.clear();
    this.user = null;
    this.boards = [];
    this.invites = [];
    this.data = {};
    this.open = null;
    this.activity = null;
    this.sheet = null;
    this.screen = { name: 'home' };
    writeLocal(SCREEN_KEY, null);
  }

  // ---------- screens ----------

  go(s: Screen): void {
    this.screen = s;
    this.open = null;
    this.activity = null;
    writeLocal(SCREEN_KEY, JSON.stringify(s));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  openCard(board: string, id: string): void {
    this.open = { board, id };
  }

  say(text: string): void {
    this.toast = { text, id: Date.now() };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), 4000);
  }

  setTheme(t: Theme): void {
    this.theme = t;
    writeLocal(THEME_KEY, t === 'auto' ? null : t);
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }

  /** My role in a board: as the board itself last said, else as the board list says. */
  roleIn(board: string): Role | undefined {
    const me = this.user?.id;
    return (me && this.data[board]?.member.get(me)?.role) || this.boards.find((b) => b.id === board)?.role;
  }

  isAdmin(board: string): boolean {
    return this.roleIn(board) === 'admin';
  }

  // ---------- boards ----------

  async createBoard(name: string, hue: Hue): Promise<void> {
    const res = await call<{ board: BoardItem }>('/boards/create', { name, hue });
    await this.setBoards([...this.boards, res.board]);
    this.sheet = null;
    this.go({ name: 'board', id: res.board.id });
  }

  async deleteBoard(id: string): Promise<void> {
    await call('/boards/delete', { board: id });
    await this.setBoards(this.boards.filter((b) => b.id !== id));
  }

  async leaveBoard(id: string): Promise<void> {
    await call('/members/remove', { board: id });
    await this.setBoards(this.boards.filter((b) => b.id !== id));
  }

  async acceptInvite(by: { id?: string; token?: string }): Promise<void> {
    try {
      const res = await call<{ board: BoardItem | null }>('/invites/accept', by);
      await this.refresh();
      if (res.board) {
        this.go({ name: 'board', id: res.board.id });
        this.say(`You joined ${res.board.name}.`);
      }
    } catch (e) {
      this.say((e as Error).message);
      await this.refresh();
    }
  }

  async declineInvite(id: string): Promise<void> {
    await call('/invites/decline', { id });
    this.invites = this.invites.filter((i) => i.id !== id);
  }

  // ---------- changing records ----------

  /** Save changes to a board's records: shown at once, stored, then sent. */
  async put(board: string, changes: { kind: Kind; key: string; data: unknown }[]): Promise<void> {
    const b = this.data[board];
    if (!b || !changes.length) return;
    b.apply(changes);
    const ids = changes.map((c) => db.rid(board, c.kind, c.key));
    for (const id of ids) this.pending.set(id, (this.pending.get(id) ?? 0) + 1);
    try {
      await db.putLocal(changes.map((c) => ({ board, ...c })));
    } finally {
      for (const id of ids) {
        const n = (this.pending.get(id) ?? 1) - 1;
        if (n > 0) this.pending.set(id, n);
        else this.pending.delete(id);
      }
    }
    this.sync.kick(board);
  }

  private card(board: string, id: string): CardRec | undefined {
    return this.data[board]?.card.get(id);
  }

  async addCard(board: string, columnId: string, title: string, at: 'top' | 'bottom' = 'bottom'): Promise<string> {
    const b = this.data[board];
    const list = b.cardsIn(columnId);
    const order = at === 'top' ? between(null, list[0]?.order) : between(list.at(-1)?.order, null);
    const card: CardRec = {
      id: newId(),
      columnId,
      order,
      title: title.trim(),
      desc: '',
      // A new card has no status until someone picks one.
      values: {},
      assignees: [],
      done: {},
      archived: false,
      createdBy: this.user!.id,
      created: Date.now(),
    };
    await this.put(board, [{ kind: 'card', key: card.id, data: card }]);
    return card.id;
  }

  /** Change a card. Parts and status follow the completion rule here too, as the board will. */
  async updateCard(board: string, id: string, patch: Partial<CardRec>): Promise<void> {
    const prev = this.card(board, id);
    if (!prev) return;
    const next = settle(prev, { ...prev, ...patch }, this.data[board].statusField).card;
    if (JSON.stringify(next) === JSON.stringify(prev)) return;
    await this.put(board, [{ kind: 'card', key: id, data: next }]);
  }

  async setValue(board: string, id: string, field: string, value: string | number | boolean | null): Promise<void> {
    const prev = this.card(board, id);
    if (!prev) return;
    const values = { ...prev.values };
    if (value === null || value === '') delete values[field];
    else values[field] = value;
    await this.updateCard(board, id, { values });
  }

  async toggleAssignee(board: string, id: string, userId: string): Promise<void> {
    const prev = this.card(board, id);
    if (!prev) return;
    const on = prev.assignees.includes(userId);
    await this.updateCard(board, id, {
      assignees: on ? prev.assignees.filter((u) => u !== userId) : [...prev.assignees, userId],
    });
  }

  async markPart(board: string, id: string, done: boolean): Promise<void> {
    const prev = this.card(board, id);
    if (!prev || !this.user) return;
    const parts = { ...prev.done };
    if (done) parts[this.user.id] = Date.now();
    else delete parts[this.user.id];
    await this.updateCard(board, id, { done: parts });
  }

  /** Move a card into a column, between two neighbours (ids, or null at either end). */
  async moveCard(board: string, id: string, columnId: string, beforeId: string | null, afterId: string | null) {
    const b = this.data[board];
    const order = between(
      beforeId ? b.card.get(beforeId)?.order : null,
      afterId ? b.card.get(afterId)?.order : null,
    );
    await this.updateCard(board, id, { columnId, order });
  }

  async archiveCard(board: string, id: string, archived: boolean): Promise<void> {
    const prev = this.card(board, id);
    if (!prev) return;
    const patch: Partial<CardRec> = { archived };
    // Restored into a column that's gone: the first one.
    if (!archived && !this.data[board].column.has(prev.columnId)) {
      const first = this.data[board].columns[0];
      if (first) patch.columnId = first.id;
    }
    await this.updateCard(board, id, patch);
    if (archived && this.open?.id === id) this.open = null;
  }

  /** Delete an archived card for good. Done by the board itself, so it needs a connection. */
  async deleteCard(board: string, id: string): Promise<void> {
    await call('/cards/delete', { board, card: id });
    if (this.open?.board === board && this.open.id === id) this.open = null;
  }

  /** Whether I may delete this card: an admin, or whoever made it. */
  canDelete(board: string, id: string): boolean {
    const c = this.data[board]?.card.get(id);
    return !!c && (this.isAdmin(board) || c.createdBy === this.user?.id);
  }

  // ---------- columns ----------

  async addColumn(board: string, name: string): Promise<void> {
    const cols = this.data[board].columns;
    const col: ColumnRec = { id: newId(), name: name.trim(), order: between(cols.at(-1)?.order, null) };
    await this.put(board, [{ kind: 'column', key: col.id, data: col }]);
  }

  async renameColumn(board: string, id: string, name: string): Promise<void> {
    const col = this.data[board].column.get(id);
    if (!col || !name.trim() || col.name === name.trim()) return;
    await this.put(board, [{ kind: 'column', key: id, data: { ...col, name: name.trim() } }]);
  }

  async moveColumn(board: string, id: string, dir: -1 | 1): Promise<void> {
    const cols = this.data[board].columns;
    const i = cols.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cols.length) return;
    const [a, b] = dir < 0 ? [cols[j - 1], cols[j]] : [cols[j], cols[j + 1]];
    const order = between(a?.order, b?.order);
    await this.put(board, [{ kind: 'column', key: id, data: { ...cols[i], order } }]);
  }

  /** Remove a column: its cards move to another column, or are archived. */
  async removeColumn(board: string, id: string, moveTo: string | null): Promise<void> {
    const b = this.data[board];
    const changes: { kind: Kind; key: string; data: unknown }[] = [];
    const target = moveTo ? b.cardsIn(moveTo) : [];
    let last = target.at(-1)?.order ?? 0;
    for (const c of b.cardsIn(id)) {
      if (moveTo) changes.push({ kind: 'card', key: c.id, data: { ...c, columnId: moveTo, order: (last = last + 1) } });
      else changes.push({ kind: 'card', key: c.id, data: { ...c, archived: true } });
    }
    changes.push({ kind: 'column', key: id, data: null });
    await this.put(board, changes);
  }

  // ---------- board settings (admins) ----------

  async saveBoard(board: string, patch: Partial<BoardRec>): Promise<void> {
    const cur = this.data[board]?.board;
    if (!cur) return;
    await this.put(board, [{ kind: 'board', key: 'main', data: { ...cur, ...patch } }]);
    this.boards = this.boards.map((x) => (x.id === board ? { ...x, name: patch.name ?? x.name, hue: patch.hue ?? x.hue } : x));
  }

  async saveField(board: string, field: FieldRec): Promise<void> {
    await this.put(board, [{ kind: 'field', key: field.id, data: field }]);
  }

  async addField(board: string, f: Omit<FieldRec, 'id' | 'order'>): Promise<string> {
    const fields = this.data[board].fields;
    const field: FieldRec = { ...f, id: newId(), order: between(fields.at(-1)?.order, null) };
    await this.saveField(board, field);
    return field.id;
  }

  /** Remove a custom field, and its value on every card. */
  async removeField(board: string, id: string): Promise<void> {
    const b = this.data[board];
    const f = b.field.get(id);
    if (!f || f.builtin) return;
    const changes: { kind: Kind; key: string; data: unknown }[] = [{ kind: 'field', key: id, data: null }];
    for (const c of b.card.values())
      if (id in c.values) {
        const values = { ...c.values };
        delete values[id];
        changes.push({ kind: 'card', key: c.id, data: { ...c, values } });
      }
    await this.put(board, changes);
  }

  async moveField(board: string, id: string, dir: -1 | 1): Promise<void> {
    const list = this.data[board].fields;
    const i = list.findIndex((f) => f.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const [a, b] = dir < 0 ? [list[j - 1], list[j]] : [list[j], list[j + 1]];
    await this.saveField(board, { ...list[i], order: between(a?.order, b?.order) });
  }

  async setRole(board: string, userId: string, role: Role): Promise<void> {
    await call('/members/role', { board, user: userId, role });
  }

  async removeMember(board: string, userId: string): Promise<void> {
    await call('/members/remove', { board, user: userId });
  }

  // ---------- comments ----------

  async addComment(board: string, cardId: string, text: string): Promise<void> {
    const c: CommentRec = { id: newId(), cardId, userId: this.user!.id, text: text.trim(), at: Date.now() };
    await this.put(board, [{ kind: 'comment', key: c.id, data: c }]);
  }

  async editComment(board: string, id: string, text: string): Promise<void> {
    const c = this.data[board]?.comment.get(id);
    if (!c || c.userId !== this.user?.id) return;
    await this.put(board, [{ kind: 'comment', key: id, data: { ...c, text: text.trim(), editedAt: Date.now() } }]);
  }

  async deleteComment(board: string, id: string): Promise<void> {
    const c = this.data[board]?.comment.get(id);
    if (!c || c.userId !== this.user?.id) return;
    await this.put(board, [{ kind: 'comment', key: id, data: { ...c, text: '', deleted: true } }]);
  }

  // ---------- My cards ----------

  /** Every card assigned to me, across my boards, archived ones left out. */
  myCards = $derived.by(() => {
    const me = this.user?.id;
    if (!me) return [];
    const out: { board: BoardItem; card: CardRec; state: BoardState }[] = [];
    for (const item of this.boards) {
      const state = this.data[item.id];
      if (!state) continue;
      for (const card of state.card.values())
        if (!card.archived && card.assignees.includes(me)) out.push({ board: item, card, state });
    }
    return out;
  });
}

export const app = new App();
export { ApiError };
