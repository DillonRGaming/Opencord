import { state } from './store.js';

// Emoji for the picker and :name: autocomplete. Each category is "emoji name name2,emoji name,…";
// the first name is the main one, the rest are extra search words.
const RAW = {
  People: '😀 grinning,😃 smiley,😄 smile happy,😁 grin,😆 laughing,😅 sweat_smile,🤣 rofl,😂 joy lol,🙂 slight_smile,🙃 upside_down,😉 wink,😊 blush,😇 innocent angel,🥰 smiling_hearts love,😍 heart_eyes,🤩 star_struck,😘 kiss,😗 kissing,😚 kissing_closed_eyes,😋 yum,😛 tongue,😜 wink_tongue,🤪 zany crazy,😝 squint_tongue,🤑 money_mouth,🤗 hug,🤭 hand_over_mouth,🤫 shush,🤔 thinking hmm,🤐 zipper_mouth,🤨 raised_eyebrow,😐 neutral,😑 expressionless,😶 no_mouth,😏 smirk,😒 unamused,🙄 eye_roll,😬 grimace,🤥 lying,😌 relieved,😔 pensive,😪 sleepy,🤤 drool,😴 sleeping,😷 mask,🤒 sick,🤕 hurt,🤢 nauseated,🤮 vomit,🤧 sneeze,🥵 hot,🥶 cold,🥴 woozy,😵 dizzy,🤯 mind_blown exploding,🤠 cowboy,🥳 party,😎 sunglasses cool,🤓 nerd,🧐 monocle,😕 confused,😟 worried,🙁 slight_frown,☹️ frown,😮 open_mouth wow,😯 hushed,😲 astonished,😳 flushed,🥺 pleading puppy,😦 frowning,😧 anguished,😨 fearful,😰 anxious,😥 sad_relieved,😢 cry,😭 sob,😱 scream,😖 confounded,😣 persevere,😞 disappointed,😓 sweat,😩 weary,😫 tired,🥱 yawn,😤 triumph huff,😡 rage angry,😠 angry,🤬 cursing,😈 smiling_imp devil,👿 imp,💀 skull dead,☠️ skull_crossbones,💩 poop,🤡 clown,👹 ogre,👺 goblin,👻 ghost,👽 alien,👾 space_invader,🤖 robot,😺 smiley_cat,😸 smile_cat,😹 joy_cat,😻 heart_eyes_cat,🙈 see_no_evil,🙉 hear_no_evil,🙊 speak_no_evil,🫠 melting,🫡 salute,🫣 peeking,🫢 gasp,🥲 smiling_tear,🫥 dotted_face,😮‍💨 exhale,🤝 handshake,👋 wave hello,🤚 raised_back_of_hand,✋ raised_hand high_five,🖐️ hand_splayed,🖖 vulcan,👌 ok_hand,🤌 pinched_fingers,🤏 pinching,✌️ v peace,🤞 crossed_fingers luck,🤟 love_you,🤘 metal rock,🤙 call_me,👈 point_left,👉 point_right,👆 point_up,👇 point_down,☝️ index_up,👍 thumbsup +1 yes,👎 thumbsdown -1 no,✊ fist,👊 punch,🤛 left_fist,🤜 right_fist,👏 clap,🙌 raised_hands hooray,👐 open_hands,🤲 palms_up,🙏 pray please thanks,✍️ writing,💅 nail_care,💪 muscle strong,🧠 brain,👀 eyes look,👁️ eye,👅 tongue_out,👄 lips,💋 kiss_mark,👶 baby,🧒 child,👦 boy,👧 girl,🧑 person,👨 man,👩 woman,🧓 older_person,👴 old_man,👵 old_woman,🙋 raising_hand,🙇 bow,🤦 facepalm,🤷 shrug,🧑‍💻 technologist coder,🕺 dancer,💃 dancing,🏃 running,🚶 walking',
  Nature: '🐶 dog,🐱 cat,🐭 mouse,🐹 hamster,🐰 rabbit bunny,🦊 fox,🐻 bear,🐼 panda,🐨 koala,🐯 tiger,🦁 lion,🐮 cow,🐷 pig,🐸 frog,🐵 monkey,🐔 chicken,🐧 penguin,🐦 bird,🐤 chick,🦆 duck,🦅 eagle,🦉 owl,🦇 bat,🐺 wolf,🐗 boar,🐴 horse,🦄 unicorn,🐝 bee,🐛 bug,🦋 butterfly,🐌 snail,🐞 ladybug,🐜 ant,🕷️ spider,🐢 turtle,🐍 snake,🦎 lizard,🦖 trex dinosaur,🐙 octopus,🦑 squid,🦐 shrimp,🦀 crab,🐡 blowfish,🐠 tropical_fish,🐟 fish,🐬 dolphin,🐳 whale,🦈 shark,🐊 crocodile,🐘 elephant,🦒 giraffe,🦘 kangaroo,🐑 sheep,🐐 goat,🦌 deer,🐕 dog2,🐈 cat2,🐿️ chipmunk,🦔 hedgehog,🌵 cactus,🎄 christmas_tree,🌲 evergreen,🌳 tree,🌴 palm,🌱 seedling,🌿 herb,☘️ shamrock,🍀 four_leaf_clover luck,🍁 maple_leaf,🍂 fallen_leaf,🍄 mushroom,💐 bouquet,🌹 rose,🌺 hibiscus,🌸 cherry_blossom,🌼 blossom,🌻 sunflower,🌞 sun_face,🌝 full_moon_face,🌚 new_moon_face,🌙 crescent_moon,⭐ star,🌟 star2 glowing,✨ sparkles,⚡ zap lightning,🔥 fire lit,💥 boom,☄️ comet,☀️ sunny,🌤️ partly_sunny,⛅ cloudy,🌧️ rain,⛈️ storm,❄️ snowflake,☃️ snowman,🌈 rainbow,🌊 wave ocean,💧 droplet,☔ umbrella,🌍 earth,🪐 planet',
  Food: '🍏 green_apple,🍎 apple,🍐 pear,🍊 orange,🍋 lemon,🍌 banana,🍉 watermelon,🍇 grapes,🍓 strawberry,🫐 blueberries,🍈 melon,🍒 cherries,🍑 peach,🥭 mango,🍍 pineapple,🥥 coconut,🥝 kiwi,🍅 tomato,🍆 eggplant,🥑 avocado,🥦 broccoli,🥬 leafy_green,🥒 cucumber,🌶️ hot_pepper,🌽 corn,🥕 carrot,🧄 garlic,🧅 onion,🥔 potato,🥐 croissant,🍞 bread,🥖 baguette,🧀 cheese,🥚 egg,🍳 cooking,🥞 pancakes,🧇 waffle,🥓 bacon,🥩 steak,🍗 chicken_leg,🍖 meat,🌭 hotdog,🍔 burger hamburger,🍟 fries,🍕 pizza,🥪 sandwich,🌮 taco,🌯 burrito,🥗 salad,🍝 spaghetti pasta,🍜 ramen noodles,🍲 stew,🍛 curry,🍣 sushi,🍱 bento,🥟 dumpling,🍤 fried_shrimp,🍙 rice_ball,🍚 rice,🍦 ice_cream,🍩 doughnut donut,🍪 cookie,🎂 birthday_cake,🍰 cake,🧁 cupcake,🥧 pie,🍫 chocolate,🍬 candy,🍭 lollipop,🍿 popcorn,☕ coffee,🍵 tea,🧃 juice_box,🥤 cup_with_straw soda,🧋 bubble_tea boba,🍺 beer,🍻 beers cheers,🥂 champagne_glasses,🍷 wine,🥃 whisky,🍸 cocktail,🍹 tropical_drink,🧊 ice,🥛 milk,🍯 honey,🧂 salt',
  Activities: '⚽ soccer football,🏀 basketball,🏈 american_football,⚾ baseball,🎾 tennis,🏐 volleyball,🏉 rugby,🎱 8ball pool,🏓 ping_pong,🏸 badminton,🥅 goal,⛳ golf,🏹 bow_and_arrow,🎣 fishing,🥊 boxing,🥋 martial_arts,⛸️ ice_skate,🎿 ski,🛹 skateboard,🏂 snowboarder,🏋️ weightlifting,🚴 cycling,🏆 trophy win,🥇 first_place gold,🥈 second_place,🥉 third_place,🏅 medal,🎖️ military_medal,🎫 ticket,🎪 circus,🎭 theater,🎨 art palette,🎬 clapper film,🎤 microphone sing,🎧 headphones music,🎼 score,🎹 piano,🥁 drum,🎷 saxophone,🎺 trumpet,🎸 guitar,🎻 violin,🎲 game_die dice,♟️ chess,🎯 dart bullseye,🎳 bowling,🎮 video_game controller gaming,🕹️ joystick,🧩 puzzle,🎰 slot_machine,🎉 tada party celebrate,🎊 confetti,🎈 balloon,🎁 gift present,🎀 ribbon,🪅 pinata,🎆 fireworks,🎇 sparkler,🧨 firecracker,🎃 jack_o_lantern halloween,🎄 xmas',
  Travel: '🚗 car,🚕 taxi,🚙 suv,🚌 bus,🏎️ race_car,🚓 police_car,🚑 ambulance,🚒 fire_engine,🚚 truck,🚜 tractor,🛵 scooter,🏍️ motorcycle,🚲 bike,🛴 kick_scooter,🚨 rotating_light siren,🚥 traffic_light,🚧 construction,⚓ anchor,⛵ sailboat,🚤 speedboat,🛳️ cruise_ship,🚢 ship,✈️ airplane,🛫 departure,🛬 arrival,🚁 helicopter,🚀 rocket launch,🛸 ufo,🛰️ satellite,🗺️ map,🗽 statue_of_liberty,🗼 tokyo_tower,🏰 castle,🎡 ferris_wheel,🎢 roller_coaster,⛲ fountain,🏖️ beach,🏝️ island,🏜️ desert,🌋 volcano,⛰️ mountain,🏔️ snow_mountain,🏕️ camping,⛺ tent,🏠 house home,🏡 house_garden,🏢 office,🏥 hospital,🏦 bank,🏨 hotel,🏪 store,🏫 school,⛪ church,🌃 night_city,🌆 city_dusk,🌇 sunset,🌉 bridge_night,🌌 milky_way',
  Objects: '⌚ watch,📱 phone mobile,💻 laptop computer,⌨️ keyboard,🖥️ desktop,🖨️ printer,🖱️ mouse_computer,💾 floppy_disk save,💿 cd,📷 camera,📸 camera_flash,📹 video_camera,🎥 movie_camera,📺 tv,📻 radio,🎙️ studio_microphone,⏰ alarm_clock,⏳ hourglass,📡 satellite_dish,🔋 battery,🔌 plug,💡 bulb idea,🔦 flashlight,🕯️ candle,🧯 extinguisher,💸 money_wings,💵 dollar,💰 moneybag,💳 credit_card,💎 gem diamond,🔧 wrench,🔨 hammer,🛠️ tools,⚙️ gear,🔩 nut_and_bolt,🧲 magnet,🔫 water_gun,💣 bomb,🔪 knife,🗡️ dagger,⚔️ swords,🛡️ shield,🔮 crystal_ball,🧿 nazar,💊 pill,💉 syringe,🧬 dna,🔬 microscope,🔭 telescope,🧹 broom,🧺 basket,🧻 toilet_paper,🚽 toilet,🛁 bathtub,🔑 key,🗝️ old_key,🚪 door,🛋️ couch,🛏️ bed,🧸 teddy_bear,🖼️ frame_picture,🛒 shopping_cart,🎒 backpack,👓 glasses,🕶️ dark_sunglasses,👔 necktie,👕 shirt,👖 jeans,👗 dress,👟 sneaker,👠 high_heel,👑 crown king,🎩 tophat,🧢 cap,📦 package box,📫 mailbox,✉️ envelope,📧 email,📝 memo note,📄 page,📅 calendar,📌 pushpin,📎 paperclip,✂️ scissors,🖊️ pen,✏️ pencil,🔍 mag search,🔒 lock,🔓 unlock,📚 books,📖 book,🔖 bookmark,🏷️ label,💼 briefcase',
  Symbols: '❤️ heart love red_heart,🧡 orange_heart,💛 yellow_heart,💚 green_heart,💙 blue_heart,💜 purple_heart,🖤 black_heart,🤍 white_heart,🤎 brown_heart,💔 broken_heart,❣️ heart_exclamation,💕 two_hearts,💞 revolving_hearts,💓 heartbeat,💗 heartpulse,💖 sparkling_heart,💘 cupid,💝 gift_heart,💟 heart_decoration,☮️ peace_symbol,✝️ cross,☯️ yin_yang,♈ aries,♻️ recycle,⚜️ fleur_de_lis,🔱 trident,📛 name_badge,⭕ o circle,✅ white_check_mark check done,☑️ ballot_box_check,✔️ heavy_check_mark,❌ x cross_mark no,❎ negative_squared_cross,➕ plus,➖ minus,➗ divide,✖️ multiply,♾️ infinity,‼️ bangbang,⁉️ interrobang,❓ question,❔ grey_question,❕ grey_exclamation,❗ exclamation,〰️ wavy_dash,💯 100 hundred,🔞 underage,📵 no_phones,🚫 no_entry_sign forbidden,⛔ no_entry,🆗 ok,🆕 new,🆒 cool_button,🆓 free,🆙 up,🆘 sos,🔝 top,🔜 soon,🔙 back,🔚 end,💤 zzz sleep,💢 anger,💬 speech_balloon,💭 thought_balloon,🗯️ anger_bubble,♠️ spades,♥️ hearts,♦️ diamonds,♣️ clubs,🃏 joker,🔇 mute,🔈 speaker,🔉 sound,🔊 loud_sound,🔔 bell,🔕 no_bell,🎵 musical_note,🎶 notes,⚠️ warning,🚸 children_crossing,⬆️ arrow_up,⬇️ arrow_down,⬅️ arrow_left,➡️ arrow_right,↩️ leftwards_arrow,🔄 arrows_counterclockwise,🔀 twisted_arrows shuffle,🔁 repeat,▶️ play,⏸️ pause,⏹️ stop,⏺️ record,⏭️ next_track,⏮️ previous_track,🔴 red_circle,🟠 orange_circle,🟡 yellow_circle,🟢 green_circle,🔵 blue_circle,🟣 purple_circle,⚫ black_circle,⚪ white_circle,🟥 red_square,🟩 green_square,🟦 blue_square,⬛ black_square,⬜ white_square,🔺 red_triangle,🔷 large_blue_diamond,#️⃣ hash_key,🆔 id,🏳️ white_flag,🏴 black_flag,🏁 checkered_flag finish,🚩 triangular_flag,🏳️‍🌈 rainbow_flag pride',
};

export const CATEGORIES = Object.keys(RAW);

export const EMOJI = Object.entries(RAW).flatMap(([category, list]) => list.split(',').map((entry) => {
  const [char, ...names] = entry.trim().split(' ');
  return { char, name: names[0], keywords: names, category };
}));

const byName = new Map(EMOJI.flatMap((e) => e.keywords.map((k) => [k, e.char])));

export function emojiByName(name) {
  return byName.get(name.toLowerCase()) || null;
}

export function searchEmoji(query, limit = 40) {
  const q = query.toLowerCase();
  const starts = [];
  const contains = [];
  for (const emoji of EMOJI) {
    if (emoji.keywords.some((k) => k.startsWith(q))) starts.push(emoji);
    else if (emoji.keywords.some((k) => k.includes(q))) contains.push(emoji);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

// Recently used, newest first; kept in this browser only, per account.
const recentKey = () => `oc_recent_emoji:${state.me?.id || ''}`;
export function recentEmoji() {
  try { return JSON.parse(localStorage.getItem(recentKey()) || '[]'); } catch { return []; }
}

export function rememberEmoji(value) {
  try {
    const list = [value, ...recentEmoji().filter((e) => e !== value)].slice(0, 24);
    localStorage.setItem(recentKey(), JSON.stringify(list));
  } catch { /* private mode */ }
}
