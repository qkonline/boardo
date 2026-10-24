// The emoji picker's groups (EmojiPicker.svelte), the ones a work chat reaches for first in
// each. Emoji from before 2022 only, so every phone in use shows them. Nothing orange.

export interface EmojiGroup {
  id: string;
  name: string;
  list: string[];
}

const g = (id: string, name: string, s: string): EmojiGroup => ({ id, name, list: s.trim().split(/\s+/) });

export const EMOJI_GROUPS: EmojiGroup[] = [
  g(
    'smileys',
    'Smileys',
    `😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐
     😑 😶 🙄 😏 😬 😌 😔 😪 😴 😷 🤒 🤕 🤧 🥵 🥶 🤯 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧
     😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😠 😡 🤬 💀 🤡 👻 👽 🤖 💩`,
  ),
  g(
    'people',
    'People',
    `👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 👀
     👁️ 🧠 🙋 🙆 🙅 🤷 🤦 🙇 💁 🧑‍💻 🧑‍🎨 🧑‍🏫 🧑‍🔧 🧑‍💼 🧑‍🍳 🏃 🚶 🧘 👶 👪`,
  ),
  g(
    'signs',
    'Hearts and signs',
    `❤️ 💛 💚 💙 💜 🤎 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 ✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ❓ ❔ ❗ ❕ ‼️ ⁉️
     ⚠️ 🚫 ⛔ 💯 🔴 🟡 🟢 🔵 🟣 ⚫ ⚪ 🔺 🔻 ⭐ 🌟 ✨ ⚡ 💥 🔥 💤 💬 💭 🗯️ ♻️ 🆕 🆗 🆙 🔝 🔜 🔁`,
  ),
  g(
    'work',
    'Work',
    `📌 📍 📎 🖇️ 📝 ✏️ 🖊️ 📋 📁 📂 🗂️ 📄 📃 📑 📊 📈 📉 🗒️ 🗓️ 📅 📆 ⏰ ⏱️ ⏳ ⌛ 💼 🖥️ 💻 ⌨️ 🖱️
     📱 ☎️ 📞 📧 ✉️ 📨 📬 📦 🏷️ 🔖 🔗 🔒 🔓 🔑 🔍 🔎 💡 🔦 🧰 🔧 🔨 🛠️ ⚙️ 🧪 🧲 📣 📢 🔔 🔕 💰
     💵 💳 🧾 🏆 🥇 🎯 🧩 🎨 🖌️ 📷 🎥 🎬 🎤 🎧 📚 📖 🎓`,
  ),
  g('party', 'Celebrate', `🎉 🎊 🥳 🎈 🎁 🎂 🍰 🧁 🥂 🍾 🏅 🎖️ 🏁 🚩 🎆 🎇 🎀 🪅 💐 🕯️`),
  g(
    'food',
    'Food',
    `☕ 🍵 🧃 🥤 🧋 🍕 🍔 🍟 🌮 🌯 🥗 🍜 🍝 🍣 🍱 🍛 🍚 🍩 🍪 🍫 🍿 🍎 🍌 🍇 🍓 🍉 🥑 🥐 🍞 🧀
     🥚 🍳 🥞 🍦`,
  ),
  g(
    'nature',
    'Nature',
    `☀️ 🌤️ ⛅ 🌧️ ⛈️ 🌩️ ❄️ ☃️ 🌈 🌙 🌍 🌱 🌿 🍀 🌵 🌳 🌲 🌸 🌻 🌹 🌷 🍁 🍂 🐶 🐱 🐭 🐻 🐼 🐨 🦁
     🐯 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦉 🦋 🐝 🐢 🐍 🐙 🐬 🐳 🦄`,
  ),
  g(
    'travel',
    'Travel',
    `🚀 ✈️ 🚗 🚕 🚌 🚲 🛵 🚆 🚢 ⛵ 🏠 🏡 🏢 🏫 🏥 🏦 🏨 🏪 🗺️ 🧭 🏖️ 🏔️ 🗽 🕌 🕋 ⛪ 🌉 🌃 🎡 ⛺`,
  ),
];

const RECENT_KEY = 'boardo:emoji-recent';
const RECENT_MAX = 16;

/** The emoji picked most recently on this device, newest first. */
export function recentEmoji(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function noteEmoji(e: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmoji().filter((x) => x !== e)].slice(0, RECENT_MAX)));
  } catch {
    /* private mode */
  }
}
