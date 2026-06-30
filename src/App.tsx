import React, { useState, useEffect, useRef } from "react";
import {
  Bot,
  Shield,
  Settings,
  FileText,
  Smartphone,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Send,
  Check,
  X,
  ShieldAlert,
  Zap,
  RefreshCw,
  Award,
  DollarSign,
  Clock,
  CreditCard,
  ExternalLink,
  Activity,
  User,
  Sliders,
  Bell,
  Trash2
} from "lucide-react";

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
  screenshot?: string;
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

interface AppState {
  config: BotConfig;
  transactions: Transaction[];
  logs: LogEntry[];
  pollingActive: boolean;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [activeTab, setActiveTab] = useState<"dashboard" | "simulator" | "admin" | "transactions" | "settings">("dashboard");
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [simulating, setSimulating] = useState(false);

  // Form states for settings
  const [formConfig, setFormConfig] = useState<BotConfig>({
    botToken: "",
    adminId: "",
    cardNumber: "",
    cardHolder: "",
    geminiApiKey: "",
    dbApiUrl: "",
    subscriptionPrice: 20000,
    subscriptionPlan: "",
    botActive: true,
  });

  // Simulator chat states
  const [simMessages, setSimMessages] = useState<Array<{ sender: "user" | "bot"; text?: string; image?: string; timestamp: Date }>>([
    { sender: "bot", text: "Assalomu alaykum! To'lov botiga xush kelibsiz.\nObunani faollashtirish uchun /start buyrug'ini yuboring.", timestamp: new Date() }
  ]);
  const [simInput, setSimInput] = useState("");
  const [simUserId, setSimUserId] = useState("165255");
  const [simUserName, setSimUserName] = useState("ruslan");
  const [simFirstName, setSimFirstName] = useState("Ruslan");

  // Timer simulation countdowns
  const [countdowns, setCountdowns] = useState<{ [txId: string]: number }>({});

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Fetch current state from API
  const fetchState = async () => {
    try {
      const response = await fetch("/api/state");
      const data: AppState = await response.json();
      setState(data);
      if (loading) {
        setFormConfig(data.config);
        setLoading(false);
      }
    } catch (error) {
      console.error("Error fetching state:", error);
    }
  };

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, [loading]);

  // Handle countdown animation ticks for active reminders (every 1 second)
  useEffect(() => {
    const timer = setInterval(() => {
      if (!state) return;
      const updatedCountdowns: { [txId: string]: number } = {};

      state.transactions.forEach((tx) => {
        if (tx.status === "PENDING") {
          const lastTime = tx.lastReminderTime || tx.timestamp;
          const elapsed = Math.floor((Date.now() - lastTime) / 1000);
          const remaining = Math.max(0, 30 - (elapsed % 30));
          updatedCountdowns[tx.id] = remaining;
        }
      });
      setCountdowns(updatedCountdowns);
    }, 1000);

    return () => clearInterval(timer);
  }, [state]);

  // Auto scroll to chat end
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [simMessages]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formConfig),
      });
      if (response.ok) {
        await fetchState();
        alert("Sozlamalar muvaffaqiyatli saqlandi! Bot yangi sozlamalar bilan ishga tushdi.");
      } else {
        alert("Sozlamalarni saqlashda xatolik yuz berdi.");
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Tarmoq xatosi!");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleClearLogs = async () => {
    if (!confirm("Barcha tizim jurnallari (loglarni) o'chirishni xohlaysizmi?")) return;
    try {
      await fetch("/api/logs/clear", { method: "POST" });
      await fetchState();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAdminAction = async (txId: string, action: "APPROVED" | "REJECTED") => {
    try {
      const response = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txId, action }),
      });
      if (response.ok) {
        await fetchState();
      } else {
        const errorData = await response.json();
        alert(`Amal bajarilmadi: ${errorData.error}`);
      }
    } catch (error) {
      console.error("Admin action error:", error);
    }
  };

  const handleSimulateText = async (customText?: string) => {
    const textToSend = customText || simInput;
    if (!textToSend.trim()) return;

    // Add user message to simulator ui
    setSimMessages((prev) => [...prev, { sender: "user", text: textToSend, timestamp: new Date() }]);
    if (!customText) setSimInput("");

    setSimulating(true);

    try {
      const response = await fetch("/api/simulate/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToSend,
          userId: simUserId,
          firstName: simFirstName,
          username: simUserName,
        }),
      });

      if (response.ok) {
        await fetchState();
        // Construct the expected reply based on text
        setTimeout(() => {
          const isSubMsg = textToSend.includes("Yangi obuna so'rov") || textToSend.includes("IDsi:");
          if (textToSend === "/start") {
            setSimMessages((prev) => [
              ...prev,
              {
                sender: "bot",
                text: `👋 <b>Assalomu alaykum!</b>\n\nTo'lovni amalga oshirish uchun tizimdan olingan <b>"🛍️ Yangi obuna so'rov!"</b> shaklidagi xabarni shu yerga yuboring (yoki yo'naltiring).\nShundan so'ng sizga to'lov qilish uchun plastik karta ma'lumotlari taqdim etiladi!`,
                timestamp: new Date(),
              }
            ]);
          } else if (isSubMsg) {
            setSimMessages((prev) => [
              ...prev,
              {
                sender: "bot",
                text: `🛍️ <b>To'lov so'rovingiz qabul qilindi!</b>\n\nTo'lovni amalga oshirish uchun quyidagi plastik kartaga pul o'tkazing:\n\n💳 Karta: <code>${state?.config.cardNumber || "4073420067355457"}</code>\n👤 Ismi: <b>${state?.config.cardHolder || "Gulzebo K"}</b>\n💰 Summa: <b>20 000 so'm</b>\n\nTo'lovni amalga oshirgandan so'ng, <b>to'lov chekini (skrinshot yoki rasmini)</b> shu yerga yuboring. Gemini AI orqali chek tekshirilib, obunangiz faollashtiriladi!`,
                timestamp: new Date(),
              }
            ]);
          } else {
            setSimMessages((prev) => [
              ...prev,
              {
                sender: "bot",
                text: `Iltimos, to'lovni plastik kartaga amalga oshirib, <b>chekning rasmini (skrinshotini)</b> jo'nating.\n\n💳 Karta: <code>${state?.config.cardNumber || "4073420067355457"}</code>\n👤 Ismi: <b>${state?.config.cardHolder || "Gulzebo K"}</b>\n\nFaqat rasm ko'rinishidagi cheklar avtomatik tahlil qilinadi!`,
                timestamp: new Date(),
              }
            ]);
          }
        }, 1000);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setSimulating(false);
    }
  };

  // Programmatically generate a mock receipt image on Canvas
  const generateReceiptBase64 = (type: "real" | "fake") => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 550;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    // Background Gradient (Uzbek Payment Apps UI feel)
    const grad = ctx.createLinearGradient(0, 0, 0, 550);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#f4f7f6");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 400, 550);

    // Decorative receipt header
    ctx.fillStyle = type === "real" ? "#00B974" : "#E23E3E"; // Click success green or warning red
    ctx.fillRect(0, 0, 400, 80);

    // Header Text
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px 'Space Grotesk', Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(type === "real" ? "CLICK TO'LOV TIZIMI" : "MOCK BANKING ERROR", 200, 45);

    // Status Banner
    ctx.fillStyle = type === "real" ? "#E3F9EB" : "#FEECEE";
    ctx.fillRect(20, 100, 360, 45);

    ctx.fillStyle = type === "real" ? "#0E622F" : "#A61F25";
    ctx.font = "600 16px 'Space Grotesk', Inter, sans-serif";
    ctx.fillText(type === "real" ? "● TO'LOV MUVAFFAQIYATLI O'TKAZILDI" : "● TO'LOV BEKOR QILINDI / XATO", 200, 128);

    // Draw fields
    const drawField = (label: string, value: string, y: number, isBoldValue = false) => {
      ctx.fillStyle = "#8E9AA0";
      ctx.font = "400 14px 'Inter', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(label, 30, y);

      ctx.fillStyle = isBoldValue ? "#1C272C" : "#4A555B";
      ctx.font = isBoldValue ? "bold 15px 'JetBrains Mono', monospace" : "500 14px 'Inter', sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(value, 370, y);

      // Dash separator
      ctx.strokeStyle = "#E4E9EC";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(30, y + 15);
      ctx.lineTo(370, y + 15);
      ctx.stroke();
    };

    if (type === "real") {
      drawField("To'lov turi", "VIP Obuna", 180);
      drawField("Summa", "20 000 so'm", 220, true);
      drawField("Qabul qiluvchi", state?.config.cardHolder || "Gulzebo K", 260);
      drawField("Karta raqami", state?.config.cardNumber || "4073420067355457", 300, true);
      drawField("Tranzaksiya IDsi", "165255" + Math.floor(1000 + Math.random() * 9000), 340, true);
      drawField("Sana va vaqt", new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" }), 380);
      drawField("Terminal kodi", "CLICK-APP-82669", 420);
    } else {
      drawField("To'lov turi", "Noma'lum o'tkazma", 180);
      drawField("Summa", "150 Rubl", 220, true);
      drawField("Qabul qiluvchi", "Begona Shaxs", 260);
      drawField("Status", "Rad etilgan", 300);
      drawField("Tushuntirish", "Xatolik 503: Tizim xatosi", 340);
      drawField("Sana", "12.01.2020", 380);
      
      // Draw watermark SOXTA
      ctx.fillStyle = "rgba(226, 62, 62, 0.15)";
      ctx.font = "bold 64px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.save();
      ctx.translate(200, 320);
      ctx.rotate(-Math.PI / 6);
      ctx.fillText("SOXTA CHEK", 0, 0);
      ctx.restore();
    }

    // Draw footer card info
    ctx.fillStyle = "#8E9AA0";
    ctx.font = "italic 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Ushbu kvitansiya dastur simulyatori tomonidan yaratilgan.", 200, 490);
    ctx.fillText("E'tibor berganingiz uchun tashakkur!", 200, 510);

    return canvas.toDataURL("image/png");
  };

  const handleSimulateReceipt = async (type: "real" | "fake") => {
    setSimulating(true);
    const dataUrl = generateReceiptBase64(type);

    // Add receipt representation to simulator chat
    setSimMessages((prev) => [
      ...prev,
      { sender: "user", image: dataUrl, text: `[Yuborilgan chek: ${type === "real" ? "Haqiqiy Click cheki" : "Soxta chek"}]`, timestamp: new Date() }
    ]);

    // Bot instant reply "processing"
    setSimMessages((prev) => [
      ...prev,
      { sender: "bot", text: "⏳ <b>To'lov cheki qabul qilindi.</b> Gemini AI yordamida chek haqiqiyligi tekshirilmoqda, iltimos bir oz kuting...", timestamp: new Date() }
    ]);

    try {
      const response = await fetch("/api/simulate/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64Image: dataUrl,
          mimeType: "image/png",
          userId: simUserId,
          firstName: simFirstName,
          username: simUserName,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const geminiResult = result.geminiResult;
        
        await fetchState();

        // Bot replies based on verification
        setTimeout(() => {
          if (geminiResult.isValid) {
            setSimMessages((prev) => [
              ...prev,
              {
                sender: "bot",
                text: `✅ <b>Chek haqiqiyligi tasdiqlandi!</b>\n\n💰 <b>Aniqlangan summa:</b> ${geminiResult.amount} so'm\n🕒 <b>Chek vaqti:</b> ${geminiResult.dateTime}\n🔢 <b>Tranzaksiya IDsi:</b> <code>${geminiResult.transactionId}</code>\n\n<i>To'lov yakuniy tasdiqlash uchun adminga yuborildi. Tez orada obunangiz faollashadi!</i>`,
                timestamp: new Date(),
              }
            ]);
          } else {
            setSimMessages((prev) => [
              ...prev,
              {
                sender: "bot",
                text: `❌ <b>Soxta chek!</b>\n\nYuborilgan rasm to'lov cheki emas yoki soxtalashtirilgan deb topildi.\n<b>Tahlil sababi:</b> ${geminiResult.reason}\n\nIltimos, haqiqiy to'lov skrinshotini yuboring!`,
                timestamp: new Date(),
              }
            ]);
          }
        }, 1500);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setSimulating(false);
    }
  };

  const triggerUploadReceipt = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const base64Image = reader.result as string;
        setSimulating(true);

        // Add to simulator ui
        setSimMessages((prev) => [
          ...prev,
          { sender: "user", image: base64Image, text: `[Yuklangan chek: ${file.name}]`, timestamp: new Date() }
        ]);

        setSimMessages((prev) => [
          ...prev,
          { sender: "bot", text: "⏳ <b>To'lov cheki qabul qilindi.</b> Gemini AI yordamida chek haqiqiyligi tekshirilmoqda, iltimos bir oz kuting...", timestamp: new Date() }
        ]);

        try {
          const response = await fetch("/api/simulate/receipt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              base64Image: base64Image,
              mimeType: file.type,
              userId: simUserId,
              firstName: simFirstName,
              username: simUserName,
            }),
          });

          if (response.ok) {
            const result = await response.json();
            const geminiResult = result.geminiResult;
            await fetchState();

            setTimeout(() => {
              if (geminiResult.isValid) {
                setSimMessages((prev) => [
                  ...prev,
                  {
                    sender: "bot",
                    text: `✅ <b>Chek haqiqiyligi tasdiqlandi!</b>\n\n💰 <b>Aniqlangan summa:</b> ${geminiResult.amount} so'm\n🕒 <b>Chek vaqti:</b> ${geminiResult.dateTime}\n🔢 <b>Tranzaksiya IDsi:</b> <code>${geminiResult.transactionId}</code>\n\n<i>To'lov yakuniy tasdiqlash uchun adminga yuborildi. Tez orada obunangiz faollashadi!</i>`,
                    timestamp: new Date(),
                  }
                ]);
              } else {
                setSimMessages((prev) => [
                  ...prev,
                  {
                    sender: "bot",
                    text: `❌ <b>Soxta chek!</b>\n\nYuborilgan rasm to'lov cheki emas yoki soxtalashtirilgan deb topildi.\n<b>Tahlil sababi:</b> ${geminiResult.reason}\n\nIltimos, haqiqiy to'lov skrinshotini yuboring!`,
                    timestamp: new Date(),
                  }
                ]);
              }
            }, 1500);
          }
        } catch (error) {
          console.error(error);
        } finally {
          setSimulating(false);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  if (loading || !state) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-100">
        <RefreshCw className="w-12 h-12 animate-spin text-emerald-500 mb-4" />
        <h2 className="text-xl font-medium tracking-tight">Tizim yuklanmoqda...</h2>
        <p className="text-sm text-slate-400 mt-2">Iltimos, kuting</p>
      </div>
    );
  }

  // Calculate quick summary metrics
  const totalTransactions = state.transactions.length;
  const pendingTransactions = state.transactions.filter((t) => t.status === "PENDING");
  const approvedTransactions = state.transactions.filter((t) => t.status === "APPROVED");
  const fakeTransactions = state.transactions.filter((t) => t.status === "FAKE");
  const rejectedTransactions = state.transactions.filter((t) => t.status === "REJECTED");

  const successRate = totalTransactions > 0 
    ? Math.round((approvedTransactions.length / (totalTransactions - fakeTransactions.length || 1)) * 100) 
    : 100;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20 text-emerald-400 animate-pulse">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
              Telegram To'lov Bot Boshqaruv Paneli
            </h1>
            <p className="text-xs text-slate-400 flex items-center gap-1">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${state.pollingActive ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></span>
              Telegram Polling: {state.pollingActive ? "Aktiv" : "Kutilmoqda"} | Admin ID: {state.config.adminId}
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center bg-slate-900/60 p-1 rounded-xl border border-slate-800/80">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === "dashboard" ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "text-slate-400 hover:text-white"
            }`}
          >
            <Activity className="w-4 h-4" />
            Statistika & Loglar
          </button>
          <button
            onClick={() => setActiveTab("simulator")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === "simulator" ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "text-slate-400 hover:text-white"
            }`}
          >
            <Smartphone className="w-4 h-4" />
            Bot Simulyatori
          </button>
          <button
            onClick={() => setActiveTab("admin")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition relative ${
              activeTab === "admin" ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "text-slate-400 hover:text-white"
            }`}
          >
            <Shield className="w-4 h-4" />
            Admin Portali
            {pendingTransactions.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold border-2 border-slate-950 animate-bounce">
                {pendingTransactions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("transactions")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === "transactions" ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "text-slate-400 hover:text-white"
            }`}
          >
            <FileText className="w-4 h-4" />
            Tarix
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
              activeTab === "settings" ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "text-slate-400 hover:text-white"
            }`}
          >
            <Settings className="w-4 h-4" />
            Sozlamalar
          </button>
        </nav>
      </header>

      {/* Main Panel Body */}
      <main className="max-w-7xl mx-auto p-6">
        
        {/* Quick Summary Metrics Bento Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-2xl flex items-center gap-4">
            <div className="bg-blue-500/10 p-3 rounded-xl border border-blue-500/20 text-blue-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Barcha To'lovlar</p>
              <h3 className="text-2xl font-bold font-mono text-white mt-1">{totalTransactions}</h3>
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-2xl flex items-center gap-4">
            <div className="bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 text-amber-400">
              <Clock className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Kutilayotgan (Tasdiq)</p>
              <h3 className="text-2xl font-bold font-mono text-white mt-1">{pendingTransactions.length}</h3>
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-2xl flex items-center gap-4">
            <div className="bg-red-500/10 p-3 rounded-xl border border-red-500/20 text-red-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Soxta Cheklar</p>
              <h3 className="text-2xl font-bold font-mono text-white mt-1">{fakeTransactions.length}</h3>
            </div>
          </div>

          <div className="bg-slate-900/40 border border-slate-800/80 p-4 rounded-2xl flex items-center gap-4">
            <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-emerald-400">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Tasdiqlash Koeffitsiyenti</p>
              <h3 className="text-2xl font-bold font-mono text-white mt-1">{successRate}%</h3>
            </div>
          </div>
        </div>

        {/* Tab 1: Dashboard & Logs */}
        {activeTab === "dashboard" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left Status Summary */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl">
                <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
                  <Bot className="w-5 h-5 text-emerald-400" />
                  Botning Hozirgi Holati
                </h3>
                
                <div className="space-y-4 text-sm">
                  <div className="flex justify-between py-2 border-b border-slate-800/50">
                    <span className="text-slate-400">Dastur rejim</span>
                    <span className="font-semibold text-emerald-400">Aktiv Polling</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-800/50">
                    <span className="text-slate-400">Plastik karta</span>
                    <span className="font-mono text-white">{state.config.cardNumber}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-800/50">
                    <span className="text-slate-400">Karta egasi</span>
                    <span className="font-medium text-white">{state.config.cardHolder}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-800/50">
                    <span className="text-slate-400">Tarif qiymati</span>
                    <span className="font-mono font-medium text-emerald-400">{state.config.subscriptionPrice.toLocaleString()} UZS</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-400">Admin hisob ID</span>
                    <span className="font-mono text-slate-300">{state.config.adminId}</span>
                  </div>
                </div>

                <div className="mt-6 bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Simulyatsiya Yo'riqnomasi:</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    1. <b>Bot Simulyatori</b> sahifasiga o'ting.<br />
                    2. "<b>/start</b>" yozib botni ishga tushiring.<br />
                    3. "<b>Chek jo'natish</b>" orqali haqiqiy yoki soxta cheklarni simulyatsiya qiling va Gemini AI qanday tahlil qilishini ko'ring!
                  </p>
                </div>
              </div>

              {/* External Sync status */}
              <div className="bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl">
                <h3 className="text-md font-bold text-white mb-2 flex items-center gap-2">
                  <ExternalLink className="w-5 h-5 text-blue-400" />
                  Ma'lumotlar Bazasi API
                </h3>
                <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                  Har bir muvaffaqiyatli to'lov tasdiqlanganidan so'ng ushbu API ga so'rov yuboriladi.
                </p>
                <div className="bg-slate-950/80 border border-slate-800/60 p-3 rounded-xl">
                  <code className="text-xs font-mono text-blue-400 break-all">{state.config.dbApiUrl}</code>
                </div>
              </div>
            </div>

            {/* Right Interactive System Logs */}
            <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800/80 rounded-2xl flex flex-col h-[500px]">
              <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
                <h3 className="text-md font-bold text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-slate-400 animate-pulse" />
                  Tizim Jurnallari (Live Logs)
                </h3>
                <button
                  onClick={handleClearLogs}
                  className="text-slate-400 hover:text-red-400 transition p-1.5 rounded-lg hover:bg-slate-800/60"
                  title="Jurnallarni tozalash"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* Logs area */}
              <div className="p-4 overflow-y-auto flex-1 font-mono text-xs space-y-2 bg-slate-950/40">
                {state.logs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500">
                    <Activity className="w-8 h-8 mb-2 opacity-30" />
                    <p>Hech qanday loglar topilmadi</p>
                  </div>
                ) : (
                  state.logs.map((log, index) => {
                    let levelColor = "text-blue-400";
                    let levelBg = "bg-blue-500/10 border-blue-500/20";
                    if (log.level === "WARN") {
                      levelColor = "text-amber-400";
                      levelBg = "bg-amber-500/10 border-amber-500/20";
                    } else if (log.level === "ERROR") {
                      levelColor = "text-red-400";
                      levelBg = "bg-red-500/10 border-red-500/20";
                    } else if (log.level === "SUCCESS") {
                      levelColor = "text-emerald-400";
                      levelBg = "bg-emerald-500/10 border-emerald-500/20";
                    }

                    return (
                      <div key={index} className={`p-2 rounded border ${levelBg} flex flex-col gap-1`}>
                        <div className="flex items-center justify-between">
                          <span className={`font-bold text-[10px] uppercase tracking-wider ${levelColor}`}>
                            [{log.level}]
                          </span>
                          <span className="text-slate-500 text-[10px]">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="text-slate-300 break-words">{log.message}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Telegram Bot Simulator */}
        {activeTab === "simulator" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            
            {/* Left Simulator Setup Controller */}
            <div className="lg:col-span-1 bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl space-y-5">
              <div>
                <h3 className="text-md font-bold text-white flex items-center gap-2 mb-2">
                  <Smartphone className="w-5 h-5 text-emerald-400" />
                  Mijoz Simulyatori
                </h3>
                <p className="text-xs text-slate-400">
                  Ushbu qismda siz Telegram bot foydalanuvchisi rolida bo'lasiz va unga turli xabarlar yoki to'lov cheklarini jo'natishingiz mumkin.
                </p>
              </div>

              {/* Simulated Customer Settings */}
              <div className="space-y-3 bg-slate-950 p-4 rounded-xl border border-slate-800/60">
                <h4 className="text-xs font-bold text-slate-400 uppercase">Foydalanuvchi ma'lumotlari:</h4>
                
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Mijoz IDsi (Telegram Chat ID)</label>
                  <input
                    type="text"
                    value={simUserId}
                    onChange={(e) => setSimUserId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Mijoz Ismi</label>
                  <input
                    type="text"
                    value={simFirstName}
                    onChange={(e) => setSimFirstName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">Telegram Username (@)</label>
                  <input
                    type="text"
                    value={simUserName}
                    onChange={(e) => setSimUserName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-white font-mono"
                  />
                </div>
              </div>

              {/* Bot Simulation Interactive Quick Buttons */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-400 uppercase">Tezkor Tugmalar:</h4>
                
                <button
                  onClick={() => handleSimulateText("/start")}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-white text-xs py-2 px-3 rounded-lg font-medium transition flex items-center justify-between"
                  disabled={simulating}
                >
                  <span>1. Salomlashish (/start)</span>
                  <span className="bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-mono">XABAR</span>
                </button>

                <button
                  onClick={() => handleSimulateText(`🛍️ Yangi obuna so'rov!\n\n👤 Ismi: ${simFirstName}\n🆔 IDsi: ${simUserId}\n📦 Tarif: VIP Plan (Hamma model va galichka)\n💰 Narxi: 20 000 so'm / oy\n🕒 Vaqti: ${new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}`)}
                  className="w-full bg-indigo-900/40 hover:bg-indigo-950 border border-indigo-800/50 text-indigo-200 text-xs py-2 px-3 rounded-lg font-medium transition flex items-center justify-between"
                  disabled={simulating}
                >
                  <span>2. Obuna so'rovini yuborish (Sms)</span>
                  <span className="bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-mono">SMS</span>
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleSimulateReceipt("real")}
                    className="bg-emerald-600/90 hover:bg-emerald-600 text-white text-xs py-2.5 px-3 rounded-lg font-bold transition flex flex-col items-center justify-center gap-1 shadow-lg shadow-emerald-500/10"
                    disabled={simulating}
                  >
                    <span>Haqiqiy Chek yuborish</span>
                    <span className="text-[10px] font-normal text-emerald-100">Click chek generatsiyasi</span>
                  </button>

                  <button
                    onClick={() => handleSimulateReceipt("fake")}
                    className="bg-rose-600/95 hover:bg-rose-600 text-white text-xs py-2.5 px-3 rounded-lg font-bold transition flex flex-col items-center justify-center gap-1 shadow-lg shadow-rose-500/10"
                    disabled={simulating}
                  >
                    <span>Soxta Chek yuborish</span>
                    <span className="text-[10px] font-normal text-rose-100">Xato chek generatsiyasi</span>
                  </button>
                </div>

                <button
                  onClick={triggerUploadReceipt}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs py-2.5 px-3 rounded-lg font-medium transition flex items-center justify-center gap-2"
                  disabled={simulating}
                >
                  <span>Kombirlashgan / O'zingiz rasm yuklang</span>
                </button>
              </div>
            </div>

            {/* Right Telegram Chat Visual Mockup */}
            <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800/80 rounded-2xl flex flex-col h-[600px] overflow-hidden">
              {/* Telegram App Header */}
              <div className="bg-slate-950 p-4 border-b border-slate-800/80 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
                  TB
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">To'lov Tasdiqlash Boti</h4>
                  <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                    bot running (polling online)
                  </p>
                </div>
              </div>

              {/* Chat Messages Space */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=600')] bg-cover bg-blend-multiply bg-slate-950/90">
                {simMessages.map((msg, index) => {
                  const isUser = msg.sender === "user";
                  return (
                    <div
                      key={index}
                      className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-md flex flex-col gap-1.5 ${
                          isUser
                            ? "bg-emerald-600 text-white rounded-tr-none"
                            : "bg-slate-900 text-slate-100 border border-slate-800/60 rounded-tl-none"
                        }`}
                      >
                        {msg.image && (
                          <img
                            src={msg.image}
                            alt="Chek"
                            className="rounded-lg max-h-60 object-contain border border-slate-700/50 mb-1"
                          />
                        )}
                        {msg.text && (
                          <div
                            className="text-sm leading-relaxed whitespace-pre-wrap"
                            dangerouslySetInnerHTML={{ __html: msg.text }}
                          />
                        )}
                        <span className="text-[9px] text-slate-300 self-end">
                          {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {simulating && (
                  <div className="flex justify-start">
                    <div className="bg-slate-900 text-slate-400 rounded-2xl rounded-tl-none px-4 py-2.5 border border-slate-800/60 text-xs flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                      Gemini AI chekni tekshirmoqda...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input Field */}
              <div className="p-3 bg-slate-950 border-t border-slate-800/80 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Xabarni yozing..."
                  value={simInput}
                  onChange={(e) => setSimInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSimulateText()}
                  className="flex-1 bg-slate-900 text-sm border border-slate-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-emerald-500 transition"
                  disabled={simulating}
                />
                <button
                  onClick={() => handleSimulateText()}
                  className="bg-emerald-500 hover:bg-emerald-400 text-white p-2.5 rounded-xl transition shadow-lg shadow-emerald-500/10"
                  disabled={simulating || !simInput.trim()}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Admin Approval Portal */}
        {activeTab === "admin" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Shield className="w-5.5 h-5.5 text-emerald-400 animate-pulse" />
                  Kutilayotgan To'lovlarni Tasdiqlash Portali (Admin)
                </h3>
                <p className="text-xs text-slate-400">
                  Ushbu sahifada adminlar kutilayotgan to'lovlarni ko'rishadi, har 30 soniyada adminga Telegramdan bildirishnoma jo'natiladi.
                </p>
              </div>
            </div>

            {pendingTransactions.length === 0 ? (
              <div className="bg-slate-900/20 border border-slate-800/80 p-12 rounded-2xl flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-400/80 mb-3 animate-bounce" />
                <h4 className="text-white font-bold text-md">Barcha to'lovlar yakunlangan!</h4>
                <p className="text-slate-400 text-xs mt-1 max-w-sm">
                  Ayni damda tasdiqlash kutilayotgan yangi cheklar mavjud emas. Mijozlar chek yuborganda ular shu yerda ko'rinadi.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {pendingTransactions.map((tx) => {
                  const remainingSeconds = countdowns[tx.id] !== undefined ? countdowns[tx.id] : 30;

                  return (
                    <div key={tx.id} className="bg-slate-900/40 border-2 border-slate-800 rounded-2xl flex flex-col overflow-hidden">
                      {/* Admin alert banner */}
                      <div className="bg-amber-500/10 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs text-amber-400 font-semibold">
                        <span className="flex items-center gap-1.5 animate-pulse">
                          <Bell className="w-3.5 h-3.5" />
                          FAOL ESLATMA (Telegram): {tx.remindersSent} marta
                        </span>
                        <span className="bg-slate-950 px-2 py-0.5 rounded font-mono text-[10px]">
                          Keyingi SMS: {remainingSeconds} soniya
                        </span>
                      </div>

                      {/* Content split */}
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
                        {/* Left Column: Image */}
                        <div className="sm:col-span-1 flex flex-col justify-center items-center bg-slate-950 rounded-xl p-2 border border-slate-800/80 relative group">
                          {tx.screenshot ? (
                            <img
                              src={tx.screenshot}
                              alt="Receipt"
                              className="max-h-48 object-contain rounded-lg"
                            />
                          ) : (
                            <div className="text-xs text-slate-500">Rasm yo'q</div>
                          )}
                        </div>

                        {/* Right Column: Information */}
                        <div className="sm:col-span-2 space-y-3.5 text-xs">
                          <div>
                            <span className="bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider text-[9px] border border-blue-500/20">
                              Gemini AI Tahlil Qildi
                            </span>
                            <h4 className="text-white font-bold text-sm mt-1.5 flex items-center gap-1.5">
                              <User className="w-4 h-4 text-slate-400" />
                              {tx.firstName} (@{tx.username || "noma'lum"})
                            </h4>
                            <p className="text-slate-400 text-[10px] font-mono">Chat ID: {tx.userId}</p>
                          </div>

                          <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                            <div>
                              <p className="text-[10px] text-slate-500 uppercase font-semibold">Tahliliy Summa:</p>
                              <p className="font-mono text-emerald-400 font-bold">{tx.geminiResult?.amount || tx.amount} so'm</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 uppercase font-semibold">Tranzaksiya ID:</p>
                              <p className="font-mono text-slate-300 font-bold">{tx.geminiResult?.transactionId || "Noma'lum"}</p>
                            </div>
                            <div className="col-span-2 mt-1 border-t border-slate-800/50 pt-1.5">
                              <p className="text-[10px] text-slate-500 uppercase font-semibold">Chek sanasi:</p>
                              <p className="text-slate-300 font-medium">{tx.geminiResult?.dateTime || new Date(tx.timestamp).toLocaleString()}</p>
                            </div>
                          </div>

                          <div>
                            <p className="text-[10px] text-slate-500 uppercase font-semibold mb-0.5">Gemini sharhi:</p>
                            <p className="text-slate-400 leading-relaxed italic">"{tx.geminiResult?.reason}"</p>
                          </div>
                        </div>
                      </div>

                      {/* Action buttons (colorful buttons as requested by user) */}
                      <div className="p-3 bg-slate-950 border-t border-slate-800/80 grid grid-cols-2 gap-3">
                        <button
                          onClick={() => handleAdminAction(tx.id, "REJECTED")}
                          className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs py-2 px-4 rounded-xl transition flex items-center justify-center gap-1.5 shadow-lg shadow-rose-500/10 cursor-pointer"
                        >
                          <XCircle className="w-4 h-4" />
                          RAD ETISH ❌
                        </button>
                        <button
                          onClick={() => handleAdminAction(tx.id, "APPROVED")}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-2 px-4 rounded-xl transition flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-500/10 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          TASDIQLASH ✅
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Historical Database Logs */}
        {activeTab === "transactions" && (
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800/80">
              <h3 className="text-md font-bold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-slate-400" />
                To'lovlar va Cheklar Tarixi
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-950 border-b border-slate-800/80 text-slate-400 font-bold">
                    <th className="p-4">Foydalanuvchi / Mijoz</th>
                    <th className="p-4">Tarif</th>
                    <th className="p-4">Summa</th>
                    <th className="p-4">Tranzaksiya ID</th>
                    <th className="p-4">Sana</th>
                    <th className="p-4 text-center">Status</th>
                    <th className="p-4">AI Izohi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {state.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-12 text-center text-slate-500">
                        Hech qanday to'lovlar tarixi mavjud emas.
                      </td>
                    </tr>
                  ) : (
                    state.transactions.map((tx) => {
                      let statusBadge = "";
                      if (tx.status === "PENDING") {
                        statusBadge = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                      } else if (tx.status === "APPROVED") {
                        statusBadge = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                      } else if (tx.status === "REJECTED") {
                        statusBadge = "bg-rose-500/10 text-rose-400 border-rose-500/20";
                      } else if (tx.status === "FAKE") {
                        statusBadge = "bg-red-500/10 text-red-400 border-red-500/20";
                      }

                      return (
                        <tr key={tx.id} className="hover:bg-slate-900/20 transition">
                          <td className="p-4">
                            <div className="font-semibold text-white">{tx.firstName}</div>
                            <div className="text-[10px] text-slate-500 font-mono">@{tx.username || "noma'lum"} • ID: {tx.userId}</div>
                          </td>
                          <td className="p-4 text-slate-300">{tx.plan}</td>
                          <td className="p-4 font-mono font-bold text-white">{tx.geminiResult?.amount || tx.amount.toLocaleString()} UZS</td>
                          <td className="p-4 font-mono text-slate-400">{tx.geminiResult?.transactionId || "—"}</td>
                          <td className="p-4 text-slate-400">{new Date(tx.timestamp).toLocaleString("uz-UZ")}</td>
                          <td className="p-4 text-center">
                            <span className={`px-2 py-1 rounded-full border text-[9px] font-bold uppercase tracking-wider ${statusBadge}`}>
                              {tx.status}
                            </span>
                          </td>
                          <td className="p-4 text-slate-400 font-medium max-w-xs truncate" title={tx.geminiResult?.reason}>
                            {tx.geminiResult?.reason || "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 5: Bot Settings Panel */}
        {activeTab === "settings" && (
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6">
            <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2 border-b border-slate-800/60 pb-3">
              <Sliders className="w-5 h-5 text-emerald-400" />
              Bot va To'lov Sozlamalari
            </h3>

            <form onSubmit={handleSaveSettings} className="space-y-6">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Bot Credentials Section */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Kredentsiallar & Bot</h4>
                  
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 font-medium">Telegram Bot Token</label>
                    <input
                      type="text"
                      value={formConfig.botToken}
                      onChange={(e) => setFormConfig({ ...formConfig, botToken: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:border-emerald-500 transition"
                      placeholder="Masalan: 8266998599:AAGDv..."
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 font-medium">Admin Telegram ID</label>
                    <input
                      type="text"
                      value={formConfig.adminId}
                      onChange={(e) => setFormConfig({ ...formConfig, adminId: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:border-emerald-500 transition"
                      placeholder="Masalan: 8215056224"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 font-medium">Gemini AI API Key</label>
                    <input
                      type="password"
                      value={formConfig.geminiApiKey}
                      onChange={(e) => setFormConfig({ ...formConfig, geminiApiKey: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:border-emerald-500 transition"
                      placeholder="Sozlanmagan bo'lsa environmentdan olinadi"
                    />
                  </div>
                </div>

                {/* Card and Products Section */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Plastik Karta & Rekvizitlar</h4>
                  
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 font-medium font-mono">Karta raqami (4073...)</label>
                    <input
                      type="text"
                      value={formConfig.cardNumber}
                      onChange={(e) => setFormConfig({ ...formConfig, cardNumber: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:border-emerald-500 transition"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 font-medium">Karta Egasi Ismi (F.I.O)</label>
                    <input
                      type="text"
                      value={formConfig.cardHolder}
                      onChange={(e) => setFormConfig({ ...formConfig, cardHolder: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:border-emerald-500 transition"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5 font-medium">Tarif narxi (UZS)</label>
                    <input
                      type="number"
                      value={formConfig.subscriptionPrice}
                      onChange={(e) => setFormConfig({ ...formConfig, subscriptionPrice: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:border-emerald-500 transition"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Database and URLs */}
              <div className="space-y-4 pt-4 border-t border-slate-800/60">
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Integratsiya</h4>
                
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 font-medium">Muvaffaqiyatli To'lov Bazasi API (AlwaysData)</label>
                  <input
                    type="url"
                    value={formConfig.dbApiUrl}
                    onChange={(e) => setFormConfig({ ...formConfig, dbApiUrl: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:border-emerald-500 transition"
                    required
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="pt-4 border-t border-slate-800/60 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setFormConfig(state.config)}
                  className="bg-slate-800 hover:bg-slate-750 text-slate-200 font-medium text-sm py-2 px-4 rounded-xl transition cursor-pointer"
                >
                  O'zgarishlarni bekor qilish
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm py-2.5 px-6 rounded-xl transition flex items-center gap-2 shadow-lg shadow-emerald-500/10 cursor-pointer"
                  disabled={savingSettings}
                >
                  {savingSettings && <RefreshCw className="w-4 h-4 animate-spin" />}
                  Sozlamalarni Saqlash
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
