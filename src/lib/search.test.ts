import { describe, expect, it } from 'vitest';
import type { CardRec, CommentRec, FieldRec, FileRec, LogRec, MemberRec } from '../../shared/model';
import { BOARD_FILE } from '../../shared/model';
import { fold, highlight, matchBoard, nameMatches, queryWords, snippet, type Piece, type Source } from './search';

let n = 0;
const card = (title: string, extra: Partial<CardRec> = {}): CardRec => ({
  id: `k${++n}`,
  columnId: 'c1',
  order: n,
  title,
  desc: '',
  values: {},
  assignees: [],
  done: {},
  archived: false,
  createdBy: 'ann',
  created: 1000 + n,
  ...extra,
});
const comment = (cardId: string, text: string, extra: Partial<CommentRec> = {}): CommentRec => ({ id: `m${++n}`, cardId, userId: 'sara', text, at: 2000 + n, ...extra });
const file = (cardId: string, name: string): FileRec => ({ id: `f${++n}`, cardId, name, mime: 'application/pdf', size: 1, by: 'ann', at: 1, thumb: false });
const members = new Map<string, MemberRec>([
  ['ann', { userId: 'ann', name: 'Ann Lee', email: 'a@x.com', hue: 'cyan', role: 'admin' }],
  ['sara', { userId: 'sara', name: 'Sara Ali', email: 's@x.com', hue: 'rose', role: 'member' }],
]);
const fields: FieldRec[] = [
  { id: 'status', builtin: 'status', name: 'Status', type: 'dropdown', order: 3, options: [{ id: 'prog', label: 'In progress', hue: 'indigo', role: 'in_progress' }] },
  { id: 'start', builtin: 'start', name: 'Start date', type: 'date', order: 1 },
  { id: 'sev', name: 'Severity', type: 'dropdown', order: 4, options: [{ id: 'o1', label: 'Critical', hue: 'rose' }] },
  { id: 'owner', name: 'Owner', type: 'person', order: 5 },
  { id: 'urgent', name: 'Urgent', type: 'checkbox', order: 6 },
  { id: 'budget', name: 'Budget', type: 'number', order: 7 },
  { id: 'due', name: 'Due', type: 'date', order: 8 },
];

function board(cards: CardRec[], extra: { comments?: CommentRec[]; files?: FileRec[]; logs?: LogRec[] } = {}): Source {
  return {
    id: 'b1',
    board: null,
    card: new Map(cards.map((c) => [c.id, c])),
    comment: new Map((extra.comments ?? []).map((c) => [c.id, c])),
    file: new Map((extra.files ?? []).map((f) => [f.id, f])),
    field: new Map(fields.map((f) => [f.id, f])),
    member: members,
    column: new Map(),
    log: new Map((extra.logs ?? []).map((l) => [l.id, l])),
  };
}
const titles = (src: Source, q: string) => matchBoard(src, queryWords(q)).map((h) => h.card.title);
const marked = (p: Piece[]) => p.map((x) => (x.hit ? `[${x.text}]` : x.text)).join('');

describe('folding', () => {
  it('drops capitals and accents', () => {
    expect(fold('Café ÉLAN Ñandú')).toBe('cafe elan nandu');
    expect(fold('Straße Øre Łódź İstanbul')).toBe('strasse ore lodz istanbul');
  });
});

describe('what was typed', () => {
  it('is words, each once, punctuation aside', () => {
    expect(queryWords('  Plan, the PLAN!  q4 ')).toEqual(['plan', 'the', 'q4']);
    expect(queryWords("don't")).toEqual(['dont']);
    expect(queryWords('🙂 ...')).toEqual([]);
  });
});

describe('matching', () => {
  const src = board([
    card('Plan the café opening'),
    card('Education budget'),
    card('Send the e-mail'),
    card('Hire a designer', { desc: 'Look at **portfolios** first\n- check references' }),
  ]);
  it('finds words at their start, without accents or capitals', () => {
    expect(titles(src, 'plan')).toEqual(['Plan the café opening']);
    expect(titles(src, 'CAFE')).toEqual(['Plan the café opening']);
    expect(titles(src, 'cat')).toEqual([]);
  });
  it('needs every word', () => {
    expect(titles(src, 'plan opening')).toEqual(['Plan the café opening']);
    expect(titles(src, 'plan budget')).toEqual([]);
  });
  it('finds joined words both ways', () => {
    expect(titles(src, 'email')).toEqual(['Send the e-mail']);
    expect(titles(src, 'e-mail')).toEqual(['Send the e-mail']);
  });
  it('reads descriptions without their marks', () => {
    expect(titles(src, 'portfolios')).toEqual(['Hire a designer']);
    expect(titles(src, 'references')).toEqual(['Hire a designer']);
  });
  it('finds unspaced scripts anywhere', () => {
    expect(titles(board([card('会议记录整理')]), '记录')).toEqual(['会议记录整理']);
  });
});

describe('what else on a card is searched', () => {
  const a = card('Fix the login', { values: { sev: 'o1', owner: 'sara', urgent: true, budget: 300, status: 'prog', start: '2026-10-24', due: '2026-11-01' } });
  const b = card('Write the brief');
  const gone = card('Old card');
  const src = board([a, b, gone], {
    comments: [comment(b.id, 'Ask @Sara Ali about the **venue**'), comment(gone.id, 'secret', { deleted: true })],
    files: [file(b.id, 'brief-v2.pdf'), file(BOARD_FILE, 'mountains.jpg')],
  });
  it("custom fields as they read: a dropdown's words, a person's name, a ticked box's name, a number", () => {
    expect(titles(src, 'critical')).toEqual(['Fix the login']);
    expect(titles(src, 'sara')).toEqual(['Fix the login', 'Write the brief']);
    expect(titles(src, 'urgent')).toEqual(['Fix the login']);
    expect(titles(src, '300')).toEqual(['Fix the login']);
  });
  it('not status, dates or option ids', () => {
    expect(titles(src, 'progress')).toEqual([]);
    expect(titles(src, '2026')).toEqual([]);
    expect(titles(src, 'o1')).toEqual([]);
  });
  it('comments, mentions and file names, never deleted comments or the board background', () => {
    expect(titles(src, 'venue')).toEqual(['Write the brief']);
    expect(titles(src, 'pdf')).toEqual(['Write the brief']);
    expect(titles(src, 'secret')).toEqual([]);
    expect(titles(src, 'mountains')).toEqual([]);
  });
  it('says where the match was', () => {
    const [h] = matchBoard(src, queryWords('venue'));
    expect(h.part).toMatchObject({ where: 'comment', label: 'Comment by Sara Ali' });
    expect(matchBoard(src, queryWords('critical'))[0].part).toMatchObject({ where: 'field', label: 'Severity' });
    expect(matchBoard(src, queryWords('login'))[0].part).toBeNull();
  });
});

describe('order', () => {
  it('title before description before comment; archived last', () => {
    const t = card('Venue booking');
    const d = card('Party', { desc: 'the venue' });
    const c = card('Food');
    const old = card('Venue, the old one', { archived: true });
    const src = board([c, d, old, t], { comments: [comment(c.id, 'which venue?')] });
    expect(titles(src, 'venue')).toEqual(['Venue booking', 'Party', 'Food', 'Venue, the old one']);
  });
  it('the most recently active first when equal', () => {
    const a = card('Venue A');
    const b = card('Venue B');
    const src = board([a, b], { logs: [{ id: 'l1', cardId: a.id, userId: null, at: 99999, action: 'renamed', detail: {} }] });
    expect(titles(src, 'venue')).toEqual(['Venue A', 'Venue B']);
  });
});

describe('keeping up', () => {
  it('sees a changed card and a new comment', () => {
    const a = card('Draft');
    const src = board([a]);
    expect(titles(src, 'final')).toEqual([]);
    src.card = new Map([[a.id, { ...a, title: 'Final draft' }]]);
    expect(titles(src, 'final')).toEqual(['Final draft']);
    const x = comment(a.id, 'looks great');
    src.comment = new Map([[x.id, x]]);
    expect(titles(src, 'great')).toEqual(['Final draft']);
  });
});

describe('board names', () => {
  it('by the same rules', () => {
    expect(nameMatches('MSc Computer Science', queryWords('comp sci'))).toBe(true);
    expect(nameMatches('MSc Computer Science', queryWords('puter'))).toBe(false);
  });
});

describe('marking matches', () => {
  it('marks the start of each matching word', () => {
    expect(marked(highlight('Plan the planning', queryWords('plan')))).toBe('[Plan] the [plan]ning');
  });
  it('across accents and folded letters', () => {
    expect(marked(highlight('Café Straße', queryWords('caf strass')))).toBe('[Caf]é [Straß]e');
  });
  it('joined words', () => {
    expect(marked(highlight('Send the e-mail', queryWords('email')))).toBe('Send the [e-mail]');
  });
  it('a short piece around the first match, cut at words', () => {
    const long = 'Some words before. '.repeat(10) + 'Then the venue is booked for Friday. ' + 'More after. '.repeat(10);
    const s = snippet(long, queryWords('venue'), 80);
    const text = s.map((p) => p.text).join('');
    expect(text.startsWith('…')).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(marked(s)).toContain('[venue]');
    expect(text.length).toBeLessThanOrEqual(82);
  });
});

describe('speed', () => {
  it('20 boards of 500 cards: built once, then each search is quick', () => {
    const boards = Array.from({ length: 20 }, (_, i) =>
      board(
        Array.from({ length: 500 }, (_, j) =>
          card(`Card ${i}-${j} about planning`, { desc: `Some longer description number ${j} with words like budget, venue and design.` }),
        ),
      ).card,
    ).map((cards, i) => ({ ...board([]), id: `b${i}`, card: cards }));
    let t = performance.now();
    for (const b of boards) matchBoard(b, queryWords('venue'));
    const build = performance.now() - t;
    t = performance.now();
    let found = 0;
    for (const b of boards) found += matchBoard(b, queryWords('desi plan')).length;
    const query = performance.now() - t;
    expect(found).toBe(10000);
    expect(build).toBeLessThan(1500);
    expect(query).toBeLessThan(400);
  });
});
