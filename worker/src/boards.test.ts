// Members and roles (boards.ts): the directory on node:sqlite, and a board that can fail to answer.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeD1 } from '../../test/fake-d1';
import { listBoards, orderBoards, removeMember, setRole } from './boards';

let db: ReturnType<typeof fakeD1>['db'];
let env: any;
/** What reached the board, and how many calls to it fail first. */
let told: string[];
let failing: number;

const board = {
  async removeMember(user: string) {
    if (failing-- > 0) throw new Error('Board unreachable');
    told.push(`remove ${user}`);
  },
  async setMember(m: { userId: string; role: string }) {
    if (failing-- > 0) throw new Error('Board unreachable');
    told.push(`${m.userId} ${m.role}`);
  },
};

const role = (user: string) =>
  (db.prepare('SELECT role FROM members WHERE board_id = ? AND user_id = ?').get('b1', user) as { role: string } | undefined)?.role ?? null;
const admins = () => (db.prepare("SELECT COUNT(*) AS n FROM members WHERE board_id = 'b1' AND role = 'admin'").get() as { n: number }).n;

beforeEach(() => {
  const f = fakeD1();
  db = f.db;
  told = [];
  failing = 0;
  env = { DB: f.d1, BOARDS: { idFromName: (n: string) => n, get: () => board } };
  db.exec(`INSERT INTO users (id, email, name, created) VALUES ('ann', 'ann@x.com', 'Ann', 1), ('bob', 'bob@x.com', 'Bob', 1), ('cy', 'cy@x.com', 'Cy', 1)`);
  db.exec(`INSERT INTO boards (id, name, hue, created_by, created) VALUES ('b1', 'Launch', 'cyan', 'ann', 1)`);
  db.exec(
    `INSERT INTO members (board_id, user_id, role, added_at) VALUES ('b1', 'ann', 'admin', 1), ('b1', 'bob', 'admin', 1), ('b1', 'cy', 'member', 1)`,
  );
});

describe('the last admin', () => {
  it('stays when two admins take each other off at once', async () => {
    const r = await Promise.allSettled([
      setRole(env, 'ann', { board: 'b1', user: 'bob', role: 'member' }),
      setRole(env, 'bob', { board: 'b1', user: 'ann', role: 'member' }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(admins()).toBe(1);
  });

  it('stays when two admins remove each other at once', async () => {
    const r = await Promise.allSettled([
      removeMember(env, 'ann', { board: 'b1', user: 'bob' }),
      removeMember(env, 'bob', { board: 'b1', user: 'ann' }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(admins()).toBe(1);
  });

  it("can't leave", async () => {
    await removeMember(env, 'ann', { board: 'b1', user: 'bob' });
    await expect(removeMember(env, 'ann', { board: 'b1' })).rejects.toThrow(/only admin/);
    expect(role('ann')).toBe('admin');
  });
});

describe('a board that fails to answer', () => {
  it('is asked again, and a removal finishes when the admin tries again', async () => {
    failing = 3;
    await expect(removeMember(env, 'ann', { board: 'b1', user: 'cy' })).rejects.toThrow('Board unreachable');
    expect(role('cy')).toBeNull();
    expect(told).toEqual([]);
    await removeMember(env, 'ann', { board: 'b1', user: 'cy' });
    expect(told).toEqual(['remove cy']);
  });

  it('gets a role change through on a second try', async () => {
    failing = 1;
    await setRole(env, 'ann', { board: 'b1', user: 'cy', role: 'admin' });
    expect(told).toEqual(['cy admin']);
    failing = 3;
    await expect(setRole(env, 'ann', { board: 'b1', user: 'cy', role: 'member' })).rejects.toThrow();
    expect(role('cy')).toBe('member');
    await setRole(env, 'ann', { board: 'b1', user: 'cy', role: 'member' });
    expect(told).toEqual(['cy admin', 'cy member']);
  });
});

describe("each person's order of their boards", () => {
  beforeEach(() => {
    db.exec(`INSERT INTO boards (id, name, hue, created_by, created) VALUES ('b2', 'Hiring', 'lime', 'ann', 2), ('b3', 'Budget', 'rose', 'ann', 3)`);
    db.exec(`INSERT INTO members (board_id, user_id, role, added_at) VALUES ('b2', 'ann', 'admin', 2), ('b3', 'ann', 'admin', 3), ('b3', 'bob', 'admin', 3)`);
  });
  const order = async (user: string) => (await listBoards(env, user)).boards.map((b) => b.id);
  it('is oldest first until they arrange it', async () => {
    expect(await order('ann')).toEqual(['b1', 'b2', 'b3']);
  });
  it('is theirs alone once they do', async () => {
    await orderBoards(env, 'ann', { ids: ['b3', 'b1', 'b2'] });
    expect(await order('ann')).toEqual(['b3', 'b1', 'b2']);
    expect(await order('bob')).toEqual(['b1', 'b3']);
  });
  it('puts a new board after the ones they placed', async () => {
    await orderBoards(env, 'ann', { ids: ['b2', 'b1'] });
    db.exec(`INSERT INTO boards (id, name, hue, created_by, created) VALUES ('b4', 'New', 'cyan', 'ann', 4)`);
    db.exec(`INSERT INTO members (board_id, user_id, role, added_at) VALUES ('b4', 'ann', 'admin', 4)`);
    expect(await order('ann')).toEqual(['b2', 'b1', 'b3', 'b4']);
  });
  it("never touches a board they aren't in, and refuses a bad list", async () => {
    await orderBoards(env, 'cy', { ids: ['b3', 'b1'] });
    expect(await order('ann')).toEqual(['b1', 'b2', 'b3']);
    await expect(orderBoards(env, 'ann', { ids: 'b1' })).rejects.toThrow();
  });
});
