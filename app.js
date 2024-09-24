const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const session = require("express-session");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const cron = require("node-cron");

// create id with crypto
const crypto = require("crypto");
const generateId = () => crypto.randomBytes(16).toString("hex");

const loadUsers = () => {
  try {
    const dataBuffer = fs.readFileSync("data.json");
    return JSON.parse(dataBuffer);
  } catch (err) {
    return [];
  }
};

const updateUserSession = (phoneNumber) => {
  const users = loadUsers();
  const user = users.find((user) => user.from === phoneNumber);

  if (user) {
    user.session = { isLoggedIn: true }; // Simpan sesi pengguna
    saveUsers(users); // Simpan kembali ke data.json
  }
};

const saveUsers = (users) => {
  fs.writeFileSync("data.json", JSON.stringify(users, null, 2));
};

function getAllReminders(users) {
  const allReminders = [];

  for (const userId in users) {
    const user = users[userId];
    if (user.reminders && Array.isArray(user.reminders)) {
      user.reminders.forEach((reminder) => {
        allReminders.push({
          ...reminder,
          id: userId,
          phoneNumber: user.phoneNumber,
        });
      });
    }
  }

  return allReminders;
}

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  getUrlInfo,
  makeInMemoryStore,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const moment = require("moment-timezone");
moment.tz.setDefault("Asia/Jakarta").locale("id");

const store = makeInMemoryStore({
  logger: pino().child({ level: "silent", stream: "store" }),
});

const storeFilePath = "./baileys_store.json";

store?.readFromFile(storeFilePath);

setInterval(() => {
  store.writeToFile(storeFilePath);
}, 15_000);

const app = express();
const PORT = 3000;

// Enable CORS
app.use(cors());

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("trust proxy", 1);

app.use(
  session({
    secret: "secret",
    resave: true,
    saveUninitialized: true,
  })
);

// Load reminders from data.json
const loadReminders = (userId) => {
  const sessions = loadSessions(); // Load all sessions from session.json
  const userSession = sessions[userId];

  if (userSession && userSession.reminders) {
    return userSession.reminders;
  } else {
    return []; // Return an empty array if no reminders are found
  }
};

const loadSessions = () => {
  try {
    const dataBuffer = fs.readFileSync("session.json");
    return JSON.parse(dataBuffer);
  } catch (err) {
    return {};
  }
};

const findUser = (phoneNumber) => {
  let numberReplace = phoneNumber.replace(/\D/g, "");
  if (numberReplace.startsWith("08")) {
    numberReplace = "628" + numberReplace.slice(2);
  } else if (numberReplace.startsWith("8")) {
    numberReplace = "628" + numberReplace.slice(1);
  }

  const users = loadSessions();

  const user = Object.values(users).find(
    (user) => user.phoneNumber === numberReplace
  );

  return user;
};

// Save sessions to session.json
const saveSession = (sessions) => {
  fs.writeFileSync("session.json", JSON.stringify(sessions, null, 2));
};

// Save reminders to data.json
const saveReminders = (userId, reminders) => {
  const sessions = loadSessions(); // Load all sessions from session.json
  const userSession = sessions[userId];

  if (userSession) {
    userSession.reminders = reminders; // Update reminders for the current session
    saveSession(sessions); // Save the updated sessions back to session.json
  }
};

const start = async () => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(`./piyobot`);
    __path = process.cwd();

    const conn = makeWASocket({
      logger: pino({ level: "silent" }),
      printQRInTerminal: true,
      auth: state,
      generateHighQualityLinkPreview: true,
      qrTimeout: 30_000,
      getMessage: async (key) => {
        if (store) {
          const msg = await store.loadMessage(key.remoteJid, key.id);
          return msg?.message || undefined;
        }
        return {
          conversation: "hello",
        };
      },
      printQRInTerminal: true,
    });

    conn.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close") {
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut
          ? start()
          : console.log("Koneksi Terputus...");
      } else if (connection === "connecting") {
        console.log("Menghubungkan...");
      } else if (connection === "open") {
        console.log("Terhubung...");
      }
    });

    conn.ev.on("messages.upsert", async (chatUpdate) => {
      try {
        m = chatUpdate;
        m = m.messages[0];
        if (!m.message) return;
        if (m.key.fromMe) return;
        const content = JSON.stringify(m.message);
        m.message =
          Object.keys(m.message)[0] === "ephemeralMessage"
            ? m.message.ephemeralMessage.message
            : m.message;
        let type = Object.keys(m.message);
        type =
          (!["senderKeyDistributionMessage", "messageContextInfo"].includes(
            type[0]
          ) &&
            type[0]) ||
          (type.length >= 3 && type[1] !== "messageContextInfo" && type[1]) ||
          type[type.length - 1] ||
          type[0];
        const from = m.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const botNumber = conn.user.id
          ? conn.user.id.split(":")[0] + "@s.whatsapp.net"
          : conn.user.id;
        const body =
          type === "conversation"
            ? m.message.conversation
            : type == "imageMessage"
            ? m.message.imageMessage.caption
            : type == "videoMessage"
            ? m.message.videoMessage.caption
            : type == "extendedTextMessage"
            ? m.message.extendedTextMessage.text
            : type == "buttonsResponseMessage"
            ? m.message.buttonsResponseMessage.selectedButtonId
            : type == "listResponseMessage"
            ? m.message.listResponseMessage.singleSelectReply.selectedRowId
            : type == "templateButtonReplyMessage"
            ? m.message.templateButtonReplyMessage.selectedId
            : type === "messageContextInfo"
            ? m.message.buttonsResponseMessage?.selectedButtonId ||
              m.message.listResponseMessage?.title ||
              m.text
            : "";
        const budo =
          type === "conversation" && m.message.conversation.startsWith("!")
            ? m.message.conversation
            : type == "imageMessage"
            ? m.message.imageMessage.caption
            : type == "videoMessage"
            ? m.message.videoMessage.caption
            : type == "extendedTextMessage"
            ? m.message.extendedTextMessage.text
            : type == "buttonsResponseMessage"
            ? m.message.buttonsResponseMessage.selectedButtonId
            : type == "listResponseMessage"
            ? m.message.listResponseMessage.singleSelectReply.selectedRowId
            : type == "templateButtonReplyMessage"
            ? m.message.templateButtonReplyMessage.selectedId
            : type === "messageContextInfo"
            ? m.message.buttonsResponseMessage?.selectedButtonId ||
              m.message.listResponseMessage?.title ||
              m.text
            : "";
        const sender = isGroup ? m.key.participant : m.key.remoteJid;
        const args = body.trim().split(/ +/).slice(1);
        const ownernumber = "6283878761652@s.whatsapp.net";
        const isOwner = from == ownernumber;
        const command = budo.slice(1).trim().split(/ +/).shift().toLowerCase();

        const q = args.join(" ");

        switch (command) {
          case "stop":
            if (args.length > 0) {
              const reminderId = q;
              const phoneNumber = sender.split("@")[0];

              const sessions = loadSessions();

              let userId;
              for (const key in sessions) {
                if (
                  sessions[key].phoneNumber === phoneNumber &&
                  sessions[key].reminders.some(
                    (reminder) => reminder.id === reminderId
                  )
                ) {
                  userId = key;
                  break;
                }
              }

              if (
                userId &&
                sessions[userId] &&
                sessions[userId].cronJobs &&
                sessions[userId].cronJobs[reminderId]
              ) {
                sessions[userId].reminders.find((item) => item.id === reminderId).intervalStop = true;
                conn.sendMessage(from, {
                  text: `Pengingat dengan ID ${reminderId} telah dihentikan.`,
                });
                saveSession(sessions)
              } else {
                conn.sendMessage(from, {
                  text: `Pengingat dengan ID ${reminderId} tidak ditemukan atau Anda tidak memiliki akses untuk menghentikannya.`,
                });
              }
            } else {
              conn.sendMessage(from, {
                text: `Silakan berikan ID pengingat yang ingin dihentikan.`,
              });
            }
            break;
        }
      } catch (err) {
        console.log(err.message);
      }
    });

    conn.ev.on("creds.update", saveCreds);

    store.bind(conn.ev);

    return conn;
  } catch (err) {
    process.exit(1);
  }
};

async function startApi() {
  const conn = await start();

  // Home Page
  app.get("/", (req, res) => {
    const userId = req.session.userId;
    const sessions = loadSessions();

    if (!sessions[userId] || !sessions[userId].isLoggedIn) {
      return res.redirect("/register");
    }

    const reminders = sessions[userId].reminders;

    if (reminders.length === 0) {
      return res.render("index", {
        reminders,
        message: "Belum ada pengingat. Silakan tambahkan pengingat baru!",
      });
    }

    res.render("index", { reminders });
  });

  app.get("/register", (req, res) => {
    res.render("register");
  });

  app.get("/login", (req, res) => {
    res.render("login");
  });

  app.post("/send-verification", async (req, res) => {
    const { waNumber } = req.body;

    const userGet = findUser(waNumber);

    const token = userGet?.verificationToken;

    if (!token) {
      return res.status(400).jsonp({
        status: "error",
        message: "Nomor telepon tidak terdaftar atau belum terverifikasi.",
      });
    }

    const userId = userGet.userId;

    const verificationLink = `https://piyostore.my.id/verifylogin?token=${token}&userId=${userId}`;

    const linkPreview = await getUrlInfo(verificationLink, {
      thumbnailWidth: 1024,
      fetchOpts: {
        timeout: 5000,
      },
    });

    conn.sendMessage(userGet.phoneNumber + "@s.whatsapp.net", {
      text: `Klik link ini untuk verifikasi akun: \n${verificationLink}`,
      linkPreview,
    });

    res.jsonp({
      status: "success",
      message: "Verifikasi akun berhasil. Silakan login untuk melanjutkan.",
    });
  });

  app.get("/verifylogin", async (req, res) => {
    const { token, userId } = req.query;

    const sessions = loadSessions();
    const userSession = sessions[userId];

    if (!userId || !userSession) {
      return res.status(400).send("User ID tidak valid.");
    }

    if (userSession && userSession.verificationToken === token) {
      userSession.isLoggedIn = true;
      saveSession(sessions);

      req.session.userId = userId;

      res.redirect("/");
    } else {
      res
        .status(400)
        .send("Token verifikasi tidak valid atau sudah digunakan.");
    }
  });

  app.get("/verify", (req, res) => {
    const { token } = req.query;
    const userId = req.session.userId;

    const sessions = loadSessions();
    const userSession = sessions[userId];

    if (!userId || !userSession) {
      return res.status(400).send("User ID tidak valid.");
    }

    if (userSession && userSession.verificationToken === token) {
      userSession.isLoggedIn = true;
      saveSession(sessions);

      res.redirect("/");
    } else {
      res
        .status(400)
        .send("Token verifikasi tidak valid atau sudah digunakan.");
    }
  });

  app.post("/register", async (req, res) => {
    const { phoneNumber } = req.body;
    let numberReplace = phoneNumber.replace(/\D/g, "");
    if (numberReplace.startsWith("08")) {
      numberReplace = "628" + numberReplace.slice(2);
    } else if (numberReplace.startsWith("8")) {
      numberReplace = "628" + numberReplace.slice(1);
    }
    const sessions = loadSessions();

    const existingUser = Object.values(sessions).find(
      (user) => user.phoneNumber === numberReplace
    );

    if (existingUser) {
      return res.status(400).send("Nomor telepon sudah terdaftar.");
    }

    const userId = uuidv4();

    req.session.userId = userId;

    const verificationToken = generateId();
    sessions[userId] = {
      userId: userId,
      isLoggedIn: false,
      verificationToken: verificationToken,
      phoneNumber: numberReplace,
      reminders: [],
    };

    saveSession(sessions);

    const verificationLink = `https://piyostore.my.id/verify?token=${verificationToken}&userId=${userId}`;

    const linkPreview = await getUrlInfo(verificationLink, {
      thumbnailWidth: 1024,
      fetchOpts: {
        timeout: 5000,
      },
    });

    conn.sendMessage(numberReplace + "@s.whatsapp.net", {
      text: `Klik link ini untuk verifikasi akun: \n${verificationLink}`,
      linkPreview,
    });

    res.jsonp({
      status: "success",
      message: "Verifikasi akun berhasil. Silakan login untuk melanjutkan.",
    });
  });

  app.get("/add", (req, res) => {
    res.render("add-reminder");
  });

  app.get("/reminders", (req, res) => {
    const reminders = loadReminders(req.session.userId);
    res.jsonp(reminders);
  });

  async function sendReminder(reminder) {
    await conn.sendMessage(reminder.phoneNumber + "@s.whatsapp.net", {
      text: `Pengingat: ${reminder.title}\nTanggal : ${
        reminder.date || reminder.time || new Date()
      }${
        reminder.interval
          ? "\n\nUntuk stop pengingat, kirimkan perintah dibawah"
          : ""
      }`,
    });
    if (reminder.interval) {
      await conn.sendMessage(reminder.phoneNumber + "@s.whatsapp.net", {
        text: `!stop ${reminder.id}`,
      });
    }
  }

  app.post("/add", (req, res) => {
    const { title, date, time, interval, daysOfWeek } = req.body;
    const userId = req.session.userId;
    const sessions = loadSessions();

    if (!sessions[userId] || !sessions[userId].isLoggedIn) {
      return res
        .status(403)
        .send("Anda harus login untuk menambahkan pengingat.");
    }

    const newReminder = {
      title,
      date,
      time: time || null,
      interval: interval || null,
      days: daysOfWeek || [],
      id: generateId(),
      phoneNumber: sessions[userId].phoneNumber,
      intervalStop: false,
    };

    sessions[userId].reminders.push(newReminder);
    saveSession(sessions);

    if (!sessions[userId].cronJobs) {
      sessions[userId].cronJobs = {};
    }

    let cronJob;

    if (date && time) {
      const cronTime = `${time.split(":")[1]} ${time.split(":")[0]} ${
        date.split("-")[2]
      } ${date.split("-")[1]} *`;
      cronJob = cron.schedule(cronTime, () => {
        sendReminder(newReminder);
        cronJob.stop();
        sessions[userId].reminders = sessions[userId].reminders.filter(
          (reminder) => reminder.id !== newReminder.id
        );
        delete sessions[userId].cronJobs[newReminder.id];
        saveSession(sessions);
      });
      sessions[userId].cronJobs[newReminder.id] = cronJob;
    } else if (date && interval) {
      const [year, month, day] = date.split("-");
      const targetDate = new Date(year, month - 1, day);

      const now = new Date();

      // Ubah logika untuk membandingkan hanya tanggal, abaikan waktu
      const currentDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );

      if (targetDate >= currentDate) {
        const cronTime = `*/${interval} * * * *`;

        cronJob = cron.schedule(cronTime, () => {
          getNewSession = loadSessions();
          if (getNewSession[userId].reminders.find((item) => item.id === newReminder.id).intervalStop) {
            cronJob.stop()
            delete getNewSession[userId].cronJobs[newReminder.id];
            getNewSession[userId].reminders = getNewSession[userId].reminders.filter(
              (reminder) => reminder.id !== newReminder.id
            );
            getNewSession[userId].reminders.find((item) => item.id === newReminder.id).intervalStop = false;
            saveSession(getNewSession);
            return;
          }
          sendReminder(newReminder);
          saveSession(sessions);
        });

        sessions[userId].cronJobs[newReminder.id] = cronJob;

        // Hitung sisa waktu sampai akhir hari
        const endOfDay = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          23,
          59,
          59,
          999
        );
        const timeUntilEndOfDay = endOfDay - now;

        if (targetDate.getTime() === currentDate.getTime()) {
          getNewSession = loadSessions();

          setTimeout(() => {
            cronJob.stop();
            delete getNewSession[userId].cronJobs[newReminder.id];
            getNewSession[userId].reminders = getNewSession[userId].reminders.filter(
              (reminder) => reminder.id !== newReminder.id
            );
            getNewSession[userId].reminders.find((item) => item.id === newReminder.id).intervalStop = false;
          }, timeUntilEndOfDay);
        }
      }
    } else if (daysOfWeek?.length > 0 && time) {
      const cronTime = `${time.split(":")[1]} ${
        time.split(":")[0]
      } * * ${daysOfWeek.join(",")}`;
      cronJob = cron.schedule(cronTime, () => {
        sendReminder(newReminder);
        cronJob.stop();
        sessions[userId].reminders = sessions[userId].reminders.filter(
          (reminder) => reminder.id !== newReminder.id
        );
        delete sessions[userId].cronJobs[newReminder.id];
        saveSession(sessions);
      });
      sessions[userId].cronJobs[newReminder.id] = cronJob;
    } else if (daysOfWeek?.length > 0 && interval) {
      const cronTime = `*/${interval} * * * ${daysOfWeek.join(",")}`;
      cronJob = cron.schedule(cronTime, () => {
        sendReminder(newReminder);
        saveSession(sessions);
      });
      sessions[userId].cronJobs[newReminder.id] = cronJob;
    }

    res.redirect("/");
  });

  app.post("/delete", (req, res) => {
    const { id } = req.body;
    const userId = req.session.userId;
    const sessions = loadSessions();

    if (!sessions[userId]) {
      return res.status(404).send("User tidak ditemukan.");
    }

    if (sessions[userId].cronJobs[id]) {
    const cronJob = sessions[userId].cronJobs[id];
    cronJob.stop();
    delete sessions[userId].cronJobs[id];
    }

    saveSession(sessions);

    const reminders = loadReminders(userId);
    const updatedReminders = reminders.filter((reminder) => reminder.id !== id);
    saveReminders(updatedReminders);

    res.redirect("/");
  });

  app.get("/check-status", async (request, reply) => {
    const { number } = request.query;
    let numberReplace = number.replace(/\D/g, "");
    if (numberReplace.startsWith("08")) {
      numberReplace = "628" + numberReplace.slice(2);
    } else if (numberReplace.startsWith("8")) {
      numberReplace = "628" + numberReplace.slice(1);
    }
    const [result] = await conn.onWhatsApp(numberReplace + "@s.whatsapp.net");
    if (result && result.exists) return reply.send({ status: "available" });
    else if (!result) return reply.send({ status: "unavailable" });
  });

  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

startApi();
