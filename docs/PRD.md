# Boardo: product requirements

Status: built and live (phases 1 to 3, plus the refinements in section 14)
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

- Boardo is a **separate product**: its own app, its own data and its own server. It lives at boardo.kaiserkhan.com, next to Elastic at elastic.kaiserkhan.com.
- Elastic stays a personal planner. Nothing personal (tasks, checklists, habits, goals, reviews) is ever shared through Boardo.
- The two connect through a secure, revocable link that each person sets up themselves. Elastic only ever sees the cards assigned to that person.
- Both apps work offline and sync when back online.
- Elastic's source is public at github.com/qkonline/elastic. The connection between the two is a contract (section 8 here, and section 5 of [ARCHITECTURE.md](ARCHITECTURE.md)). Any change to it is made on both sides together.

## 2. Users and roles

### 2.1 Accounts

- **R2.1** Anyone can create an account with their email address and sign in from any device.
- **R2.2** On first sign-in, a person gives their name. They can change it later, and their email (confirmed with a code sent to the new address), and add a profile photo, which the people in their boards see in place of their initials.
- **R2.2a** Tapping someone's name, face or mention (in comments and descriptions, the People on a card, a card's History) shows who they are: their name (first and last), email (tap to write to them), their role in the board, and how many open cards they have there.

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

- **R2.5a** Each person arranges the boards on Boards in their own order: dragging a tile (holding it first on a touch screen, so a swipe still scrolls), or Alt and an arrow key on one. It's theirs alone, kept with their account so every device shows it, and saved at once like dragging a card (offline, it waits and is sent later). New boards, and boards they join, come after the ones they've placed. Each tile is a link to its board, so it can open in a new tab.
- **R2.6** Every person can switch between:
  - **a project board**, showing only that project's cards;
  - **My cards**, showing every card assigned to them across all their projects, visible only to them;
  - **their Elastic day** (in Elastic, once connected).

## 3. Boards and columns

- **R3.1** A board has a name and a colour. An admin can give it a background: a colour, or an image, which everyone in the board sees behind the columns and on the board's tile in the board list. Like every setting, a new background shows only once the admin presses Save; an image can be removed the same way. In the dark theme an image is dimmed by a see-through dark layer, unlike the frosted header and columns, so the board stays dark.
- **R3.1a** An admin can choose how the board scrolls (Board settings, Board, Scrolling): **Each column** (the default), where every column scrolls on its own so its name and Add a card stay in view, or **Whole page**, where columns are as long as their cards and the page scrolls, with the board's header held at the top. It's saved with the Board section's Save and everyone in the board sees it.
- **R3.2** A board has columns, like Trello's lists. Columns can be named anything, for example "Campaign 1", "Campaign 2", "Campaign 3".
- **R3.3** Columns are **independent of Status**. A column groups cards however the project likes. Each card in it has its own status.
- **R3.4** Members can add, rename, reorder and remove columns. Removing a column that still has cards asks where the cards should go, or archives them.
- **R3.4b** Add a column sits after the last column. Beside columns it's a slim strip as wide as a tap target, with a plus level with the columns' names and the words running down it, so it doesn't take a column's width; it opens to the full form, scrolled into view. A board with no columns shows it full width with a line explaining columns.
- **R3.4a** No two columns in a board have the same name, letter case and spaces aside. Adding or renaming one to a name in use says so and waits; the server refuses it too. A removed column's name is free again.
- **R3.5** Cards can be dragged within a column and between columns, by mouse and by touch.
- **R3.6** A board can be filtered by person and by status.
- **R3.7** An admin can set what every new card in the board starts with (Board settings, New cards): someone it's assigned to, and a status. Both start as Nobody and None. Once saved, every card added after starts with them; cards already there stay as they are. A person who has left, or a status since deleted, is skipped.

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
- **R4.2a** Setting a due date on a card with no start date fills the start with the day before (at the due time, or 9:00, when the start has a time). A start already set is left alone. Like any change, it waits for Save.
- **R4.3** An admin can rename Status values and add new ones. The values that mean "in progress" and "completed" can be renamed but not removed, because the Elastic connection relies on them.
- **R4.4** A card can be assigned to more than one person, and anyone in the board can take someone off it (each person has a remove key, a draft until Save). Each assignee sees it in their My cards and, when its dates apply, in their Elastic day, and each can run their own timer on it.
- **R4.5** Time spent can't be edited by hand. It's the sum of all timer time logged against the card, including a timer that's running right now. Beside it, Elastic's mark opens a short explanation of what Elastic is and how its timers reach the card, with a link to open it.

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
- **R4.9a** An admin can choose, for each custom field, to **show it on cards** (off at first). Its value then shows on every card in the board, in the row with the status: a dropdown value as its coloured chip, like the status; anything else as a grey chip with the field's name ("Budget: 300"), a person with their face, a checkbox by its name when ticked. They wrap onto more lines when the column is narrow. Empty fields show nothing.

### 4.3 Comments

- **R4.10** Members can post comments on cards.
- **R4.11** Comments support emoji, both typed from the keyboard and picked from an emoji button: about 400, in groups (Smileys, People, Hearts and signs, Work, Celebrate, Food, Nature, Travel) with a tab for each, and the ones used lately on the device first.
- **R4.12** A person can edit or delete their own comments only.
- **R4.13** Comments and descriptions take light formatting: bold, italic, strikethrough, bulleted and numbered lists, from keys over the text box or ⌘B, ⌘I, ⌘⇧X, ⌘⇧8 and ⌘⇧7. Enter carries a list on. They're kept as plain text with marks (`**bold**`, `*italic*`, `~~struck~~`, `- `, `1. `) and shown as formatting, built from elements, never HTML, so nothing harmful can be injected. Links are made clickable.
- **R4.13a** Typing **@** in a comment or description lists the board's people just above the @, narrowed as their name is typed; picking one writes "@Their Name". A mention is shown picked out, and the person hears about it in the bell (R9.13) once the comment is posted or the description saved. Typing a first name alone works too when only one person in the board has it. Mentioning someone doesn't add them to the card. Only people in the board can be mentioned.
- **R4.13b** A card with a description shows its first words under its title, muted, at most two lines, without the formatting marks, as a hint that there's more to read. On boards and in My cards.

### 4.4 Attachments

- **R4.14** Members can add images and files to cards.
- **R4.15** Allowed formats only:
  - images: JPG, PNG, WebP, GIF;
  - PDF;
  - CSV;
  - Office documents: Word, Excel, PowerPoint.
- **R4.16** A file's type is checked from its contents, not just its name, so a renamed file of another kind is refused. CSV has no signature, so it must read as text (any encoding) and be none of the other kinds.
- **R4.17** Each file can be up to **30 MB** by default. An admin can raise the limit in project settings, up to 100 MB.
- **R4.18** Images show as thumbnails and open in a viewer. Other files download.
- **R4.19** Files are only reachable by members of the board.

### 4.5 Archiving

- **R4.20** Cards can be archived and restored. Archived cards are hidden from the board, My cards and Elastic, but kept with their history.
- **R4.21** An archived card can be deleted for good, by an admin or by whoever made it. Its comments, attachments and time go with it; its history stays in the project log, with an entry saying it was deleted.
- **R4.21a** Archived cards are found from an **Archived** link beside the board's filters, with their count. It opens a panel from the side, like Activity, with a search that finds them by the rules of R9.17. Each can be opened, restored, or deleted for good (R4.21). Board settings no longer lists them.

### 4.6 Dependencies

- **R4.22** Every card has a Dependencies section: the cards in the same board it waits on. Anyone in the board can add or remove them, and like every other change on a card, they're saved with Save.
- **R4.23** Each card it waits on shows its title, column and status, and a count of how many are done ("1 of 2 done"). When all are Completed it reads "Ready to start".
- **R4.24** A card also shows the cards that wait on it ("Holds up"). Tapping any of them opens that card.
- **R4.25** A card can't wait on itself, or on a card that already waits on it, however far down; those aren't offered. Adding and removing one is logged on the card.

### 4.7 The open card

- **R4.26** Opening a card shows it in a large window in the middle of the screen on a computer, and as a tall sheet on a phone, with two tabs: **Details** and **History** (its log, grouped by day).
- **R4.27** **Nothing a person changes on a card is saved until they press Save changes.** While there are unsaved changes, a bar offers Discard and Save changes, and closing the card (or opening another one from it) asks first. Comments, attachments, Mark done and Archive happen when tapped.
- **R4.28** Values read as plain text and become editable when tapped. Status, column, people and emoji open in small balloons over the card, so nothing moves when they open.
- **R4.28b** A dropdown field picks its value the way Status does: a balloon with its values as coloured chips and None at the end. A people field lists the board's people with their faces, and Nobody. Neither has a Done key.
- **R4.28a** On a keyboard, **Enter** saves the card's changes, and with nothing to save closes it; **Escape** closes it, asking first when there are changes (Enter then saves and closes). Enter keeps its usual job in the description and comment boxes (a new line), in a field being edited (it finishes the field; the next Enter saves), in an open balloon, and on a key reached with Tab.

## 5. Status and completion

### 5.1 Parts done

- **R5.1** When a card has several assignees, **each person finishes their own part**.
- **R5.2** The card shows how many parts are done, for example "1 of 2 done".
- **R5.3** When **every** assignee has finished their part, the card's status becomes **Completed** automatically.
- **R5.4** If a part is marked not done again, or a new assignee is added to a Completed card, the status goes back to **In Progress**.
- **R5.5** Anyone in the board can still change the status by hand at any time. For someone not on the card that's all it does.
- **R5.5d** For someone on the card, picking **Completed** is the same as their **Mark done**, and moving the card off Completed the same as their **Mark not done** (since 24 October 2026; before, a status picked by hand never touched anyone's part). Alone on a card, picking Completed marks it done and the key becomes Mark not done; Mark done sets Completed. On a shared card it marks only their part, and says so: the card keeps its status until everyone has done theirs, by either key, then completes by itself.
- **R5.5a** Marking your part done shows a message with **Undo** for a few seconds. Once it's done, the card offers **Mark not done** instead. Either takes the part back (R5.4).
- **R5.5b** An admin can mark someone else's part not done (from that person's name in the card's People), but never mark it done for them.
- **R5.5c** On a card with one person, Boardo doesn't speak of their "part": marking it done completes the card (the status says so), so the card window shows only Mark not done, and hints and updates say "done" rather than "their part is done".

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
  - a card it waits on added or removed (R4.25);
  - deleted for good (R4.21);
  - time worked through Elastic (for example "worked 1h 20m").
- **R6.3** All card logs together form one **project log** for the whole board, newest first, filterable by person and by card.
- **R6.3a** The project log reads as a feed: by day; one person's changes made close together under their name once, with the time; within those, each card's changes under the card's name once, which opens it; new cards added one after another folded into one line ("added 12 cards to Marketing", their names after it). The latest 40 changes show first, and Load more brings the next 40. Its filters (person, card) are as quiet as the board's.
- **R6.4** Logs can't be edited or deleted by anyone. They are written by the server, not by people's devices, so they can be trusted.

## 7. My cards

- **R7.1** Every person has a My cards board listing every card assigned to them across all the projects they belong to.
- **R7.2** It's private: only its owner sees it, and it reveals nothing about one project to members of another.
- **R7.3** Each card shows which project it's from (project name and colour), its status and its deadline.
- **R7.4** Cards are grouped by deadline (Overdue, Today, This week, Later, No date), with a switch to group by project instead.
- **R7.5** It isn't a copy. Opening a card opens the real card, and any change made from My cards is a change on the project board.

## 8. Elastic integration

### 8.1 Connecting

- **R8.1** When the email on someone's Elastic account also has a Boardo account in at least one board, Elastic offers to show their Boardo cards, and one tap links the two. Both apps confirmed that email with a code, so it's the same person. A Boardo account with another email connects from Elastic's settings instead: Boardo asks them to sign in if needed and to approve what Elastic may do.
- **R8.2** What Elastic is allowed:
  - **see** the cards assigned to that person, with only what it needs: title, project name and colour, status, dates, and whether their part or the card is done;
  - **record** that a timer started or stopped, and that their part is done.
- **R8.3** Elastic never sees comments, attachments, custom fields, other people's cards or boards the person isn't in.
- **R8.4** The connection can be revoked at any time from Boardo's settings, and disconnected from Elastic's settings. Disconnecting ends it on every device, and Elastic doesn't offer it again on its own.
- **R8.5** The connection belongs to the Elastic account (since 23 October 2026; before, it was made on each device). Every device signed in to that account gets Projects without connecting again, and signing out of Elastic ends it on that device. Elastic's server holds the link and talks to Boardo's server directly; devices never hold Boardo's token.
- **R8.5a** A change in Boardo to a card Elastic shows (its title, dates, status, people, the board's name or colour) reaches the person's open Elastic devices within seconds.

### 8.2 The Projects section in Elastic

- **R8.6** Elastic's day shows a folding **Projects** section, like its Checklist and habits section, listing the person's project cards for that day.
- **R8.7** The section only appears if the person is in at least one board. Otherwise there's no such section.
- **R8.8** Like Elastic's other sections, it has a title bar (icon, name, how many are done) and folds once it has more than 3 entries: it always opens folded, showing the first 3 with the third fading out above a Show all link.
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
- **R8.21** The running card takes its place in the day like any task that's been started: it goes at the current point, shows in the ribbon of tasks at the top of the day, and pushes the rest of the plan later as time passes.
- **R8.22** Starting sets the card to **In Progress** in Boardo (R5.6).
- **R8.23** Pause stops the clock, and resuming continues it. Postpone stops it for now, keeping the time worked.
- **R8.24** Starting another task while a card runs stops the card's timer and keeps the time worked. It does **not** mark the card done. The same goes for End my day.
- **R8.25** **Done** stops the timer and marks the person's part done (R5.7).
- **R8.26** All time worked is added to the card's Time spent, under the person's name, and noted in the card's log.
- **R8.27** Working offline is fine. Starts, stops and done marks are kept on the device and sent when it's back online, recorded at the time they really happened, and never counted twice.

## 9. Accounts, sync and offline

- **R9.1** Sign-in is by email. The person enters their address and gets a 6-digit code by email, which they type in. No passwords.
- **R9.1b** Someone who already has a code (asked for on another device, say) can choose "I already have a code" after typing their email, and type it without a new one being sent.
- **R9.1a** Once signed in, a person can add a passkey on each device (Face ID, Touch ID or the device's screen lock), and then sign in with it instead of a code. Boardo offers this after a sign-in with a code. Passkeys are listed in Account, where they can be removed.
- **R9.2** A person stays signed in on a device until they sign out.
- **R9.2a** When a different person signs in on a device, nothing of the last person's boards stays on it.
- **R9.3** **Offline first:** every board a person belongs to is kept on their device. They can open boards, read cards and make changes without a connection.
- **R9.3a** If the device can't save (it's out of storage, say), changes stay on screen and a banner says so, with a backup to download. Boardo keeps trying, and never reloads for an update while changes are waiting.
- **R9.4** Changes sync when the device is back online, and show up live on everyone else's devices while they're online.
- **R9.5** When two people change the same card while offline, the most recent change to each field wins. Changes to different fields both survive. Comments, attachments, time and log entries are always kept, never overwritten.
- **R9.5a** A change the board doesn't allow (made offline, say, by someone who has since stopped being an admin) is undone, and the person is told. A copy stays on the device, listed in Account under Undone changes, where its text can be copied.
- **R9.5b** A card added while offline to a column that someone else removed meanwhile goes to the end of the first column, never missing.
- **R9.6** Attachments added while offline are uploaded once back online.
- **R9.7** When someone is removed from a board, it disappears from their devices, including any copy kept for offline use.
- **R9.8** Boardo can be installed on a phone's home screen and works like an app. An installed copy takes a new version at a quiet moment (on coming back to it or leaving it, never while something is open), and pulling down refreshes it, as in Elastic.

### 9.1 Invites

- **R9.9** An admin invites someone by email address, choosing admin or member.
- **R9.10** The invitee gets an email with a link. They sign in or sign up with that same email address and join the board.
- **R9.11** People who already have an account also see pending invites when they open Boardo.
- **R9.12** Invites expire after 14 days. An admin can resend or cancel them.

### 9.2 Updates (the bell)

- **R9.13** A bell (top right on a phone, in the top bar on a computer) collects the updates meant for the person, as in Facebook. It shows a red count of those that came since it was last opened; opening it clears the count on every device. Each update shows who did it, what happened and on which card, the comment or line quoted where there is one, the board and how long ago. New ones are tinted until opened, and Mark all as read reads them all. All and Unread switch between everything and what's unread. Tapping an update opens its card. Updates are kept for 60 days.
- **R9.14** A person gets an update when:
  - someone mentions them (R4.13a);
  - someone puts them on a card, or takes them off one;
  - on a card they're on or made: a new comment, a new status, Completed, or a new due date;
  - a card that one of theirs waits on is done, once everything it waits on is;
  - someone adds them to a board, gives them another role, or takes them out.

  Never for their own changes.
- **R9.15** Notifications: in Account, each device can turn on notifications for these updates. They arrive even with Boardo closed or the phone locked, and tapping one opens its card. On iPhone and iPad they work once Boardo is on the Home Screen, as in Elastic. Signing out turns them off on that device.

### 9.3 Search

- **R9.17** Search follows the same rules everywhere (a board's search, search across all boards, Archived): every word typed must be found on the card; capitals, accents and punctuation don't count ("cafe" finds "Café", "email" finds "e-mail"); a word is found at the start of a word ("plan" finds "planning", "cat" doesn't find "education"), except in scripts written without spaces, found anywhere. It searches a card's title, description and comments (formatting marks aside, deleted comments never), its custom field values as they read (a dropdown's words, a person's name, a ticked box's field name, a number) and its files' names. Not status, people, column or dates, which the filters cover. Title matches come first, then files and fields, then descriptions, then comments; equal ones by the most recent activity; archived cards after the rest. It all runs on the device, so it works offline and nothing typed is sent anywhere.

## 10. Platform and hosting

- **R10.1** Boardo is hosted at **boardo.kaiserkhan.com** (since 23 October 2026; before, at kaiserkhan.com/boardo, which now hands each copy over to the new address, signed in).
- **R10.2** The app is a web app served by the same Cloudflare Worker as its API, on its own address, so no other site's pages can read its storage.
- **R10.2a** Each place has its own address, so it can be bookmarked, shared and opened in a new tab, and the browser's Back and Forward move between places: Boards (`/`), My cards (`/my-cards`), Account (`/account`), a board (`/b/<board>/<its name>`), its settings (`…/settings`) and a card open on it (`…/c/<card>`). The name part is only there to read: an old one still works. The window's title names the place. A link opened while signed out is where the person lands after signing in; a board they aren't in falls back to Boards. Back with a card's changes not yet saved asks first, as closing does. Elastic's card links (`?card=`) still work and turn into the card's address.
- **R10.3** The server runs on **Cloudflare**: a Worker for the API, a database for accounts and access, one live data store per board, and file storage for attachments.
- **R10.4** Email (sign-in codes and invites) is sent through **Resend**, on its free tier.
- **R10.5** Free tiers are preferred for everything, as long as they cover the use.
- **R10.6** The source code is public on GitHub at `github.com/qkonline/boardo`, under the MIT licence.
- **R10.7** Boardo and Elastic each keep their own data. They share a domain today but nothing in either depends on that, so either can move to its own domain later.

## 11. Non-functional requirements

### 11.1 Security and privacy

- **R11.1** Access is checked on the server for every request and every live connection. Hiding things on screen is never the only protection.
- **R11.2** Sign-in codes expire after 10 minutes, allow 5 tries and work once. Sending is rate-limited per address and per network, and every request that needs no sign-in is limited to 60 a minute from one network. The app never reveals whether an email address has an account.
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
- **R11.13** Nothing a person changes anywhere in Boardo is saved automatically. Changes wait for Save, Add, Update or Comment, as in Elastic (R4.27, R3.1).

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

Phases 1 to 3 went live on 22 October 2026. Refinements since, all live:
- any colour for boards and status values, from a colour wheel;
- the project log as a panel from the right; status optional and shown as a chip in each card's foot row, beside its date, with a green tick on each person whose part is done;
- filters beside the board's name; deleting archived cards (R4.21);
- passkeys (R9.1a); quiet updates and pull to refresh (R9.8);
- board backgrounds and tiles (R3.1), profile photos and changing name and email (R2.2);
- the open card redesigned (section 4.7), with Undo after Mark done (R5.5a);
- dependencies (section 4.6).

On 23 October 2026, all live:
- Elastic linked per account, on every device (R8.5, R8.5a);
- after an outside review of the code: a refused change is undone with a copy kept in Account (R9.5a), a card added offline to a removed column goes to the first column (R9.5b), a banner when the device can't save (R9.3a), and another account on the same device starts clean (R9.2a);
- a new address, boardo.kaiserkhan.com, with each copy at the old one handed over signed in (R10.1, R10.2);
- @mentions (R4.13a), the bell (R9.13, R9.14) and notifications on phones and computers (R9.15). Of three looks for the bell (a feed, grouped by board, a timeline), the user chose the feed;
- who someone is from their name or mention (R2.2a), many more emoji (R4.11), and no "your part" on one-person cards (R5.5c);
- Completed picked by hand is your Mark done (R5.5d), and what new cards start with (R3.7);
- archived cards in a searchable side panel beside the filters (R4.21a);
- a description's first words on its card (R4.13b);
- Enter to save and close a card (R4.28a), and dropdown and people fields picked like Status (R4.28b);
- custom fields shown on cards (R4.9a);
- the project log as a feed, 40 at a time (R6.3a);
- removing a column works again (it had stopped doing anything), and column names are unique (R3.4a);
- Add a column stays readable over a board background (R3.1).

On 26 October 2026, live: a board can scroll as a whole page instead of column by column (R3.1a), cards keep their full size in a long column, a sideways scroll over a column moves the board, a background image is dimmed in the dark theme (R3.1), Add a column is a slim strip beside columns (R3.4b), each place has its own address (R10.2a), and each person's own order of their boards (R2.5a).
