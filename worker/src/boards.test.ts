// Members and roles (boards.ts): the directory on node:sqlite, and a board that can fail to answer.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeD1 } from '../../test/fake-d1';
import { acceptInvite, createInvite, listBoards, orderBoards, removeMember, resendInvite, setRole } from './boards';
import { devOutbox } from './mail';

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

describe('invites', () => {
  beforeEach(() => {
    env.DEV_MAIL = '1';
    env.APP_URL = 'https://boardo.kaiserkhan.com/';
    devOutbox.length = 0;
    db.exec(`UPDATE users SET name = '<b>Free money</b> at evil.example' WHERE id = 'ann'`);
    db.exec(`UPDATE boards SET name = 'Click http://evil.example' WHERE id = 'b1'`);
  });
  const token = () => devOutbox.at(-1)!.text.match(/invite=([\w-]+)/)![1];

  it('puts nothing the sender typed in the subject, and escapes it in the body', async () => {
    await createInvite(env, 'ann', { board: 'b1', email: 'dee@x.com' });
    const mail = devOutbox.at(-1)!;
    expect(mail.subject).toBe("You're invited to a board on Boardo");
    expect(mail.html).toContain('&#60;b&#62;Free money&#60;/b&#62;');
    expect(mail.html).not.toContain('<b>Free money');
  });

  it('only lets in the address it was sent to', async () => {
    db.exec(`INSERT INTO users (id, email, name, created) VALUES ('dee', 'dee@x.com', 'Dee', 1), ('eve', 'eve@x.com', 'Eve', 1)`);
    await createInvite(env, 'ann', { board: 'b1', email: 'dee@x.com' });
    const t = token();
    await expect(acceptInvite(env, 'eve', { token: t })).rejects.toThrow(/That invite is for dee@x.com/);
    expect(role('eve')).toBeNull();
    await acceptInvite(env, 'dee', { token: t });
    expect(role('dee')).toBe('member');
  });

  it('sends one invite again at most every five minutes', async () => {
    await createInvite(env, 'ann', { board: 'b1', email: 'dee@x.com' });
    const { id } = db.prepare('SELECT id FROM invites').get() as { id: string };
    await expect(resendInvite(env, 'ann', { id })).rejects.toThrow(/just sent/);
    await expect(createInvite(env, 'ann', { board: 'b1', email: 'dee@x.com' })).rejects.toThrow(/just sent/);
    db.prepare('UPDATE invites SET created = created - 300001').run();
    await resendInvite(env, 'ann', { id });
    expect(devOutbox).toHaveLength(2);
  });

  it('sends at most 20 a day from one person', async () => {
    const r = [];
    for (let i = 0; i < 21; i++) r.push(await createInvite(env, 'ann', { board: 'b1', email: `p${i}@x.com` }).then(() => 'ok', (e) => e.message));
    expect(r.filter((x) => x === 'ok')).toHaveLength(20);
    expect(r[20]).toMatch(/as many invites/);
  });

  it('sends at most 30 a day for one board, whoever sends them', async () => {
    let ok = 0;
    for (let i = 0; i < 20; i++) await createInvite(env, 'ann', { board: 'b1', email: `a${i}@x.com` }).then(() => ok++, () => {});
    for (let i = 0; i < 20; i++) await createInvite(env, 'bob', { board: 'b1', email: `b${i}@x.com` }).then(() => ok++, () => {});
    expect(ok).toBe(30);
  });
});
