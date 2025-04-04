require("dotenv").config(); // Memuat variabel lingkungan dari .env
const { ethers } = require("ethers");
const fs = require("fs");
const readline = require("readline");
const axios = require("axios");

// Mengambil konfigurasi dari file .env
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;

if (!PRIVATE_KEY || !RPC_URL || !TOKEN_ADDRESS) {
    console.error("❌ ERROR: Pastikan file .env sudah dikonfigurasi dengan benar.");
    process.exit(1);
}

// ABI ERC-20 minimal untuk transfer token
const ERC20_ABI = [
    "function transfer(address to, uint256 amount) public returns (bool)",
    "function decimals() view returns (uint8)"
];

// Inisialisasi provider dan wallet
const provider = new ethers.JsonRpcProvider(RPC_URL, {
    chainId: 10218, // Chain ID untuk Tea Sepolia
    name: "tea-sepolia"
});
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const tokenContract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, wallet);

// Fungsi untuk membaca daftar alamat dari file
function readAddressesFromFile(filename) {
    if (!fs.existsSync(filename)) return [];
    const data = fs.readFileSync(filename, 'utf8');
    return data.split('\n').map(line => line.trim()).filter(line => line !== '');
}

// Fungsi untuk menyimpan daftar alamat ke file
function writeAddressesToFile(filename, addresses) {
    fs.writeFileSync(filename, addresses.join('\n'), 'utf8');
}

// 🔔 Fungsi kirim notifikasi ke Telegram
async function sendTelegramMessage(message) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) return;

    try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: "Markdown"
        });
    } catch (error) {
        console.error("❌ Gagal kirim notifikasi Telegram:", error.message);
    }
}

// Fungsi untuk mengunduh daftar alamat KYC secara langsung dari URL raw GitHub
async function fetchKYCAddresses() {
    try {
        console.log("🌍 Mengunduh daftar alamat KYC dari repository GitHub...");
        const response = await axios.get("https://raw.githubusercontent.com/tudeiy/Bulk-transfer-tea/main/addressteasepoliakyc.txt");
        if (response.data) {
            return response.data.split('\n').map(addr => addr.trim().toLowerCase());
        } else {
            console.error("❌ ERROR: Tidak dapat mengunduh data alamat KYC.");
            return [];
        }
    } catch (error) {
        console.error("❌ ERROR: Gagal mengunduh daftar KYC dari GitHub.", error.message);
        return [];
    }
}

// Waktu operasi dalam jam WIB
const operationalHours = [8, 12, 15, 19, 21];

// Fungsi untuk menunggu sampai jam operasi
async function waitForNextRun() {
    while (true) {
        let now = new Date();
        let hour = new Date().getUTCHours() + 7;
        if (hour >= 24) hour -= 24; // biar nggak lebih dari 23
        
        if (operationalHours.includes(hour)) {
            console.log(`🕒 Sekarang jam ${hour}:00 WIB, mulai mengirim transaksi...`);
            return;
        }
        
        console.log("🕒 Di luar jam operasi, menunggu...");
        await new Promise(resolve => setTimeout(resolve, 60000)); // Cek setiap 1 menit
    }
}

// Fungsi untuk menunda eksekusi
// Fungsi untuk menunda eksekusi
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fungsi untuk menunda eksekusi dengan waktu acak 15-20 detik
async function randomDelay() {
    const min = 15000; // 15 detik
    const max = 20000; // 20 detik
    const delayTime = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log(`⏳ Menunggu ${delayTime / 1000} detik sebelum transaksi berikutnya...`);
    await delay(delayTime);
}

async function askUserChoice() {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question("⚡ Apakah ingin menjalankan script sekarang? (y/n): ", (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === "y");
        });
    });
}

async function main() {
    const runNow = await askUserChoice();

    if (!runNow) {
        await waitForNextRun(); // Tunggu sesuai jadwal operasional
    }

    await sendTelegramMessage("🚀 *Script TeaTransfer dimulai!*");

    try {
        const decimals = await tokenContract.decimals();
        let kycAddresses = await fetchKYCAddresses();
        if (kycAddresses.length === 0) {
            const msg = "❌ Tidak ada alamat KYC ditemukan.";
            console.error(msg);
            await sendTelegramMessage(msg);
            return;
        }

        let sentRecipients = readAddressesFromFile('kyc_addresses_sent.txt');
        let recipients = kycAddresses.filter(addr => !sentRecipients.includes(addr));

        if (recipients.length === 0) {
            const msg = "✅ Semua alamat KYC sudah menerima token.";
            console.log(msg);
            await sendTelegramMessage(msg);
            return;
        }

        console.log(`📋 Ada ${recipients.length} alamat yang belum menerima token.`);

        let transactionLimit = Math.min(recipients.length, Math.floor(Math.random() * (150 - 100 + 1) + 100));
        const limitMsg = `🔄 Akan mengirim ${transactionLimit} transaksi hari ini.`;
        console.log(limitMsg);
        await sendTelegramMessage(limitMsg);

        let failedRecipients = [];

        console.log("🔁 Memulai loop transaksi...");

        for (let i = 0; i < transactionLimit; i++) {
            try {
                let recipient = recipients[i];
                const amountToSend = ethers.parseUnits("1.0", decimals);

                const tx = await tokenContract.transfer(recipient, amountToSend);
                await tx.wait();
                const successMsg = `✅ ${i + 1}. Transaksi berhasil ke \`${recipient}\``;
                console.log(successMsg);
                await sendTelegramMessage(successMsg);

                sentRecipients.push(recipient);
            } catch (error) {
                const failMsg = `❌ ${i + 1}. Transaksi gagal ke \`${recipients[i]}\`\n*Error:* ${error.message}`;
                console.log(failMsg);
                await sendTelegramMessage(failMsg);
                failedRecipients.push(recipients[i]);
            }
            await delay(5000); // Jeda 5 detik
        }

        writeAddressesToFile('kyc_addresses_pending.txt', failedRecipients);
        writeAddressesToFile('kyc_addresses_sent.txt', sentRecipients);

        const doneMsg = "🎉 Semua transaksi hari ini *selesai*.";
        console.log(doneMsg);
        await sendTelegramMessage(doneMsg);
    } catch (error) {
        const errorMsg = `❌ *Script error:* ${error.message}`;
        console.error("❌ ERROR:", error);
        await sendTelegramMessage(errorMsg);
    }
}

        // 🕒 Fungsi untuk memilih waktu acak antara 9 AM - 1 PM WIB
function getRandomExecutionTime() {
    const startHour = 9;
    const endHour = 13;
    const now = new Date();

    // Pilih waktu eksekusi acak dalam rentang 9 AM - 1 PM WIB
    let randomHour = Math.floor(Math.random() * (endHour - startHour + 1)) + startHour;
    let randomMinute = Math.floor(Math.random() * 60);
    
    let executionTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), randomHour, randomMinute, 0);

    // Jika waktu eksekusi sudah lewat, jadwalkan untuk hari berikutnya
    if (executionTime < now) {
        executionTime.setDate(executionTime.getDate() + 1);
    }

    return executionTime.getTime() - now.getTime();
}

// 🔁 Fungsi untuk menjalankan script setiap hari di waktu acak
async function scheduleDailyExecution() {
    while (true) {
        const delayMs = getRandomExecutionTime();
        const executionTime = new Date(Date.now() + delayMs);
        console.log(`⏳ Script akan dijalankan pada ${executionTime.toLocaleTimeString('id-ID')} WIB...`);

        await delay(delayMs); // Tunggu sampai waktu eksekusi
        await main();         // Jalankan script utama
        console.log("✅ Script selesai. Menjadwalkan untuk hari berikutnya...");
    }
}

// 🚀 Jalankan scheduler harian
scheduleDailyExecution();
