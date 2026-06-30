import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
const app = express();

// Ensure data directory exists for persistence
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const DB_PATH = path.join(DATA_DIR, "db.json");

// Types definitions
interface BotConfig {
  botToken: string;
  adminId: string;
  cardNumber: string;
  cardHolder: string;
  geminiApiKey: string;
  dbApiUrl: string;
  subscriptionPrice: number;
  subscriptionPlan: string;
  botActive: boolean;
}

interface Transaction {
  id: string;
  userId: string;
  username: string;
  firstName: string;
  amount: number;
  plan: string;
  timestamp: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "FAKE";
  screenshot?: string; // base64 representation for display in web UI
  geminiResult?: {
    isValid: boolean;
    amount?: string;
    dateTime?: string;
    transactionId?: string;
    reason: string;
  };
  remindersSent: number;
  lastReminderTime?: number;
}

interface LogEntry {
  timestamp: number;
  level: "INFO" | "WARN" | "ERROR" | "SUCCESS";
  message: string;
}

// Initial default configuration
const DEFAULT_CONFIG: BotConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  adminId: process.env.ADMIN_ID || "",
  cardNumber: process.env.CARD_NUMBER || "4073420067355457",
  cardHolder: process.env.CARD_HOLDER || "Gulzebo K",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  dbApiUrl: process.env.DB_API_URL || "https://ruslan.alwaysdata.net/api.php",
  subscriptionPrice: Number(process.env.SUBSCRIPTION_PRICE) || 20000,
  subscriptionPlan: process.env.SUBSCRIPTION_PLAN || "VIP Plan (Hamma model va galichka)",
  botActive: true,
};

// Load config
let config: BotConfig = { ...DEFAULT_CONFIG };
if (fs.existsSync(CONFIG_PATH)) {
  try {
    const data = fs.readFileSync(CONFIG_PATH, "utf-8");
    config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch (err) {
    console.error("Error loading config, using defaults:", err);
  }
} else {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Load transactions and logs
let transactions: Transaction[] = [];
let logs: LogEntry[] = [];

if (fs.existsSync(DB_PATH)) {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
    transactions = data.transactions || [];
    logs = data.logs || [];
  } catch (err) {
    console.error("Error loading database, initializing empty:", err);
  }
}

function saveDb() {
  try {
    // Only save last 200 logs to prevent file bloat
    const savedLogs = logs.slice(-200);
    fs.writeFileSync(DB_PATH, JSON.stringify({ transactions, logs: savedLogs }, null, 2));
  } catch (err) {
    console.error("Error saving database:", err);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Error saving config:", err);
  }
}

function addLog(level: "INFO" | "WARN" | "ERROR" | "SUCCESS", message: string) {
  const log: LogEntry = {
    timestamp: Date.now(),
    level,
    message,
  };
  console.log(`[${level}] ${message}`);
  logs.push(log);
  saveDb();
}

// Active reminders timers
const activeTimers: { [txId: string]: NodeJS.Timeout } = {};

// Express Body Parsers (large limit for receipt base64 images)
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// Helper function to send telegram message
async function sendTelegramMessage(chatId: string, text: string, replyMarkup?: any) {
  try {
    addLog("INFO", `Telegram xabari yuborilmoqda: ChatID: ${chatId}`);
    const body: any = {
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
    };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }

    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (!result.ok) {
      addLog("ERROR", `Telegram xabar yuborishda xato: ${JSON.stringify(result)}`);
      return false;
    }
    return true;
  } catch (error: any) {
    addLog("ERROR", `Telegram xabar yuborishda kutilmagan xato: ${error.message}`);
    return false;
  }
}

// Helper to send sticker
async function sendTelegramSticker(chatId: string, stickerFileId: string) {
  try {
    addLog("INFO", `Telegram stiker yuborilmoqda: ChatID: ${chatId}`);
    const body = {
      chat_id: chatId,
      sticker: stickerFileId,
    };

    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendSticker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const result = await response.json();
    if (!result.ok) {
      // If custom sticker fails, fallback gracefully by sending celebration emojis
      addLog("WARN", `Telegram stiker yuborish bajarilmadi (graceful fallback): ${JSON.stringify(result)}`);
      await sendTelegramMessage(chatId, "🎉 👍 🌟 Check muvaffaqiyatli qabul qilindi!");
    }
    return true;
  } catch (error: any) {
    addLog("ERROR", `Telegram stiker yuborishda xato: ${error.message}`);
    await sendTelegramMessage(chatId, "🎉 👍 🌟 Check muvaffaqiyatli qabul qilindi!");
    return false;
  }
}

// Gemini AI receipt verification logic
async function verifyReceiptWithGemini(base64Image: string, mimeType: string) {
  try {
    addLog("INFO", "Gemini AI orqali to'lov cheki tahlil qilinmoqda...");
    const apiKeyToUse = config.geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKeyToUse) {
      throw new Error("Gemini API key sozlanmagan. Iltimos Sozlamalardan yoki .env faylidan sozlang.");
    }

    const ai = new GoogleGenAI({
      apiKey: apiKeyToUse,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    // Remove data:image/...;base64, prefix if present
    const cleanBase64 = base64Image.includes("base64,")
      ? base64Image.split("base64,")[1]
      : base64Image;

    const systemPrompt = `
Siz to'lov kvitansiyalarini (cheklarini) tekshiruvchi mutaxassissiz. 
Ushbu rasm O'zbekistondagi to'lov tizimlari (Click, Payme, Uzum, Apelsin, bank ilovalari yoki terminal cheki) orqali yuborilgan haqiqiy to'lov cheki ekanligini sinchkovlik bilan tekshiring.

Quyidagi ma'lumotlarni aniqlang:
1. To'lov haqiqiyligi (agar rasmda haqiqiy chek aks etgan bo'lsa va unda to'lov muvaffaqiyatli bo'lsa - isValid: true, aks holda yoki oddiy skrinshot/boshqa rasm bo'lsa - isValid: false).
2. To'lov summasi (son shaklida yoki matn).
3. Tranzaksiya vaqti va sanasi.
4. Tranzaksiya ID si.
5. To'lov holati muvaffaqiyatli ekanligini isbotlovchi dalillar.

MUHIM: Agar rasm chek bo'lmasa, yoki chekdagi holat muvaffaqiyatsiz bo'lsa, yoki tahrirlangan (fotoshoplangan) bo'lsa, isValid ni false qilib belgilang.

Javobingizni faqat va faqat quyidagi JSON formatida qaytaring, hech qanday qo'shimcha matn yozmang:
{
  "isValid": true,
  "status": "success",
  "amount": "20000",
  "dateTime": "29.06.2026 22:42:39",
  "transactionId": "1652552345",
  "reason": "Chek muvaffaqiyatli o'tkazilgan, barcha rekvizitlar joyida."
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || "image/png",
              data: cleanBase64,
            },
          },
          {
            text: systemPrompt,
          },
        ],
      },
    });

    const responseText = response.text || "";
    addLog("INFO", `Gemini AI tahlil natijasi: ${responseText}`);

    // Parse JSON safely
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        isValid: Boolean(parsed.isValid),
        status: parsed.status || "failed",
        amount: parsed.amount || "Noma'lum",
        dateTime: parsed.dateTime || "Noma'lum",
        transactionId: parsed.transactionId || "Noma'lum",
        reason: parsed.reason || "Tahlil yakunlandi",
      };
    } else {
      throw new Error("Gemini javobidan JSON topilmadi");
    }
  } catch (error: any) {
    addLog("ERROR", `Gemini AI tahlilida xatolik: ${error.message}`);
    return {
      isValid: false,
      status: "error",
      amount: "Noma'lum",
      dateTime: "Noma'lum",
      transactionId: "Noma'lum",
      reason: `Gemini AI xatosi: ${error.message}`,
    };
  }
}

// Start admin interval reminder loop
function startAdminReminders(tx: Transaction) {
  // If timer already exists, clear it first
  if (activeTimers[tx.id]) {
    clearInterval(activeTimers[tx.id]);
  }

  addLog("INFO", `Tranzaksiya [${tx.id}] uchun adminga eslatma taymer ishga tushirildi (Har 30 soniyada).`);

  const intervalId = setInterval(async () => {
    // Reload transaction to check status
    const currentTx = transactions.find((t) => t.id === tx.id);
    if (!currentTx || currentTx.status !== "PENDING") {
      clearInterval(intervalId);
      delete activeTimers[tx.id];
      return;
    }

    currentTx.remindersSent += 1;
    currentTx.lastReminderTime = Date.now();
    saveDb();

    addLog("WARN", `Adminga ${currentTx.remindersSent}-marta eslatma yuborilmoqda: Tranzaksiya ${currentTx.id}`);

    const reminderText = `
⚠️ <b>KUTILAYOTGAN TO'LOV ESLATMASI!</b> (Soni: ${currentTx.remindersSent})

👤 <b>Ismi:</b> ${currentTx.firstName} (@${currentTx.username || "noma'lum"})
🆔 <b>IDsi:</b> ${currentTx.userId}
📦 <b>Tarif:</b> ${currentTx.plan}
💰 <b>Summa:</b> ${currentTx.geminiResult?.amount || currentTx.amount} so'm
🕒 <b>Vaqti:</b> ${currentTx.geminiResult?.dateTime || new Date(currentTx.timestamp).toLocaleString()}
🔢 <b>Tranzaksiya ID:</b> <code>${currentTx.geminiResult?.transactionId || "Yo'q"}</code>

<i>Iltimos, quyidagi tugmalar orqali to'lovni tasdiqlang yoki rad eting. Tasdiqlanmaguncha har 30 soniyada eslatma kelaveradi!</i>
`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: "✅ Tasdiqlash", callback_data: `approve_${currentTx.id}` },
          { text: "❌ Rad etish", callback_data: `reject_${currentTx.id}` },
        ],
      ],
    };

    await sendTelegramMessage(config.adminId, reminderText, replyMarkup);
  }, 30000); // 30 seconds

  activeTimers[tx.id] = intervalId;
}

// Function to handle Approval or Rejection
async function handleAdminAction(txId: string, action: "APPROVED" | "REJECTED") {
  const tx = transactions.find((t) => t.id === txId);
  if (!tx) {
    addLog("ERROR", `Admin harakati uchun tranzaksiya topilmadi: ${txId}`);
    return false;
  }

  if (tx.status !== "PENDING") {
    addLog("WARN", `Tranzaksiya [${txId}] allaqachon yakunlangan: status=${tx.status}`);
    return false;
  }

  // Clear reminder timer
  if (activeTimers[txId]) {
    clearInterval(activeTimers[txId]);
    delete activeTimers[txId];
    addLog("SUCCESS", `Tranzaksiya [${txId}] eslatma taymeri to'xtatildi.`);
  }

  tx.status = action;
  saveDb();

  const timeStr = new Date().toLocaleString();

  if (action === "APPROVED") {
    addLog("SUCCESS", `To'lov tasdiqlandi: Foydalanuvchi ${tx.userId}, Summa: ${tx.amount}`);

    // Sync to external alwaysdata API
    try {
      addLog("INFO", `AlwaysData API ga sinxronizatsiya qilinmoqda: ${config.dbApiUrl}`);
      const syncUrl = `${config.dbApiUrl}?action=add_payment&user_id=${tx.userId}&username=${encodeURIComponent(tx.username)}&amount=${tx.amount}&status=approved&tx_id=${tx.geminiResult?.transactionId || tx.id}`;
      
      const syncResponse = await fetch(syncUrl, { method: "GET" }).catch(err => {
        throw new Error(`Tarmoq xatosi: ${err.message}`);
      });
      
      const syncText = await syncResponse.text();
      addLog("SUCCESS", `AlwaysData sinxronizatsiya muvaffaqiyatli: ${syncText}`);
    } catch (err: any) {
      addLog("WARN", `AlwaysData API bilan sinxronizatsiyada xatolik (davom etiladi): ${err.message}`);
    }

    // Send messages to user
    const userSuccessMsg = `
🎉 <b>To'lovingiz muvaffaqiyatli tasdiqlandi!</b>

📦 <b>Tarif:</b> VIP Plan (Hamma model va galichka)
🕒 <b>Tasdiqlangan vaqt:</b> ${timeStr}

Botdan to'liq foydalanishingiz mumkin. Rahmat!
`;
    // Telegram Success Sticker File ID (Cute celebration thumbs up)
    await sendTelegramSticker(tx.userId, "CAACAgIAAxkBAAIBFmX-p9p1UeFp0Z-8Pq-2yO1s1yZAAQACFAADvYgSGO1vWjYI_P4_LgQ");
    await sendTelegramMessage(tx.userId, userSuccessMsg);

    // Send confirmation to Admin
    const adminConfirmMsg = `
✅ <b>To'lov muvaffaqiyatli tasdiqlandi!</b>
👤 Foydalanuvchi: ${tx.firstName} (@${tx.username || "noma'lum"})
🆔 ID: ${tx.userId}
💰 Summa: ${tx.amount} so'm
🕒 Vaqt: ${timeStr}
<i>Eslatmalar to'xtatildi.</i>
`;
    await sendTelegramMessage(config.adminId, adminConfirmMsg);

  } else {
    addLog("WARN", `To'lov rad etildi: Foydalanuvchi ${tx.userId}`);

    // Send messages to user
    const userRejectMsg = `
❌ <b>Kechirasiz, yuborgan to'lovingiz admin tomonidan rad etildi.</b>

Agar xatolik yuz bergan deb hisoblasangiz, iltimos chekni qayta tekshirib yuboring yoki qo'llab-quvvatlash xizmatiga murojaat qiling.
`;
    await sendTelegramMessage(tx.userId, userRejectMsg);

    // Send confirmation to Admin
    const adminRejectMsg = `
❌ <b>To'lov rad etildi!</b>
👤 Foydalanuvchi: ${tx.firstName} (@${tx.username || "noma'lum"})
🆔 ID: ${tx.userId}
💰 Summa: ${tx.amount} so'm
🕒 Vaqt: ${timeStr}
<i>Eslatmalar to'xtatildi.</i>
`;
    await sendTelegramMessage(config.adminId, adminRejectMsg);
  }

  return true;
}

// Telegram Update processing logic
async function processTelegramUpdate(update: any) {
  try {
    if (update.callback_query) {
      // Inline keyboard callback query handler (from admin buttons)
      const callbackQuery = update.callback_query;
      const data = callbackQuery.data || "";
      const fromId = String(callbackQuery.from.id);

      addLog("INFO", `Inline tugma bosildi: data="${data}", kimdan=${fromId}`);

      // Only allow config.adminId to perform these actions
      if (fromId !== config.adminId) {
        addLog("WARN", `Ruxsatsiz admin harakati urinishi! Foydalanuvchi: ${fromId}, Kutilgan Admin: ${config.adminId}`);
        // Answer Callback Query to prevent loading spinner
        await fetch(`https://api.telegram.org/bot${config.botToken}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text: "Siz admin emassiz!",
            show_alert: true,
          }),
        });
        return;
      }

      if (data.startsWith("approve_") || data.startsWith("reject_")) {
        const parts = data.split("_");
        const action = parts[0] === "approve" ? "APPROVED" : "REJECTED";
        const txId = parts[1];

        const success = await handleAdminAction(txId, action);
        
        // Answer Callback Query
        await fetch(`https://api.telegram.org/bot${config.botToken}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text: success ? (action === "APPROVED" ? "Tasdiqlandi! ✅" : "Rad etildi! ❌") : "Xatolik yuz berdi yoki allaqachon tahrirlangan",
          }),
        });
      }
      return;
    }

    if (!update.message) return;

    const message = update.message;
    const chatId = String(message.chat.id);
    const userId = String(message.from?.id || chatId);
    const username = message.from?.username || "";
    const firstName = message.from?.first_name || "Mijoz";
    const text = message.text || "";

    addLog("INFO", `Telegram xabar: ${firstName} (@${username}): "${text || "[Rasm/Media]"}"`);

    // Handle Start command
    if (text === "/start") {
      await sendTelegramMessage(chatId, `
👋 <b>Assalomu alaykum!</b>

To'lovni amalga oshirish uchun tizimdan olingan <b>"🛍️ Yangi obuna so'rov!"</b> shaklidagi xabarni shu yerga yuboring (yoki yo'naltiring).
Shundan so'ng sizga to'lov qilish uchun plastik karta ma'lumotlari taqdim etiladi!
`);
      return;
    }

    // Handle subscription request format
    const isSubscriptionRequest = text.includes("Yangi obuna so'rov") || text.includes("IDsi:");
    if (isSubscriptionRequest) {
      let parsedName = firstName;
      let parsedId = userId;
      let parsedPlan = config.subscriptionPlan;
      let parsedPrice = config.subscriptionPrice;

      const lines = text.split("\n");
      for (const line of lines) {
        if (line.includes("Ismi:")) {
          parsedName = line.split("Ismi:")[1]?.trim() || parsedName;
        }
        if (line.includes("IDsi:")) {
          parsedId = line.split("IDsi:")[1]?.trim() || parsedId;
        }
        if (line.includes("Tarif:")) {
          parsedPlan = line.split("Tarif:")[1]?.trim() || parsedPlan;
        }
        if (line.includes("Narxi:")) {
          const rawPrice = line.split("Narxi:")[1]?.trim() || "";
          const numPrice = Number(rawPrice.replace(/\D/g, ""));
          if (!isNaN(numPrice) && numPrice > 0) {
            parsedPrice = numPrice;
          }
        }
      }

      addLog("SUCCESS", `Yangi obuna so'rovi qabul qilindi: Ismi: ${parsedName}, IDsi: ${parsedId}, Tarif: ${parsedPlan}`);

      const cardText = `
🛍️ <b>To'lov so'rovingiz qabul qilindi!</b>

To'lovni amalga oshirish uchun quyidagi plastik kartaga pul o'tkazing:

💳 Karta: <code>${config.cardNumber}</code>
👤 Ismi: <b>${config.cardHolder}</b>
💰 Summa: <b>${parsedPrice.toLocaleString()} so'm</b>

To'lovni amalga oshirgandan so'ng, <b>to'lov chekini (skrinshot yoki rasmini)</b> shu yerga yuboring. Gemini AI orqali chek tekshirilib, obunangiz faollashtiriladi!
`;
      await sendTelegramMessage(chatId, cardText);
      return;
    }

    // Handle receipt photos
    if (message.photo && message.photo.length > 0) {
      await sendTelegramMessage(chatId, "⏳ <b>To'lov cheki qabul qilindi.</b> Gemini AI yordamida chek haqiqiyligi tekshirilmoqda, iltimos bir oz kuting...");

      // Get largest photo size
      const largestPhoto = message.photo[message.photo.length - 1];
      const fileId = largestPhoto.file_id;

      addLog("INFO", `Telegram rasm yuklab olinmoqda: File ID: ${fileId}`);
      
      // Get File path from Telegram
      const getFileResponse = await fetch(`https://api.telegram.org/bot${config.botToken}/getFile?file_id=${fileId}`);
      const getFileData = await getFileResponse.json();

      if (!getFileData.ok) {
        addLog("ERROR", `Telegram getFile xatosi: ${JSON.stringify(getFileData)}`);
        await sendTelegramMessage(chatId, "❌ To'lov chekini yuklab olishda xatolik yuz berdi. Iltimos qaytadan yuborib ko'ring.");
        return;
      }

      const filePath = getFileData.result.file_path;
      const downloadUrl = `https://api.telegram.org/file/bot${config.botToken}/${filePath}`;
      
      addLog("INFO", `Fayl manzili olindi: ${downloadUrl}`);
      
      // Download as ArrayBuffer and convert to base64
      const fileResponse = await fetch(downloadUrl);
      const arrayBuffer = await fileResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Image = buffer.toString("base64");
      const mimeType = filePath.endsWith(".png") ? "image/png" : "image/jpeg";

      // Analyze receipt via Gemini
      const geminiResult = await verifyReceiptWithGemini(base64Image, mimeType);

      if (geminiResult.isValid) {
        addLog("SUCCESS", `Chek haqiqiy deb topildi! Summa: ${geminiResult.amount}, ID: ${geminiResult.transactionId}`);
        
        // Notify user about valid verification, waiting for final admin action
        await sendTelegramMessage(chatId, `
✅ <b>Chek haqiqiyligi tasdiqlandi!</b>

💰 <b>Aniqlangan summa:</b> ${geminiResult.amount} so'm
🕒 <b>Chek vaqti:</b> ${geminiResult.dateTime}
🔢 <b>Tranzaksiya IDsi:</b> <code>${geminiResult.transactionId}</code>

<i>To'lov yakuniy tasdiqlash uchun adminga yuborildi. Tez orada obunangiz faollashadi!</i>
`);

        // Create transaction
        const newTx: Transaction = {
          id: Math.random().toString(36).substring(2, 11),
          userId: userId,
          username: username,
          firstName: firstName,
          amount: isNaN(Number(geminiResult.amount.replace(/\D/g, ""))) ? config.subscriptionPrice : Number(geminiResult.amount.replace(/\D/g, "")),
          plan: config.subscriptionPlan,
          timestamp: Date.now(),
          status: "PENDING",
          screenshot: `data:${mimeType};base64,${base64Image}`,
          geminiResult: geminiResult,
          remindersSent: 0,
        };

        transactions.push(newTx);
        saveDb();

        // Send initial message to Admin
        const adminText = `
🛍️ <b>YANGI TO'LOV ARZANASINI TASDIQLASH!</b>

👤 <b>Ismi:</b> ${firstName} (@${username || "noma'lum"})
🆔 <b>IDsi:</b> ${userId}
📦 <b>Tarif:</b> ${newTx.plan}
💰 <b>Chekdagi summa:</b> ${geminiResult.amount} so'm
🕒 <b>Chekdagi vaqt:</b> ${geminiResult.dateTime}
🔢 <b>Tranzaksiya ID:</b> <code>${geminiResult.transactionId}</code>
🤖 <b>Gemini AI xulosasi:</b> ${geminiResult.reason}

<i>Iltimos, quyidagi tugmalar orqali tasdiqlang. Har 30 soniyada eslatma yuboriladi!</i>
`;

        const replyMarkup = {
          inline_keyboard: [
            [
              { text: "✅ Tasdiqlash", callback_data: `approve_${newTx.id}` },
              { text: "❌ Rad etish", callback_data: `reject_${newTx.id}` },
            ],
          ],
        };

        await sendTelegramMessage(config.adminId, adminText, replyMarkup);

        // Start 30-second reminder alerts for this transaction
        startAdminReminders(newTx);

      } else {
        addLog("WARN", `Soxta chek aniqlandi yoki rasm chek emas! Sabab: ${geminiResult.reason}`);
        
        const fakeTx: Transaction = {
          id: Math.random().toString(36).substring(2, 11),
          userId: userId,
          username: username,
          firstName: firstName,
          amount: config.subscriptionPrice,
          plan: config.subscriptionPlan,
          timestamp: Date.now(),
          status: "FAKE",
          screenshot: `data:${mimeType};base64,${base64Image}`,
          geminiResult: geminiResult,
          remindersSent: 0,
        };
        transactions.push(fakeTx);
        saveDb();

        await sendTelegramMessage(chatId, `
❌ <b>Soxta chek!</b>

Yuborilgan rasm to'lov cheki emas yoki soxtalashtirilgan deb topildi.
<b>Tahlil sababi:</b> ${geminiResult.reason}

Iltimos, haqiqiy to'lov skrinshotini yuboring!
`);
      }
      return;
    }

    // Default reply if text message sent instead of receipt photo
    await sendTelegramMessage(chatId, `
Iltimos, to'lovni plastik kartaga amalga oshirib, <b>chekning rasmini (skrinshotini)</b> jo'nating.

💳 Karta: <code>${config.cardNumber}</code>
👤 Ismi: <b>${config.cardHolder}</b>

Faqat rasm ko'rinishidagi cheklar avtomatik tahlil qilinadi!
`);

  } catch (error: any) {
    addLog("ERROR", `Telegram update qayta ishlashda kutilmagan xatolik: ${error.message}`);
  }
}

// Telegram Long Polling Runner
let telegramOffset = 0;
let isPolling = false;

async function runTelegramPolling() {
  if (isPolling || !config.botActive) return;
  isPolling = true;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.botToken}/getUpdates?offset=${telegramOffset}&timeout=5`,
      { signal: AbortSignal.timeout(10000) }
    ).catch(() => null);

    if (!response) {
      isPolling = false;
      setTimeout(runTelegramPolling, 1000);
      return;
    }

    const data = await response.json();
    if (data.ok && data.result && data.result.length > 0) {
      for (const update of data.result) {
        telegramOffset = update.update_id + 1;
        await processTelegramUpdate(update);
      }
    } else if (!data.ok) {
      // If Bot token is invalid or webhook is active, log once in a while
      if (data.description && data.description.includes("webhook")) {
        // Delete webhook first to allow polling
        await fetch(`https://api.telegram.org/bot${config.botToken}/deleteWebhook`);
      }
    }
  } catch (err) {
    // Avoid console spam on networking timeout
  }

  isPolling = false;
  setTimeout(runTelegramPolling, 500);
}

// Start Telegram Polling initially
runTelegramPolling();

// Clean up intervals on restart
process.on("SIGINT", () => {
  Object.values(activeTimers).forEach((id) => clearInterval(id));
  process.exit();
});

// REST API Endpoints for Dashboard UI
app.get("/api/state", (req, res) => {
  res.json({
    config,
    transactions,
    logs: logs.slice(-100), // return last 100 logs
    pollingActive: isPolling,
  });
});

app.post("/api/config", (req, res) => {
  const newConfig = req.body;
  if (!newConfig.botToken || !newConfig.adminId) {
    res.status(400).json({ error: "Bot token va Admin ID majburiy!" });
    return;
  }

  const tokenChanged = config.botToken !== newConfig.botToken;

  config = {
    ...config,
    ...newConfig,
  };

  saveConfig();
  addLog("SUCCESS", "Bot sozlamalari muvaffaqiyatli yangilandi.");

  if (tokenChanged) {
    telegramOffset = 0; // reset offset for new token
    addLog("INFO", "Bot tokeni o'zgardi, Telegram Polling yangidan sozlandi.");
  }

  res.json({ success: true, config });
});

app.get("/api/logs", (req, res) => {
  res.json(logs);
});

app.post("/api/logs/clear", (req, res) => {
  logs = [];
  saveDb();
  res.json({ success: true });
});

app.get("/api/transactions", (req, res) => {
  res.json(transactions);
});

// Admin Approval action via Dashboard Web UI
app.post("/api/admin/action", async (req, res) => {
  const { txId, action } = req.body;
  if (!txId || !action || (action !== "APPROVED" && action !== "REJECTED")) {
    res.status(400).json({ error: "Noto'g'ri so'rov parametrlari" });
    return;
  }

  const success = await handleAdminAction(txId, action);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: "Amal bajarilmadi (tranzaksiya topilmadi yoki allaqachon yakunlangan)" });
  }
});

// Client simulation endpoint - simulates user text message
app.post("/api/simulate/message", async (req, res) => {
  const { text, userId, firstName, username } = req.body;
  
  const mockUpdate = {
    update_id: Math.floor(Math.random() * 1000000),
    message: {
      message_id: Math.floor(Math.random() * 100000),
      from: {
        id: Number(userId || "165255"),
        is_bot: false,
        first_name: firstName || "Ruslan",
        username: username || "ruslan",
      },
      chat: {
        id: Number(userId || "165255"),
        first_name: firstName || "Ruslan",
        username: username || "ruslan",
        type: "private",
      },
      date: Math.floor(Date.now() / 1000),
      text: text,
    },
  };

  addLog("INFO", `[SIMULATOR] Mijoz xabari simulyatsiya qilinmoqda: "${text}"`);
  await processTelegramUpdate(mockUpdate);
  res.json({ success: true, transactions, logs: logs.slice(-100) });
});

// Client simulation endpoint - simulates receipt photo upload
app.post("/api/simulate/receipt", async (req, res) => {
  const { base64Image, mimeType, userId, firstName, username } = req.body;
  if (!base64Image) {
    res.status(400).json({ error: "Rasm yuklanmagan" });
    return;
  }

  addLog("INFO", `[SIMULATOR] To'lov cheki yuborilishi simulyatsiya qilinmoqda...`);

  // Run Gemini analysis directly
  const geminiResult = await verifyReceiptWithGemini(base64Image, mimeType || "image/png");

  const simulatedTxId = Math.random().toString(36).substring(2, 11);
  const uId = userId || "165255";
  const fName = firstName || "Ruslan";
  const uName = username || "ruslan";

  if (geminiResult.isValid) {
    addLog("SUCCESS", `[SIMULATOR] Chek haqiqiy deb topildi! Summa: ${geminiResult.amount}`);
    
    const newTx: Transaction = {
      id: simulatedTxId,
      userId: uId,
      username: uName,
      firstName: fName,
      amount: isNaN(Number(geminiResult.amount.replace(/\D/g, ""))) ? config.subscriptionPrice : Number(geminiResult.amount.replace(/\D/g, "")),
      plan: config.subscriptionPlan,
      timestamp: Date.now(),
      status: "PENDING",
      screenshot: base64Image,
      geminiResult: geminiResult,
      remindersSent: 0,
    };

    transactions.push(newTx);
    saveDb();

    // Start 30-second interval reminder loop
    startAdminReminders(newTx);

    // Send mock notification to the telegram bot admin (if running)
    const adminText = `
[SIMULATOR] 🛍️ <b>YANGI TO'LOV ARZANASINI TASDIQLASH!</b>

👤 <b>Ismi:</b> ${fName} (@${uName || "noma'lum"})
🆔 <b>IDsi:</b> ${uId}
📦 <b>Tarif:</b> ${newTx.plan}
💰 <b>Chekdagi summa:</b> ${geminiResult.amount} so'm
🕒 <b>Chekdagi vaqt:</b> ${geminiResult.dateTime}
🔢 <b>Tranzaksiya ID:</b> <code>${geminiResult.transactionId}</code>
🤖 <b>Gemini AI xulosasi:</b> ${geminiResult.reason}
`;
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: "✅ Tasdiqlash", callback_data: `approve_${newTx.id}` },
          { text: "❌ Rad etish", callback_data: `reject_${newTx.id}` },
        ],
      ],
    };
    await sendTelegramMessage(config.adminId, adminText, replyMarkup);

  } else {
    addLog("WARN", `[SIMULATOR] Soxta chek aniqlandi! Sabab: ${geminiResult.reason}`);
    
    const fakeTx: Transaction = {
      id: simulatedTxId,
      userId: uId,
      username: uName,
      firstName: fName,
      amount: config.subscriptionPrice,
      plan: config.subscriptionPlan,
      timestamp: Date.now(),
      status: "FAKE",
      screenshot: base64Image,
      geminiResult: geminiResult,
      remindersSent: 0,
    };
    transactions.push(fakeTx);
    saveDb();
  }

  res.json({ success: true, transactions, geminiResult, logs: logs.slice(-100) });
});

// Configure Vite server middleware in dev, static serving in production
async function startAppServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Full-stack application running at http://localhost:${PORT}`);
  });
}

startAppServer();
