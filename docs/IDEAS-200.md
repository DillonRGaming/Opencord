# 200 more ideas for Opencord

New ones, on top of [IDEAS.md](../IDEAS.md). ★ = cheap to build on what's already here and people would notice.

## Message box (1–20)
1. ★ Server stickers: bigger custom images sent on their own, with a sticker tab in the picker.
2. ★ Animated custom emoji (GIF/WebP) that only animate on hover when "reduce motion" is on.
3. Inline formatting toolbar when you select text in the box (bold, italic, code, spoiler, link).
4. Live Markdown preview in the box: **bold** looks bold while you type.
5. Mentions drawn as pills in the box, like custom emoji now are.
6. `#channel` pills in the box too, with the channel's icon.
7. ★ Scheduled send: hold Send for "send later" with a time picker.
8. Silent send (no notifications) toggle, like `@silent`.
9. Draft indicator on channels in the sidebar where you left unsent text.
10. Paste a table from a spreadsheet → turns into a Markdown table.
11. Paste a long text (> 2,000 chars) → offered as a `.txt` attachment instead.
12. ★ Ctrl+K inside the box to wrap selected text in a link.
13. Quick reactions bar for the last message: press `+` then a number.
14. Emoji autocomplete ranks your most-used ones first.
15. `:)` / `<3` / `:D` auto-convert to emoji (setting).
16. Typo-fix suggestions with a squiggly line (uses the browser's spellcheck, plus a "learn word").
17. Templates: save snippets and insert them with `;name`.
18. Voice-to-text dictation button.
19. Drag a message from the list into the box to quote it.
20. Character counter shows remaining words for posts, not just chars.

## Messages (21–45)
21. ★ Edit history: "edited" opens a diff of past versions.
22. Forward a message to another channel or DM, with a "forwarded from" card.
23. Bookmark messages to a private "Saved" list.
24. ★ "Remind me about this" on any message (in 1h, tonight, tomorrow).
25. Mark as unread from here.
26. Message translation button using the existing translate module.
27. Read receipts in DMs (opt-in on both sides).
28. Super reactions: a bigger burst animation, a few per day.
29. Reaction "who reacted" list grouped by emoji with avatars.
30. Collapse long messages with "Show more".
31. Code blocks: copy button, line numbers, and "open in playground".
32. Link previews for GitHub repos/issues, Spotify, YouTube with timestamps.
33. Math (`$x^2$`) rendering with KaTeX.
34. Mermaid diagrams in code blocks.
35. Spoiler images (blurred until clicked).
36. ★ Jump to the first unread message with a bar at the top.
37. Message search filters: `from:` `in:` `has:image` `before:` `after:` `mentions:`.
38. Self-destructing messages in DMs (gone after 1h/1d).
39. Pin a message for yourself only ("sticky note").
40. "Thread summary" button (AI) on long threads.
41. Inline replies show a jump-back arrow after jumping to the original.
42. Voice message waveform + playback speed (1×/1.5×/2×).
43. Image attachments: alt text field, shown to screen readers.
44. Group consecutive images into a grid.
45. Message "quote card": share a message as a nice image.

## Channels (46–70)
46. ★ Channel categories you can collapse, with their own permissions.
47. Private threads (only invited people).
48. Forum channel with required tags.
49. Media-only channel that hides text replies under each item.
50. Counting channel (bot checks each number goes up by one).
51. One-word-story channel.
52. Daily question channel: posts a new question every morning.
53. Confessions channel: anonymous posts, mods can still see who.
54. Suggestions channel with up/down votes and status (planned, done, declined).
55. Bug report channel with a form (steps, expected, actual).
56. Starboard channel: messages with ⭐×5 get copied there.
57. Welcome channel with a card for every new member.
58. Rules channel with an "I agree" button that unlocks the server.
59. Logs channel (joins, leaves, deletes, edits) for mods.
60. Clip channel: short video uploads with autoplay muted.
61. Photo-of-the-day channel with a weekly vote.
62. Book club channel: current book, chapter progress per member, spoiler rules.
63. Study room: voice + Pomodoro timer everyone shares.
64. Lo-fi radio voice channel that always plays something.
65. Trading channel: post items, offers, mark as traded.
66. LFG (looking for group) channel: game, slots, start time, join button.
67. Channel emoji/icons instead of just `#`.
68. ★ Channel banners and accent colours.
69. Per-channel notification sound.
70. Temporary channels that delete themselves after N days of silence.

## Servers (71–100)
71. ★ Server discovery page with tags and search (opt-in).
72. Server templates: start from Gaming, Study, Friends, Community.
73. Export/import a server's structure as JSON.
74. Server boosts → but free: unlock perks by member activity instead of money.
75. Server levels/XP with role rewards.
76. Onboarding questions that give roles ("what games do you play?").
77. Server-wide events list on the home screen.
78. Vanity invite links (`/i/myserver`).
79. Invite tracking: who invited whom, leaderboard.
80. Server insights: messages per day, busiest hours, top channels (extends the stats page).
81. Member join screening (account age, captcha-free questions).
82. Server folders in the rail with a name and colour.
83. Server-specific nickname and avatar.
84. Server themes: admins pick an accent everyone sees inside it.
85. Server soundboard shared across voice channels.
86. Server sticker packs others can add.
87. Audit log filters and export.
88. Backup of the whole server (messages + files) as a zip.
89. Mod notes on members, visible to mods only.
90. Warning system with auto-timeout after 3 warns.
91. Automod: word filters, link filters, mention spam, caps spam.
92. Raid mode: lock invites and slow everything for 10 minutes.
93. Role colours with gradients.
94. Role icons next to names.
95. Self-assignable roles via reaction or button menu.
96. Temporary roles (expire after a date).
97. Server shop: spend XP on cosmetic roles.
98. Member list grouped by custom role "hoist" sections.
99. ★ Server-wide announcement banner at the top of every channel.
100. Archive a server (read-only) instead of deleting it.

## Bot commands (101–140)
101. ★ `/remind me in 2h to …`
102. `/poll` with timed end and anonymous mode.
103. `/roll 2d20+3` dice.
104. `/8ball`.
105. `/coinflip`.
106. `/choose pizza, tacos, sushi`.
107. `/weather <city>`.
108. `/define <word>`.
109. `/wiki <topic>` summary.
110. `/translate <lang> <text>`.
111. `/calc 2^10 * 3`.
112. `/convert 10 km to mi`.
113. `/time <city>` world clock.
114. `/afk <reason>`: auto-reply when mentioned.
115. ★ `/giveaway <prize> <duration>` with a join button and random winner.
116. `/rank` and `/leaderboard` for XP.
117. `/avatar @user` big view.
118. `/userinfo` and `/serverinfo`.
119. `/snipe` last deleted message (mods only, opt-in).
120. `/quote` random saved quote; `/quote add`.
121. `/tag <name>` saved answers for FAQs.
122. `/todo add|list|done`.
123. `/countdown <date>`.
124. `/birthday set` + birthday shout-outs.
125. `/trivia` with categories and scores.
126. `/wordle` daily, shared results.
127. `/hangman`.
128. `/connect4` (alongside chess and tic-tac-toe).
129. `/blackjack` with fake chips.
130. `/fish` idle fishing mini-game.
131. `/pet` a server pet everyone feeds.
132. `/meme` from a server's own image folder.
133. `/ship @a @b` compatibility %.
134. `/ascii <text>` big letters.
135. `/color #ff8800` swatch.
136. `/qr <link>`.
137. `/shorten <link>`.
138. `/purge @user 50` delete someone's recent messages.
139. `/lockdown` all channels at once.
140. `/announce #channel` with a preview first.

## Voice and video (141–155)
141. ★ Noise suppression toggle.
142. Push-to-talk with a key you pick.
143. Per-person volume sliders.
144. Screen share with audio.
145. Picture-in-picture for video calls.
146. Voice activity ring on avatars in the member list.
147. Recording (with everyone's consent shown).
148. Live captions.
149. Raise hand in voice.
150. Voice channel user limit.
151. "Join muted" setting.
152. Soundboard hotkeys.
153. Watch together inside a voice call.
154. Spatial audio in a 2D room map.
155. Call history in DMs.

## Profiles and social (156–175)
156. ★ Profile banners and bio Markdown.
157. Profile themes (two-colour gradient).
158. Pronouns field.
159. Custom status with emoji and expiry.
160. "Now playing" from Spotify/last.fm.
161. Profile badges (early user, bug hunter, server owner).
162. Mutual servers and friends on profile cards.
163. Friend nicknames only you see.
164. Close friends list for statuses.
165. Profile guestbook.
166. Activity heatmap on the profile (from stats).
167. Streaks for daily chatting with a friend.
168. Friend suggestions from mutual servers.
169. Block list with "hide their messages entirely".
170. Ignore (softer than block: just collapse messages).
171. Notes on users only you see.
172. Birthday on profile with a cake on the day.
173. Time zone on profile and local time shown.
174. Link accounts (GitHub, Steam, website) with verification.
175. Profile effects (sparkles, snow) for fun.

## App and quality of life (176–200)
176. ★ Command palette (Ctrl+K) for jumping to any channel, DM or setting.
177. Keyboard shortcuts sheet (`?`).
178. Unread-only view in the sidebar.
179. ★ Desktop notifications with reply-from-notification.
180. Do-not-disturb schedule.
181. Mention inbox with filters.
182. Compact mode and cozy mode.
183. Font size and line-height sliders.
184. Custom CSS (power users).
185. High-contrast and dyslexia-friendly font themes.
186. Installable PWA with offline cache of recent messages.
187. Mobile swipe gestures to reply/react.
188. Multi-account switcher.
189. Data export of your own account.
190. Two-factor auth (TOTP).
191. Session list with "sign out other devices".
192. End-to-end encrypted DMs (opt-in).
193. Webhooks in and out (GitHub, RSS feeds into a channel).
194. RSS/YouTube/Twitch follow → posts into a channel.
195. Public read-only web view of chosen channels.
196. Seasonal themes (winter snow, spooky October).
197. Easter eggs: Konami code → confetti.
198. Achievements for using features ("first poll", "100 reactions").
199. "What's new" changelog popup after updates.
200. ★ Year-in-review page: your top emoji, channels, friends and busiest day.
