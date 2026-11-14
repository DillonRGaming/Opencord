# 100 ideas for Opencord

Grouped by area. ★ = ones I'd do first: cheap to build on what's already here, and people would feel the difference.

## New channel types
1. ★ **Stage channel** – a voice room where a few people speak and everyone else listens; listeners raise a hand to be brought up.
2. ★ **Music room** – a shared YouTube/SoundCloud queue that plays in sync for everyone in it, with votes to skip.
3. **Watch party** – a synced video player (YouTube or an uploaded file) with play/pause/seek shared by everyone in the room.
4. **Kanban channel** – columns of cards (To do / Doing / Done) everyone can drag; cards link to messages.
5. **Wiki channel** – Markdown pages anyone can edit, with history and links between pages.
6. **Calendar channel** – events with RSVP (going / maybe / no), reminders, and an .ics feed.
7. ★ **Gallery channel** – only images and videos, shown as a grid, with an album per post.
8. **Q&A channel** – posts are questions; answers can be upvoted and the asker marks one as solved.
9. **Announcements channel** – only admins post; other servers can "follow" it and get the posts copied in.
10. **Countdown channel** – a big timer to a date (a launch, a holiday, a trip) pinned at the top.
11. **Pixel canvas** – a shared r/place-style grid where everyone can place one pixel every few minutes.
12. **Shared notepad** – one live-edited text document per channel, like a group sticky note.
13. **Link board** – drop links; they become cards with previews, tags and upvotes.
14. **Soundboard channel** – short clips anyone in voice can play to the room.
15. **Code playground** – a shared editor that runs small JS/Python snippets and shows the output.

## Whiteboards (building on what's there)
16. ★ Shapes and arrows (rectangle, ellipse, line, arrow) that snap.
17. ★ Text boxes and sticky notes on the board.
18. Paste or drop images onto the board.
19. See other people's cursors with their names while they draw.
20. Export the visible area (or everything) as a PNG.
21. Lasso-select strokes to move, recolour or delete them.
22. "Follow" someone's view so the board pans when theirs does (for teaching).
23. A minimap in the corner showing where you are on the endless canvas.

## Posts (building on what's there)
24. ★ Tags on posts (bug, idea, question…) with a filter row at the top.
25. Pin a post to the top of the list.
26. Sort by newest, most replies, or most reactions.
27. Mark a post as solved/closed and lock replies.
28. Follow a post to get notified about every new reply.

## Messaging
29. ★ **Threads** – reply in a side panel without filling up the main chat.
30. ★ **Scheduled messages** – write now, send at a time you choose.
31. **Voice messages** – hold the mic button to record, with a waveform player.
32. **Message forwarding** to another channel or DM, with a link back to the original.
33. **Silent messages** (`@silent`) that don't ping anyone.
34. **Edit history** – click "(edited)" to see the earlier versions.
35. ★ **Markdown preview** while typing for code blocks, spoilers and lists.
36. **Polls with images** as options, and anonymous polls.
37. **Reminders** – "remind me about this message in 2 hours".
38. **Bookmarks** – save messages to a private list.
39. **Disappearing messages** in DMs (gone after 24 hours or a week).
40. **Quote reply** – select text in a message and quote just that.
41. **Code snippets** with syntax highlighting, a copy button and line numbers.
42. **Translate** a message to your language with one click.
43. ★ **Drafts that survive** switching channels and reloading.
44. **Read receipts** in DMs (optional, off by default).
45. **Typing in threads/posts** shown in the posts list ("2 people replying").

## Voice and video
46. ★ **Noise suppression** toggle (RNNoise in a worklet).
47. ★ **Push-to-talk** with a key you choose.
48. Per-person volume sliders.
49. **Screen share with audio** (tab audio where the browser allows it).
50. **Picture-in-picture** for a video tile, so it floats while you chat.
51. **Background blur** for the camera.
52. **Call recording** (with everyone told it's on).
53. **Live captions** using the browser's speech recognition.
54. Voice **activity history**: "Alex was in Lounge 2h ago".
55. **Go live** – stream your screen to a channel for people who aren't in voice.

## Servers and community
56. ★ **Server templates** – start a new server from Gaming, Study group, Friends, or a copy of an existing one.
57. **Welcome screen** for new members: rules to accept and channels to start in.
58. **Onboarding questions** that hand out roles ("What games do you play?").
59. ★ **Role permissions** – per role: manage messages, kick, ban, manage channels, mention everyone.
60. **Per-channel permissions** – private channels only some roles can see.
61. **Role icons** (an emoji or small picture next to names).
62. **Mentionable roles** – `@Mods` pings everyone with the role.
63. **Server discovery** – a public list of servers that opt in.
64. **Server boosts / levels** for fun (more emoji slots, bigger uploads), no money involved.
65. **Server stats** – members over time, busiest channels, busiest hours.
66. **Vanity invite links** (`/invite/gamenight`).
67. **Events** with a start time that ping people when they begin, and a voice channel attached.
68. **Leveling** – XP for chatting, with roles at levels (optional, per server).
69. **Starboard** – messages that get N ⭐ reactions get copied to a highlights channel.
70. **Custom stickers** per server, alongside custom emoji.

## Bots and automation
71. ★ **Slash commands for bots** that show up in the `/` list with descriptions.
72. **Buttons and menus** on bot messages that trigger scripts when clicked.
73. **Webhooks** – a URL that posts into a channel (for GitHub, CI, home automation).
74. **Bot templates** – Welcome bot, Moderation bot, Trivia bot, ready to install.
75. **Scheduled scripts** with a calendar time ("every Friday at 18:00").
76. **Lists and maths blocks** in the bot builder (add to list, pick random from list, length).
77. **"When a reaction is added"** and **"when someone joins voice"** triggers.
78. **Automod** – block words, links, spam bursts, all-caps; time out automatically.
79. A **bot log** showing each run, which blocks ran and what failed.
80. **HTTP request block** (to allowed hosts) so bots can fetch weather, jokes, stats.

## Profiles and social
81. ★ **Profile themes** – two colours that tint your profile card.
82. **Pronouns** field on profiles.
83. **Activity status** – "Playing…", "Listening to…", set by hand.
84. **Mutual servers and friends** shown on profiles.
85. **Friend nicknames** – your own private name for someone.
86. **Close friends** list that can see your status when you're invisible.
87. **Birthdays** (opt-in) with a 🎂 next to the name on the day.
88. **Profile badges** – early user, bot builder, server owner.

## Look and feel
89. ★ **Theme editor** – pick every colour with the new colour picker and share the theme as a code.
90. **Compact mode on phones** with smaller avatars and tighter rows.
91. **Animated avatars and banners** (GIF / WebP).
92. **Chat backgrounds** per channel (a soft image or gradient).
93. **Font picker with preview** and a dyslexia-friendly option.
94. **Reduced motion** setting that turns off the slide and spring animations.

## Phones, notifications, reliability
95. ★ **Install as an app (PWA)** with an icon, splash screen and offline shell.
96. ★ **Push notifications** for DMs and mentions, even with the tab closed.
97. **Quiet hours** – no notifications between times you pick.
98. **Per-channel notification settings** – all messages / mentions only / nothing.
99. **Data export** – download all your messages and files as a zip.
100. **End-to-end encrypted DMs** (optional, with a key per device).

---

# 100 more (101–200)

Already built since the first list: posts, whiteboards, calendar, music and wiki channels, DM calls, DM pings, mentionable roles (62), bot slash commands (71), bot buttons (72), webhooks (73), the bot web-request block (80), message links (106), linked channels (137), bot select menus (157), server folders (172), translation (42), and multi-account switching (194).

## Chat
101. ★ **Message search filters** – `from:alex has:image before:2026-10-01 in:#general`.
102. ★ **Jump to unread** bar at the top of a channel ("12 new messages since 18:04").
103. **Inline replies preview** – hover a reply's quote to see the whole original.
104. **Swipe a message right to reply** on phones.
105. **Long-press a message** on phones for a bottom sheet of actions.
106. **Link-to-message** – copying a message link shows a quoted card when pasted.
107. **Message "seen by"** in small group DMs (optional).
108. **Pinned message banner** at the top of a channel, cycling through the pins.
109. **Slow typing indicator for long messages** ("Alex is writing a lot…").
110. **Paste a table** from a spreadsheet and get a Markdown table.
111. **Mentions inbox filter** – only messages that mention you, across all servers.
112. **"Mark unread from here"** on any message.
113. **GIF search** in the emoji picker (Tenor/Giphy key set by the server owner).
114. **Stickers** that animate (Lottie/APNG).
115. **Chat export** of one channel to Markdown or HTML.

## Voice and video
116. ★ **Voice channel text chat** – every voice room gets its own chat beside the tiles.
117. **Spatial audio** – people's voices placed left/right by their tile.
118. **Raise hand** in any voice room.
119. **Voice status** – a short "working on homework" line under your name in the channel list.
120. **Auto-leave when idle** after 30 minutes alone.
121. **Video quality setting** (data saver / normal / HD).
122. **Watch together** – share a YouTube video in a voice room and it plays in sync.
123. **Screen-share annotations** – viewers can draw on the shared screen.
124. **Recording clips** – the last 30 seconds of a call, saved by a key press.
125. **Call reactions** – emoji that float up over your tile.

## Channels
126. ★ **Threads inside posts** for longer side discussions.
127. **Kanban channel** (from the first list) using the whiteboard's realtime layer.
128. **Poll channel** – every message is a poll, results always visible.
129. **Photo dump channel** – drop pictures, they become a masonry grid with albums.
130. **Bulletin channel** – one editable message at the top that everyone can edit.
131. **Leaderboard channel** – shows numbers from bot variables as a ranked list.
132. **Countdown banners** on any channel.
133. **Channel emoji** shown in the list instead of the # icon.
134. **Private channels** only some roles can see (with the role permissions idea).
135. **Archived channels** – read-only and folded away at the bottom.
136. **Channel templates** – save a channel's setup (topic, slowmode, bots) and reuse it.
137. **Linked channels** – mirror one channel between two servers.

## Calendar, music, wiki (building on what's there)
138. ★ **Event reminders** – a ping 15 minutes before events you said Going to.
139. **Repeating events** (weekly game night).
140. **Export the calendar** as an .ics link for phone calendars.
141. **Music: vote to skip** instead of anyone skipping.
142. **Music: playlists** saved and loaded into the queue.
143. **Music: lyrics** panel for the playing song (if a lyrics source is configured).
144. **Wiki: page tree** with pages inside pages.
145. **Wiki: table of contents** from the headings.
146. **Wiki: compare versions** side by side.
147. **Wiki: templates** for new pages (meeting notes, game guide).

## Bots and automation
148. ★ **Bot marketplace** inside Opencord – share a bot's blocks as a code others can import.
149. **Per-user variables** (`{uservar.coins}`) for economy and level bots.
150. **Leaderboard block** – top N users by a per-user variable.
151. **"When a message is edited/deleted"** triggers for logging bots.
152. **"Every day at 09:00"** triggers with a time picker.
153. **Wait until a time** block.
154. **Ask the user a question** block that waits for their reply.
155. **Bot debug console** showing each step as it runs.
156. **Embeds from bots** – title, colour, fields, image.
157. **Select menus** on bot messages (dropdowns) alongside buttons.
158. **Bot permissions per channel** – which channels a bot may talk in.
159. **Rate-limit block** – "only once per user per hour".
160. **AI reply block** using a server-owner-provided API key.

## Server management
161. ★ **Moderation queue** – reported messages land in one admin-only list.
162. **Report message** for everyone, with a reason.
163. **Raid protection** – pause invites automatically when many people join at once.
164. **Join verification** – new members click a button in #rules to get access.
165. **Ban list import/export** between servers.
166. **Mod notes** on members, visible only to admins.
167. **Temporary roles** that expire (e.g. "Event winner" for a week).
168. **Role colours with gradients**.
169. **Server insights** – active members per day, messages per channel.
170. **Backups** – download a server's channels, roles and settings as JSON, restore into a new server.
171. **Audit log filters** by person and action.
172. **Server folders** in the rail (drag servers together).

## Profiles and social
173. ★ **Friends activity** – what your friends are playing or listening to, on the Friends page.
174. **Profile music** – a song on your profile.
175. **Profile links** (GitHub, website, socials) with icons.
176. **Per-server nicknames** and per-server avatars.
177. **Shared servers and mutual friends** list on profiles.
178. **Notes on users** only you can see.
179. **Status scheduling** – "Do not disturb until 17:00".
180. **Profile effects** – a subtle animated border for your avatar.

## Look and feel
181. ★ **Theme marketplace** – share and install themes made with the colour picker.
182. **Seasonal themes** that switch by date.
183. **Chat bubbles layout** option (like a phone messenger).
184. **Message grouping window** setting (how long until a new header shows).
185. **Split view** – two channels side by side on wide screens.
186. **Pop-out chat** window for a channel.
187. **Keyboard shortcuts page** and a command palette (Ctrl+K).
188. **Emoji skin tone** preference.

## Phones and platform
189. ★ **Offline queue** – messages typed offline send when back online.
190. **Share to Opencord** from the phone share sheet (PWA share target).
191. **Haptics** on long-press and swipes.
192. **Lite mode** – no previews, smaller images, for slow connections.
193. **Image compression** before upload on phones (with an "original" option).
194. **Multi-account** switching.
195. **Desktop app** wrapper with tray icon and global push-to-talk.

## Safety and trust
196. **Two-factor login** with an authenticator app.
197. **Active sessions list** – see and log out other devices.
198. **Login alerts** – a DM from Opencord when a new device logs in.
199. **Content filters** – blur images from people you don't know.
200. **Server age gates** for channels marked 18+.
