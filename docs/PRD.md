# Boardo: product requirements

Status: agreed, ready to build
Last updated: 22 October 2026
Owner: Qaisar Khan

## 1. Overview

### 1.1 What Boardo is

Boardo is a shared project board app, in the spirit of Trello. Each project gets its own board, with columns of cards, and the people working on that project are invited to it. Cards are assigned to people, carry dates, a status and any fields the project needs, and collect comments, files and a full history of what happened to them.

### 1.2 Why it exists

The owner works on several projects at the same time, each with different people, and also has a personal life to plan: exercise, groceries, checklists, habits and goals. Today the personal side lives in **Elastic**, a day planner where the order of the list is the plan (kaiserkhan.com/planner). The project side has no home.

Boardo is that home. It keeps project work shared with exactly the right people, while each person's day stays private in Elastic. The two apps talk to each other, so the project work assigned to you shows up in your day, and the time you spend on it flows back to the card.

### 1.3 Example

- Project A has a board. Person A is invited to it.
- Project B has a board. Person B is invited to it.
- The owner is in both.

In a meeting, card 1 in Project A is assigned to the owner and card 2 to Person A. In Project B, some cards go to the owner and some to Person B.

Afterwards:
- Person A sees only Project A. Person B sees only Project B. The owner sees both.
- Inside Project A's board, everyone in Project A sees all of its cards, whoever they're assigned to.
- The owner's **My cards** board lists their cards from Project A and Project B together.
- On any day a card's dates cover, it also shows in the owner's Elastic day, next to their personal tasks. Starting it there runs a timer and sets the card to In Progress.

### 1.4 Relationship to Elastic

- Boardo is a **separate product**: its own app, its own data and its own server. It lives at kaiserkhan.com/boardo, next to Elastic at kaiserkhan.com/planner.
- Elastic stays a personal planner. Nothing personal (tasks, checklists, habits, goals, reviews) is ever shared through Boardo.
- The two connect through a secure, revocable link that each person sets up themselves. Elastic only ever sees the cards assigned to that person.
- Both apps work offline and sync when back online.
- Elastic's source is public at github.com/qkonline/elastic. The connection between the two is a contract (section 8 here, and section 5 of [ARCHITECTURE.md](ARCHITECTURE.md)). Any change to it is made on both sides together.

## 2. Users and roles

### 2.1 Accounts

- **R2.1** Anyone can create an account with their email address and sign in from any device.
- **R2.2** On first sign-in, a person gives their name. They can change it later.

### 2.2 Board roles

Each board has two roles.

| | Admin | Member |
|---|---|---|
| See the board and all its cards | yes | yes |
| Create, edit, move and archive cards | yes | yes |
| Create, rename and reorder columns | yes | yes |
| Fill in and change field values on cards | yes | yes |
| Comment, add attachments | yes | yes |
| Add and remove members | yes | no |
| Make a member an admin, or an admin a member | yes | no |
| Set up fields: add, rename, reorder, remove, change type, edit dropdown values | yes | no |
| Change project settings, such as the attachment size limit | yes | no |
| Rename or delete the board | yes | no |

- **R2.3** The person who creates a board is its first admin.
- **R2.4** A board always has at least one admin. The last admin can't leave or be removed until another member is made admin, or the board is deleted.
- **R2.5** People only ever see boards they belong to. Nothing about other boards (names, cards, members) is visible to them, anywhere in the app.

### 2.3 Each person's views

- **R2.6** Every person can switch between:
  - **a project board**, showing only that project's cards;
  - **My cards**, showing every card assigned to them across all their projects, visible only to them;
  - **their Elastic day** (in Elastic, once connected).

## 3. Boards and columns

- **R3.1** A board has a name and a colour.
- **R3.2** A board has columns, like Trello's lists. Columns can be named anything, for example "Campaign 1", "Campaign 2", "Campaign 3".
- **R3.3** Columns are **independent of Status**. A column groups cards however the project likes. Each card in it has its own status.
- **R3.4** Members can add, rename, reorder and remove columns. Removing a column that still has cards asks where the cards should go, or archives them.
- **R3.5** Cards can be dragged within a column and between columns, by mouse and by touch.
- **R3.6** A board can be filtered by person and by status.

## 4. Cards

### 4.1 Default fields

Every card has these fields.

| Field | Type | Notes |
|---|---|---|
| Title | one line of text | required |
| Description | longer text | optional |
| Start date | date | an admin can switch it to date and time |
| End date | date | an admin can switch it to date and time |
| Status | dropdown | Not Started, In Progress, Completed, Blocked; an admin can add more values. Optional: a new card has no status until someone picks one |
| Assignees | people | one or more members of the board |
| Time spent | read-only | total timer time from everyone, through Elastic, with a breakdown per person |

- **R4.1** Title, Description, Start date, End date, Status, Assignees and Time spent are on every card in every board.
- **R4.2** An admin can change a date field from date to date and time, and back.
- **R4.3** An admin can rename Status values and add new ones. The values that mean "in progress" and "completed" can be renamed but not removed, because the Elastic connection relies on them.
- **R4.4** A card can be assigned to more than one person. Each assignee sees it in their My cards and, when its dates apply, in their Elastic day, and each can run their own timer on it.
- **R4.5** Time spent can't be edited by hand. It's the sum of all timer time logged against the card, including a timer that's running right now.

### 4.2 Custom fields

- **R4.6** An admin can add fields to a project. Each field has a **name** and a **type**.
- **R4.7** Field types:
  - text (one line);
  - long text;
  - number;
  - date;
  - date and time;
  - dropdown, with values the admin sets;
  - checkbox;
  - person (a board member).
- **R4.8** Once a field is added, it appears on every card in that project. Members see it and change its value. Members can't add, rename, retype or remove fields.
- **R4.9** An admin can reorder fields, rename them, change dropdown values and remove fields. Removing a field asks first, since its values on every card go with it.

### 4.3 Comments

- **R4.10** Members can post comments on cards.
- **R4.11** Comments support emoji, both typed from the keyboard and picked from an emoji button.
- **R4.12** A person can edit or delete their own comments only.
- **R4.13** Comments are plain text. Links are made clickable. No formatting markup is interpreted, so nothing harmful can be injected.

### 4.4 Attachments

- **R4.14** Members can add images and files to cards.
- **R4.15** Allowed formats only:
  - images: JPG, PNG, WebP, GIF;
  - PDF;
  - Office documents: Word, Excel, PowerPoint.
- **R4.16** A file's type is checked from its contents, not just its name, so a renamed file of another kind is refused.
- **R4.17** Each file can be up to **30 MB** by default. An admin can raise the limit in project settings, up to 100 MB.
- **R4.18** Images show as thumbnails and open in a viewer. Other files download.
- **R4.19** Files are only reachable by members of the board.

### 4.5 Archiving

- **R4.20** Cards can be archived and restored. Archived cards are hidden from the board, My cards and Elastic, but kept with their history.
- **R4.21** An archived card can be deleted for good, by an admin or by whoever made it. Its comments, attachments and time go with it; its history stays in the project log, with an entry saying it was deleted.

## 5. Status and completion

### 5.1 Parts done

- **R5.1** When a card has several assignees, **each person finishes their own part**.
- **R5.2** The card shows how many parts are done, for example "1 of 2 done".
- **R5.3** When **every** assignee has finished their part, the card's status becomes **Completed** automatically.
- **R5.4** If a part is marked not done again, or a new assignee is added to a Completed card, the status goes back to **In Progress**.
- **R5.5** Anyone in the board can still change the status by hand at any time. Doing so doesn't change anyone's part.

### 5.2 Automation from Elastic

- **R5.6** Starting a timer on a card in Elastic sets the card's status to **In Progress**, whatever it was before.
- **R5.7** Finishing a card in Elastic marks that person's part done. That leads to Completed when it was the last part (R5.3).
- **R5.8** Every automatic change is written to the card's log, naming the person and the time.

## 6. Logs

- **R6.1** Every card keeps a log of what happened to it, with who and when. For example: "Mr. X marked this card Completed at 3:42 pm on 21 Oct 2026".
- **R6.2** Logged events include:
  - card created, archived or restored;
  - moved to another column;
  - any field changed, showing the old and new value;
  - assigned or unassigned;
  - a part marked done or not done;
  - status changed, by hand or automatically;
  - comment added;
  - attachment added or removed;
  - time worked through Elastic (for example "worked 1h 20m").
- **R6.3** All card logs together form one **project log** for the whole board, newest first, filterable by person and by card.
- **R6.4** Logs can't be edited or deleted by anyone. They are written by the server, not by people's devices, so they can be trusted.

## 7. My cards

- **R7.1** Every person has a My cards board listing every card assigned to them across all the projects they belong to.
- **R7.2** It's private: only its owner sees it, and it reveals nothing about one project to members of another.
- **R7.3** Each card shows which project it's from (project name and colour), its status and its deadline.
- **R7.4** Cards are grouped by deadline (Overdue, Today, This week, Later, No date), with a switch to group by project instead.
- **R7.5** It isn't a copy. Opening a card opens the real card, and any change made from My cards is a change on the project board.

## 8. Elastic integration

### 8.1 Connecting

- **R8.1** In Elastic's settings, a person connects their Boardo account. Boardo asks them to sign in if needed and to approve what Elastic may do.
- **R8.2** What Elastic is allowed:
  - **see** the cards assigned to that person, with only what it needs: title, project name and colour, status, dates, and whether their part or the card is done;
  - **record** that a timer started or stopped, and that their part is done.
- **R8.3** Elastic never sees comments, attachments, custom fields, other people's cards or boards the person isn't in.
- **R8.4** The connection can be revoked at any time from Boardo's settings, and disconnected from Elastic's settings.
- **R8.5** The connection is made per device and kept on that device. Elastic's own server never holds it.

### 8.2 The Projects section in Elastic

- **R8.6** Elastic's day shows a folding **Projects** section, like its Checklist and habits section, listing the person's project cards for that day.
- **R8.7** The section only appears if the person is in at least one board. Otherwise there's no such section.
- **R8.8** Like Elastic's other sections, it folds once it has more than 3 entries, showing the first 3 with the third fading out, and remembers whether it's folded on each device.
- **R8.9** Cards aren't dragged into the plan. They live in this section.
- **R8.10** Each row shows:
  - the card's title;
  - the project it belongs to, in the project's colour;
  - its status;
  - its deadline: Overdue, Due today, Due tomorrow, a weekday such as Wednesday for the coming week, or a date further out. A date and time deadline includes the time, for example "Due today, 5 pm".
- **R8.11** Tapping a row shows the card's details, with a link to open it in Boardo.

### 8.3 Which cards show in Elastic

- **R8.12** Only cards **assigned to that person**.
- **R8.13** Cards with **no dates at all** never show.
- **R8.14** A card shows on **every day its date range covers**, from its start date to its end date. A card with only one date shows on that day.
- **R8.15** A card whose end date has passed and whose status is **In Progress** keeps showing on every following day as **Overdue**, until it's done.
- **R8.16** A card whose end date has passed and whose status is anything else (Not Started, Blocked, or a custom value) shows only on the days its range covered, then leaves Elastic. It stays on its board and in My cards as usual.
- **R8.17** Once the person's part is done, or the card is Completed, it shows ticked for the rest of that day and is gone after.
- **R8.18** Archived cards never show.

### 8.4 Working on a card from Elastic

- **R8.19** Each row has a Start button. Like other tasks in Elastic, it waits until the person has started their day.
- **R8.20** Starting runs a **timer that counts up, with no limit**. There's no time's-up alert.
- **R8.21** The running card takes its place in the day like any task that's been started: it goes at the current point, shows in the day strip, and pushes the rest of the plan later as time passes.
- **R8.22** Starting sets the card to **In Progress** in Boardo (R5.6).
- **R8.23** Pause stops the clock, and resuming continues it. Postpone stops it for now, keeping the time worked.
- **R8.24** Starting another task while a card runs stops the card's timer and keeps the time worked. It does **not** mark the card done. The same goes for End my day.
- **R8.25** **Done** stops the timer and marks the person's part done (R5.7).
- **R8.26** All time worked is added to the card's Time spent, under the person's name, and noted in the card's log.
- **R8.27** Working offline is fine. Starts, stops and done marks are kept on the device and sent when it's back online, recorded at the time they really happened, and never counted twice.

## 9. Accounts, sync and offline

- **R9.1** Sign-in is by email. The person enters their address and gets a 6-digit code by email, which they type in. No passwords.
- **R9.1a** Once signed in, a person can add a passkey on each device (Face ID, Touch ID or the device's screen lock), and then sign in with it instead of a code. Boardo offers this after a sign-in with a code. Passkeys are listed in Account, where they can be removed.
- **R9.2** A person stays signed in on a device until they sign out.
- **R9.3** **Offline first:** every board a person belongs to is kept on their device. They can open boards, read cards and make changes without a connection.
- **R9.4** Changes sync when the device is back online, and show up live on everyone else's devices while they're online.
- **R9.5** When two people change the same card while offline, the most recent change to each field wins. Changes to different fields both survive. Comments, attachments, time and log entries are always kept, never overwritten.
- **R9.6** Attachments added while offline are uploaded once back online.
- **R9.7** When someone is removed from a board, it disappears from their devices, including any copy kept for offline use.
- **R9.8** Boardo can be installed on a phone's home screen and works like an app.

### 9.1 Invites

- **R9.9** An admin invites someone by email address, choosing admin or member.
- **R9.10** The invitee gets an email with a link. They sign in or sign up with that same email address and join the board.
- **R9.11** People who already have an account also see pending invites when they open Boardo.
- **R9.12** Invites expire after 14 days. An admin can resend or cancel them.

## 10. Platform and hosting

- **R10.1** Boardo is hosted at **kaiserkhan.com/boardo**.
- **R10.2** The app is a static web app, served from the same Hostinger site as Elastic.
- **R10.3** The server runs on **Cloudflare**: a Worker for the API, a database for accounts and access, one live data store per board, and file storage for attachments.
- **R10.4** Email (sign-in codes and invites) is sent through **Resend**, on its free tier.
- **R10.5** Free tiers are preferred for everything, as long as they cover the use.
- **R10.6** The source code is public on GitHub at `github.com/qkonline/boardo`, under the MIT licence.
- **R10.7** Boardo and Elastic each keep their own data. They share a domain today but nothing in either depends on that, so either can move to its own domain later.

## 11. Non-functional requirements

### 11.1 Security and privacy

- **R11.1** Access is checked on the server for every request and every live connection. Hiding things on screen is never the only protection.
- **R11.2** Sign-in codes expire after 10 minutes and allow 5 tries. Sending is rate-limited per address and per network. The app never reveals whether an email address has an account.
- **R11.3** Sign-in sessions and connection tokens are stored only in scrambled (hashed) form on the server.
- **R11.4** Only Boardo's own site, and Elastic for its narrow connection, may call the API.
- **R11.5** Files are served only to board members, through short-lived links, and non-image files always download rather than open in the browser.
- **R11.6** A person can delete their account. They can't while they're the last admin of a board (R2.4).

### 11.2 Limits

- **R11.7** Attachments: 30 MB each by default, adjustable by an admin up to 100 MB (R4.17).
- **R11.8** The design should comfortably handle a person being in about 20 boards. More is allowed but may need later work.

### 11.3 Design and wording

- **R11.9** Boardo is a sibling of Elastic: its own look, but the same principles:
  - little rounding;
  - no orange;
  - raised buttons that press down;
  - coloured icons;
  - light and dark themes;
  - phone tap targets at least 44 px.
- **R11.10** Wording is short, plain and in sentence case. No em dashes, no filler.
- **R11.11** Before screens are built, two or three design directions are shown and one is chosen.
- **R11.12** It works well on a phone and on a computer.

## 12. Assumptions to confirm

These are reasonable defaults, used unless the owner says otherwise.

1. A card with only one date (only a start date or only an end date) counts as a one-day range on that date (R8.14).
2. Members can create, edit, rename and reorder columns. Only admins manage fields, members, settings and the board itself (section 2.2).
3. Changing a card's status by hand doesn't change anyone's part done (R5.5).
4. Starting a card in Elastic waits for Start my day, like other tasks (R8.19).
5. My cards groups by deadline by default, with a switch to group by project (R7.4).
6. The attachment limit can be raised to at most 100 MB (R4.17).

## 13. Out of scope for now

- Mentions (@name) and notifications for comments and assignments.
- Card due-date reminders from Boardo itself (Elastic's own reminders still apply to what's in a person's day).
- Automation rules like Trello's Butler, beyond the status automation described here.
- Views other than columns, such as calendar, timeline or table, in Boardo.
- Card templates, board templates, checklists inside cards.
- Guests or public boards.
- Importing from Trello.

## 14. Phases

Each phase is released live before the next starts.

1. **Accounts and boards**
   - email sign-in;
   - boards with members, admins and invites;
   - columns;
   - cards with the default fields;
   - offline use and live sync;
   - card and project logs.
2. **The rest of Boardo**
   - custom fields;
   - comments with emoji;
   - attachments;
   - My cards;
   - board filters;
   - connected apps settings.
3. **Time and the Elastic connection**
   - timers and Time spent;
   - parts done and automatic completion;
   - connecting Elastic;
   - the Projects section in Elastic.
